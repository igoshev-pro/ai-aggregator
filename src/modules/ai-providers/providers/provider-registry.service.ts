// src/modules/ai-providers/services/provider-registry.service.ts
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';

import { BaseProvider } from './base-provider.abstract';
import { OpenRouterProvider } from './openrouter.provider';
import { OpenRouterImageProvider } from './openrouter-image.provider';
import { EvolinkProvider } from './evolink.provider';
import { KieProvider } from './kie.provider';
import { ReplicateProvider } from './replicate.provider';
import { Provider, ProviderDocument } from '../schemas/provider.schema';
import { AIModel, ModelDocument } from '../schemas/model.schema';

/**
 * ⚙️ Флаг разовой принудительной миграции цен текстовых моделей.
 * Включи на один деплой → цены в БД перезапишутся на актуальные из каталога.
 * После успешного запуска можно выключить (или удалить блок миграции).
 *
 * ⚠️ Перезаписывает ТОЛЬКО текстовые модели (type === 'text').
 *    Media-модели (image/video/audio) в БД НЕ затрагиваются.
 */
const FORCE_TEXT_PRICES_MIGRATION = true;

/**
 * ⚙️ Разовая принудительная миграция MEDIA-моделей (image/video/audio).
 * Перезаписывает: fixedCostPerGeneration, tokenCost, minTokenCost,
 * tokensPerDollar, pricingMatrix, uiParameters, inputCapabilities, isPremium.
 * После успешного запуска → выключить.
 */
const FORCE_MEDIA_MIGRATION = true;

@Injectable()
export class ProviderRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ProviderRegistryService.name);
  private providers = new Map<string, BaseProvider>();

  constructor(
    private configService: ConfigService,
    @InjectModel(Provider.name) private providerModel: Model<ProviderDocument>,
    @InjectModel(AIModel.name) private modelModel: Model<ModelDocument>,
  ) {}

  async onModuleInit() {
    await this.initializeProviders();
    await this.seedDefaultModels();
  }

  private async initializeProviders() {
    const providerConfigs = this.configService.get('providers');

    if (providerConfigs.openrouter?.apiKey) {
      this.providers.set(
        'openrouter',
        new OpenRouterProvider({
          apiKey: providerConfigs.openrouter.apiKey,
          baseUrl: providerConfigs.openrouter.baseUrl,
        }),
      );
      this.logger.log('✅ OpenRouter provider initialized');
    }

    if (providerConfigs.openrouter?.apiKey) {
      this.providers.set(
        'openrouter-image',
        new OpenRouterImageProvider({
          apiKey: providerConfigs.openrouter.apiKey,
          baseUrl: providerConfigs.openrouter.baseUrl,
        }),
      );
      this.logger.log('✅ OpenRouter Image provider initialized');
    }

    if (providerConfigs.evolink?.apiKey) {
      this.providers.set(
        'evolink',
        new EvolinkProvider({
          apiKey: providerConfigs.evolink.apiKey,
          baseUrl: providerConfigs.evolink.baseUrl,
        }),
      );
      this.logger.log('✅ Evolink provider initialized');
    }

    if (providerConfigs.kie?.apiKey) {
      this.providers.set(
        'kie',
        new KieProvider({
          apiKey: providerConfigs.kie.apiKey,
          baseUrl: providerConfigs.kie.baseUrl,
        }),
      );
      this.logger.log('✅ KIE provider initialized');
    }

    if (providerConfigs.replicate?.apiKey) {
      this.providers.set(
        'replicate',
        new ReplicateProvider({
          apiKey: providerConfigs.replicate.apiKey,
          baseUrl: 'https://api.replicate.com/v1',
        }),
      );
      this.logger.log('✅ Replicate provider initialized');
    }

    await this.syncProvidersToDB();
  }

  private async syncProvidersToDB() {
    for (const [slug, provider] of this.providers) {
      await this.providerModel.findOneAndUpdate(
        { slug },
        {
          slug,
          name: slug.charAt(0).toUpperCase() + slug.slice(1),
          baseUrl: (provider as any).config?.baseUrl || '',
          isActive: true,
          healthStatus: { isHealthy: true, lastCheck: new Date() },
        },
        { upsert: true, new: true },
      );
    }
  }

  getProvider(slug: string): BaseProvider | undefined {
    return this.providers.get(slug);
  }

  getAllProviders(): Map<string, BaseProvider> {
    return this.providers;
  }

  async getProvidersForModel(modelSlug: string): Promise<
    { provider: BaseProvider; modelId: string }[]
  > {
    const model = await this.modelModel.findOne({ slug: modelSlug, isActive: true });
    if (!model) return [];

    const result: { provider: BaseProvider; modelId: string }[] = [];

    const sortedMappings = [...model.providerMappings]
      .filter((m) => m.isActive)
      .sort((a, b) => a.priority - b.priority);

    for (const mapping of sortedMappings) {
      const providerDoc = await this.providerModel.findOne({
        slug: mapping.providerSlug,
        isActive: true,
      });

      if (!providerDoc) continue;

      const provider = this.providers.get(mapping.providerSlug);
      if (provider) {
        result.push({ provider, modelId: mapping.modelId });
      }
    }

    return result;
  }

  @Cron('0 */5 * * * *')
  async healthCheckAll() {
    for (const [slug, provider] of this.providers) {
      try {
        const isHealthy = await provider.healthCheck();
        const now = new Date();

        if (isHealthy) {
          const prev = await this.providerModel.findOne({ slug });
          const wasUnhealthy = (prev?.healthStatus?.consecutiveErrors ?? 0) > 0;

          await this.providerModel.findOneAndUpdate(
            { slug },
            {
              $set: {
                'healthStatus.isHealthy': true,
                'healthStatus.lastCheck': now,
                'healthStatus.consecutiveErrors': 0,
              },
            },
          );

          if (wasUnhealthy) {
            this.logger.log(`✅ Provider ${slug} recovered`);
          }
        } else {
          const doc = await this.providerModel.findOneAndUpdate(
            { slug },
            {
              $set: {
                'healthStatus.isHealthy': false,
                'healthStatus.lastCheck': now,
              },
              $inc: { 'healthStatus.consecutiveErrors': 1 },
            },
            { new: true },
          );

          const errors = doc?.healthStatus?.consecutiveErrors ?? 1;
          if (errors === 1 || errors % 10 === 0) {
            this.logger.warn(
              `⚠️ Provider ${slug} health check failed (${errors} times)`,
            );
          }
        }
      } catch (error: any) {
        this.logger.error(`❌ Health check error for ${slug}: ${error.message}`);
      }
    }
  }

  async updateProviderStats(
    slug: string,
    responseTimeMs: number,
    success: boolean,
  ) {
    const update: any = {
      'healthStatus.lastCheck': new Date(),
      'healthStatus.responseTime': responseTimeMs,
    };

    if (success) {
      update['healthStatus.consecutiveErrors'] = 0;
      update['healthStatus.isHealthy'] = true;
    } else {
      await this.providerModel.findOneAndUpdate(
        { slug },
        { $inc: { 'healthStatus.consecutiveErrors': 1 } },
      );
    }

    await this.providerModel.findOneAndUpdate({ slug }, { $set: update });
  }

  // ═══════════════════════════════════════════════════════════════
  // SEED MODELS — стратегия split-write:
  //
  //   $set         — обновляется ВСЕГДА (name, description, providerMappings,
  //                  capabilities, limits, defaultParams) — нужно для роутинга
  //
  //   $setOnInsert — пишется ТОЛЬКО при первом создании документа
  //                  (slug, цены, pricingMatrix, uiParameters, inputCapabilities)
  //                  → не затирает ручные правки в БД и админский UI
  //
  //   FORCE_TEXT_PRICES_MIGRATION — разовая миграция: перезаписывает цены
  //                  текстовых моделей актуальными значениями из каталога.
  //
  //   FORCE_MEDIA_MIGRATION — разовая миграция media (image/video/audio):
  //                  перезаписывает pricingMatrix, uiParameters, цены.
  // ═══════════════════════════════════════════════════════════════
  private async seedDefaultModels() {
    const existingCount = await this.modelModel.countDocuments();
    this.logger.log(
      `🌱 Syncing ${existingCount > 0 ? 'existing' : 'new'} AI models (split-write strategy)...`,
    );

    const defaultModels = this.buildModelsCatalog();

    const providerDocs = await this.providerModel.find();
    const providerMap = new Map(providerDocs.map((p) => [p.slug, p._id]));

    let created = 0;
    let updated = 0;
    let migrated = 0;
    let priceMigrated = 0;

    for (const modelData of defaultModels) {
      const slug = modelData.slug;

      const mappings = modelData.providerMappings.map((m: any) => ({
        ...m,
        providerId: providerMap.get(m.providerSlug),
      }));

      // ─── 🆕 Новые ценовые поля (в спичках 🔥) ───
      const pricePerMillionInputTokens =
        (modelData as any).pricePerMillionInputTokens ?? 0;
      const pricePerMillionOutputTokens =
        (modelData as any).pricePerMillionOutputTokens ?? 0;
      const providerCostPerMillionInput =
        (modelData as any).providerCostPerMillionInput ?? 0;
      const providerCostPerMillionOutput =
        (modelData as any).providerCostPerMillionOutput ?? 0;
      const avgTokensPerRequest =
        (modelData as any).avgTokensPerRequest ?? 1500;

      // ─── Legacy поля (дублируем те же спички для совместимости fallback) ───
      const costPerMillionInputTokens =
        (modelData as any).costPerMillionInputTokens ?? pricePerMillionInputTokens;
      const costPerMillionOutputTokens =
        (modelData as any).costPerMillionOutputTokens ?? pricePerMillionOutputTokens;
      const fixedCostPerGeneration =
        (modelData as any).fixedCostPerGeneration ?? 0;

      // tokenCost — справочное поле для UI ("от X 🔥")
      let tokenCost = modelData.minTokenCost;
      if (modelData.type === 'text') {
        // Preview-оценка: avgTokens × (0.3×in + 0.7×out) / 1M
        const previewCost =
          (avgTokensPerRequest *
            (0.3 * pricePerMillionInputTokens +
              0.7 * pricePerMillionOutputTokens)) /
          1_000_000;
        tokenCost = Math.max(modelData.minTokenCost, previewCost);
        tokenCost = Math.round(tokenCost * 100) / 100;
      } else {
        // Media: округление до 2 знаков (не Math.ceil, чтобы 0.7344 не превращался в 1)
        const computed = fixedCostPerGeneration * (modelData.tokensPerDollar || 90);
        tokenCost = Math.max(
          modelData.minTokenCost,
          Math.round(computed * 100) / 100,
        );
      }

      // $set — всегда актуализируем эти поля (роутинг и UX-метаданные)
      const setAlways: Record<string, any> = {
        name: modelData.name,
        displayName: modelData.displayName,
        description: modelData.description,
        type: modelData.type,
        capabilities: modelData.capabilities || [],
        providerMappings: mappings,
        limits: modelData.limits || {},
        defaultParams: modelData.defaultParams || {},
        supportsVision: (modelData as any).supportsVision ?? false,
      };

      // $setOnInsert — только при первом создании
      const setOnCreate: Record<string, any> = {
        slug,
        sortOrder: modelData.sortOrder,
        isActive: true,
        isPremium: (modelData as any).isPremium ?? false,
        tokensPerDollar: modelData.tokensPerDollar,
        minTokenCost: modelData.minTokenCost,
        tokenCost,
        // 🆕 новые поля
        pricePerMillionInputTokens,
        pricePerMillionOutputTokens,
        avgTokensPerRequest,
        providerCostPerMillionInput,
        providerCostPerMillionOutput,
        // legacy
        costPerMillionInputTokens,
        costPerMillionOutputTokens,
        fixedCostPerGeneration,
        pricingMatrix: (modelData as any).pricingMatrix || [],
        uiParameters: (modelData as any).uiParameters || [],
        inputCapabilities: (modelData as any).inputCapabilities || {
          acceptsImages: false,
          maxInputImages: 0,
        },
        stats: { totalRequests: 0, avgResponseTime: 0, successRate: 100 },
      };

      const result = await this.modelModel.findOneAndUpdate(
        { slug },
        { $set: setAlways, $setOnInsert: setOnCreate },
        { upsert: true, new: true, rawResult: true } as any,
      );

      // @ts-ignore — rawResult content
      const wasInserted = !!(result as any).lastErrorObject?.upserted;
      if (wasInserted) created++;
      else updated++;

      // ─── ONE-TIME MIGRATION (старая — для media uiParameters/pricingMatrix) ───
      if (!wasInserted) {
        const matrix = (modelData as any).pricingMatrix || [];
        const uiParams = (modelData as any).uiParameters || [];
        const inputCap = (modelData as any).inputCapabilities;

        const needsMigration = await this.modelModel.findOne({
          slug,
          $or: [
            { pricingMatrix: { $exists: false } },
            { pricingMatrix: { $size: 0 } },
            { uiParameters: { $exists: false } },
            { uiParameters: { $size: 0 } },
          ],
        });

        if (needsMigration && (matrix.length > 0 || uiParams.length > 0)) {
          const migrationSet: Record<string, any> = {};

          if (
            matrix.length > 0 &&
            (!needsMigration.pricingMatrix || needsMigration.pricingMatrix.length === 0)
          ) {
            migrationSet.pricingMatrix = matrix;
          }
          if (
            uiParams.length > 0 &&
            (!needsMigration.uiParameters || needsMigration.uiParameters.length === 0)
          ) {
            migrationSet.uiParameters = uiParams;
          }
          if (
            inputCap &&
            (!needsMigration.inputCapabilities ||
              Object.keys(needsMigration.inputCapabilities).length === 0)
          ) {
            migrationSet.inputCapabilities = inputCap;
          }

          if (Object.keys(migrationSet).length > 0) {
            await this.modelModel.updateOne({ slug }, { $set: migrationSet });
            migrated++;
            this.logger.log(
              `  📦 Migrated ${slug}: added ${Object.keys(migrationSet).join(', ')}`,
            );
          }
        }
      }

      // ─── 🆕 PRICE MIGRATION (для текстовых моделей) ───
      // Перезаписывает все ценовые поля на актуальные значения из каталога.
      if (FORCE_TEXT_PRICES_MIGRATION && modelData.type === 'text') {
        await this.modelModel.updateOne(
          { slug },
          {
            $set: {
              minTokenCost: modelData.minTokenCost,
              tokenCost,
              // 🆕 главные поля — их читает реальное списание
              pricePerMillionInputTokens,
              pricePerMillionOutputTokens,
              avgTokensPerRequest,
              providerCostPerMillionInput,
              providerCostPerMillionOutput,
              // legacy дубль для fallback
              costPerMillionInputTokens,
              costPerMillionOutputTokens,
              tokensPerDollar: modelData.tokensPerDollar,
              isPremium: (modelData as any).isPremium ?? false,
              supportsVision: (modelData as any).supportsVision ?? false,
            },
          },
        );
        priceMigrated++;
      }

      // ─── 🆕 MEDIA MIGRATION (image/video/audio) ───
      if (FORCE_MEDIA_MIGRATION && modelData.type !== 'text') {
        const mediaSet: Record<string, any> = {
          minTokenCost: modelData.minTokenCost,
          tokenCost,
          tokensPerDollar: modelData.tokensPerDollar,
          fixedCostPerGeneration,
          isPremium: (modelData as any).isPremium ?? false,
        };

        // pricingMatrix / uiParameters / inputCapabilities —
        // перезаписываем только если они заданы в каталоге
        const matrix = (modelData as any).pricingMatrix;
        const uiParams = (modelData as any).uiParameters;
        const inputCap = (modelData as any).inputCapabilities;

        if (Array.isArray(matrix) && matrix.length > 0) {
          mediaSet.pricingMatrix = matrix;
        }
        if (Array.isArray(uiParams) && uiParams.length > 0) {
          mediaSet.uiParameters = uiParams;
        }
        if (inputCap) {
          mediaSet.inputCapabilities = inputCap;
        }

        await this.modelModel.updateOne({ slug }, { $set: mediaSet });
        priceMigrated++;
      }
    }

    this.logger.log(
      `🌱 Models synced — created: ${created}, updated: ${updated}, ` +
      `legacy-migrated: ${migrated}, prices-forced: ${priceMigrated}`,
    );

    if (FORCE_TEXT_PRICES_MIGRATION) {
      this.logger.warn(
        `⚠️ FORCE_TEXT_PRICES_MIGRATION=true — после успешного запуска можно отключить флаг.`,
      );
    }
    if (FORCE_MEDIA_MIGRATION) {
      this.logger.warn(
        `⚠️ FORCE_MEDIA_MIGRATION=true — после успешного запуска можно отключить флаг.`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // КАТАЛОГ МОДЕЛЕЙ — данные для seed
  //
  // Ценообразование текстовых моделей (формула платформы):
  //   спички_за_1M = цена_провайдера_USD × 90
  //   (×3 наценка платформы × 90 ₽/$ ÷ 3 ₽/спичка = ×90)
  //
  //   pricePerMillionInputTokens / pricePerMillionOutputTokens — в 🔥 (читает биллинг)
  //   providerCostPerMillionInput / Output — чистый USD (аналитика маржи)
  //   minTokenCost — минимум за запрос (вручную), списание не опускается ниже
  //
  // Ценообразование МЕДИА моделей:
  //   costInTokens = round2( costInDollars × 90 )
  //   fixedCostPerGeneration = $ (последняя линия защиты, если не нашлось matching rule)
  //   tokensPerDollar = 90 (унифицировано для image; video/audio — свои значения)
  //   minTokenCost = минимальная строка матрицы (нижняя планка списания)
  // ═══════════════════════════════════════════════════════════════
  private buildModelsCatalog(): any[] {
    return [
      // ════════════════════════════════════════════════════
      // ТЕКСТОВЫЕ МОДЕЛИ
      // ════════════════════════════════════════════════════
      {
        slug: 'gpt-oss-120b',
        name: 'GPT-OSS 120B',
        displayName: 'GPT-OSS 120B',
        description: 'Open-source 117B MoE model, оптимизирована для H100',
        type: 'text',
        // provider: $0.039 / $0.18  →  ×90  →  3.51 / 16.2 🔥
        pricePerMillionInputTokens: 3.51,
        pricePerMillionOutputTokens: 16.2,
        providerCostPerMillionInput: 0.039,
        providerCostPerMillionOutput: 0.18,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 1000,
        minTokenCost: 0.1,
        sortOrder: 1,
        capabilities: ['streaming', 'function_calling'],
        providerMappings: [
          { providerSlug: 'openrouter', modelId: 'openai/gpt-oss-120b', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 4096, temperature: 0.7 },
        limits: { maxInputTokens: 131072, maxOutputTokens: 16384 },
      },
            {
        slug: 'claude-haiku-4.5',
        name: 'Claude Haiku 4.5',
        displayName: 'Claude Haiku 4.5',
        description: 'Быстрая модель Anthropic с расширенным мышлением',
        type: 'text',
        // provider: $1 / $5  →  ×90  →  90 / 450 🔥
        pricePerMillionInputTokens: 90,
        pricePerMillionOutputTokens: 450,
        providerCostPerMillionInput: 1.0,
        providerCostPerMillionOutput: 5.0,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 1000,
        minTokenCost: 0.5,
        sortOrder: 2,
        supportsVision: true,
        capabilities: ['streaming', 'vision', 'thinking'],
        providerMappings: [
          { providerSlug: 'openrouter', modelId: 'anthropic/claude-haiku-4.5', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 200000, maxOutputTokens: 8192 },
      },
      {
        slug: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        displayName: 'DeepSeek V4 Flash',
        description: 'Быстрая универсальная модель DeepSeek, контекст 1M',
        type: 'text',
        // provider: $0.147 / $0.294  →  ×90  →  13.23 / 26.46 🔥
        pricePerMillionInputTokens: 13.23,
        pricePerMillionOutputTokens: 26.46,
        providerCostPerMillionInput: 0.147,
        providerCostPerMillionOutput: 0.294,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 1000,
        minTokenCost: 0.1,
        sortOrder: 10,
        capabilities: ['streaming', 'function_calling'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'deepseek-v4-flash', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 1000000, maxOutputTokens: 16384 },
      },
      {
        slug: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        displayName: 'DeepSeek V4 Pro',
        description: 'Reasoning-модель DeepSeek: математика, код, сложная логика',
        type: 'text',
        // provider: $1.765 / $3.529  →  ×90  →  158.85 / 317.61 🔥
        pricePerMillionInputTokens: 158.85,
        pricePerMillionOutputTokens: 317.61,
        providerCostPerMillionInput: 1.765,
        providerCostPerMillionOutput: 3.529,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 1000,
        minTokenCost: 0.5,
        sortOrder: 10.5,
        isPremium: true,
        capabilities: ['streaming', 'reasoning', 'function_calling'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'deepseek-v4-pro', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 1000000, maxOutputTokens: 16384 },
      },
      {
        slug: 'grok-4.20',
        name: 'Grok 4.20',
        displayName: 'Grok 4.20',
        description: 'Быстрая версия Grok от xAI',
        type: 'text',
        // provider: $1.25 / $2.50  →  ×90  →  112.5 / 225 🔥
        pricePerMillionInputTokens: 112.5,
        pricePerMillionOutputTokens: 225,
        providerCostPerMillionInput: 1.25,
        providerCostPerMillionOutput: 2.5,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 1000,
        minTokenCost: 0.3,
        sortOrder: 4,
        capabilities: ['streaming', 'reasoning', 'function_calling'],
        providerMappings: [
          { providerSlug: 'openrouter', modelId: 'x-ai/grok-4.20', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 4096, temperature: 0.7 },
        limits: { maxInputTokens: 2000000, maxOutputTokens: 4096 },
      },
      {
        slug: 'grok-4.3',
        name: 'Grok 4.3',
        displayName: 'Grok 4.3',
        description: 'Флагманская reasoning модель от xAI',
        type: 'text',
        // provider: $1.25 / $2.50  →  ×90  →  112.5 / 225 🔥
        pricePerMillionInputTokens: 112.5,
        pricePerMillionOutputTokens: 225,
        providerCostPerMillionInput: 1.25,
        providerCostPerMillionOutput: 2.5,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 1000,
        minTokenCost: 1.2,
        sortOrder: 5,
        isPremium: true,
        supportsVision: true,
        capabilities: ['streaming', 'reasoning', 'vision'],
        providerMappings: [
          { providerSlug: 'openrouter', modelId: 'x-ai/grok-4.3', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 256000, maxOutputTokens: 8192, includedInPlans: ['pro', 'unlimited'] },
      },
      {
        slug: 'perplexity-sonar',
        name: 'Perplexity Sonar',
        displayName: 'Perplexity Sonar',
        description: 'Поисковая модель с актуальными данными',
        type: 'text',
        // provider: $1 / $1  →  ×90  →  90 / 90 🔥
        pricePerMillionInputTokens: 90,
        pricePerMillionOutputTokens: 90,
        providerCostPerMillionInput: 1.0,
        providerCostPerMillionOutput: 1.0,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 1000,
        minTokenCost: 1.0,
        sortOrder: 6,
        // 🌐 web_search — пометит модель как "с интернетом" на фронте
        capabilities: ['streaming', 'web_search', 'citations'],
        providerMappings: [
          { providerSlug: 'openrouter', modelId: 'perplexity/sonar', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 4096, temperature: 0.7 },
        limits: { maxInputTokens: 127000, maxOutputTokens: 4096 },
      },
      {
        slug: 'gpt-5.4',
        name: 'GPT-5.4',
        displayName: 'GPT-5.4',
        description: 'Новейшая флагманская модель OpenAI',
        type: 'text',
        // provider: $2.25 / $13.50  →  ×90  →  202.5 / 1215 🔥
        pricePerMillionInputTokens: 202.5,
        pricePerMillionOutputTokens: 1215,
        providerCostPerMillionInput: 2.25,
        providerCostPerMillionOutput: 13.5,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 1000,
        minTokenCost: 0.8,
        sortOrder: 7,
        isPremium: true,
        supportsVision: true,
        capabilities: ['streaming', 'vision', 'function_calling'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'gpt-5.4', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 128000, maxOutputTokens: 16384, includedInPlans: ['unlimited'] },
      },
      {
        slug: 'claude-opus-4.8',
        name: 'Claude Opus 4.8',
        displayName: 'Claude Opus 4.8',
        description: 'Самая мощная модель Anthropic (новейшая)',
        type: 'text',
        // provider: $4.50 / $22.50  →  ×90  →  405 / 2025 🔥
        pricePerMillionInputTokens: 405,
        pricePerMillionOutputTokens: 2025,
        providerCostPerMillionInput: 4.5,
        providerCostPerMillionOutput: 22.5,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 1000,
        minTokenCost: 1.5,
        sortOrder: 7.5,
        isPremium: true,
        supportsVision: true,
        capabilities: ['streaming', 'vision', 'thinking'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'claude-opus-4-8', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 200000, maxOutputTokens: 8192, includedInPlans: ['unlimited'] },
      },
      {
        slug: 'claude-opus-4.7',
        name: 'Claude Opus 4.7',
        displayName: 'Claude Opus 4.7',
        description: 'Самая мощная модель Anthropic',
        type: 'text',
        // provider: $4.50 / $22.50  →  ×90  →  405 / 2025 🔥
        pricePerMillionInputTokens: 405,
        pricePerMillionOutputTokens: 2025,
        providerCostPerMillionInput: 4.5,
        providerCostPerMillionOutput: 22.5,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 1000,
        minTokenCost: 1.5,
        sortOrder: 8,
        isPremium: true,
        supportsVision: true,
        capabilities: ['streaming', 'vision', 'thinking'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'claude-opus-4-7', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 200000, maxOutputTokens: 8192, includedInPlans: ['unlimited'] },
      },
      {
        slug: 'claude-sonnet-4.6',
        name: 'Claude Sonnet 4.6',
        displayName: 'Claude Sonnet 4.6',
        description: 'Балансированная модель Anthropic нового поколения',
        type: 'text',
        // provider: $2.70 / $13.50  →  ×90  →  243 / 1215 🔥
        pricePerMillionInputTokens: 243,
        pricePerMillionOutputTokens: 1215,
        providerCostPerMillionInput: 2.7,
        providerCostPerMillionOutput: 13.5,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 1000,
        minTokenCost: 0.8,
        sortOrder: 9,
        isPremium: true,
        supportsVision: true,
        capabilities: ['streaming', 'vision', 'thinking'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'claude-sonnet-4-6', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 200000, maxOutputTokens: 8192, includedInPlans: ['pro', 'unlimited'] },
      },
      {
        slug: 'gemini-3.1-pro',
        name: 'Gemini 3.1 Pro',
        displayName: 'Gemini 3.1 Pro',
        description: 'Продвинутая модель Google',
        type: 'text',
        // provider: $0.50 / $3.50  →  ×90  →  45 / 315 🔥
        pricePerMillionInputTokens: 45,
        pricePerMillionOutputTokens: 315,
        providerCostPerMillionInput: 0.5,
        providerCostPerMillionOutput: 3.5,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 1000,
        minTokenCost: 0.2,
        sortOrder: 11,
        supportsVision: true,
        capabilities: ['streaming', 'vision'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'gemini-3.1-pro', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 1000000, maxOutputTokens: 8192 },
      },
      {
        slug: 'gemini-3-flash',
        name: 'Gemini 3 Flash',
        displayName: 'Gemini 3 Flash',
        description: 'Быстрая модель Google',
        type: 'text',
        // provider: $0.15 / $3.90  →  ×90  →  13.5 / 351 🔥
        pricePerMillionInputTokens: 13.5,
        pricePerMillionOutputTokens: 351,
        providerCostPerMillionInput: 0.15,
        providerCostPerMillionOutput: 3.9,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 1000,
        minTokenCost: 0.1,
        sortOrder: 12,
        supportsVision: true,
        capabilities: ['streaming', 'vision'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'gemini-3-flash', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 1000000, maxOutputTokens: 8192 },
      },
      {
        slug: 'gpt-4o',
        name: 'GPT-4o',
        displayName: 'ChatGPT 4o',
        description: 'Флагманская модель OpenAI с vision и function calling',
        type: 'text',
        // provider: $2.50 / $10  →  ×90  →  225 / 900 🔥
        pricePerMillionInputTokens: 225,
        pricePerMillionOutputTokens: 900,
        providerCostPerMillionInput: 2.5,
        providerCostPerMillionOutput: 10.0,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 1000,
        minTokenCost: 0.3,
        sortOrder: 13,
        supportsVision: true,
        capabilities: ['streaming', 'vision', 'function_calling'],
        providerMappings: [
          { providerSlug: 'openrouter', modelId: 'openai/gpt-4o', priority: 1, isActive: true },
          { providerSlug: 'evolink', modelId: 'gpt-4o', priority: 2, isActive: true },
        ],
        defaultParams: { maxTokens: 4096, temperature: 0.7 },
        limits: { maxInputTokens: 128000, maxOutputTokens: 16384 },
      },
      {
        slug: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        displayName: 'ChatGPT 4o Mini',
        description: 'Быстрая и дешёвая модель OpenAI',
        type: 'text',
        // provider: $0.15 / $0.60  →  ×90  →  13.5 / 54 🔥
        pricePerMillionInputTokens: 13.5,
        pricePerMillionOutputTokens: 54,
        providerCostPerMillionInput: 0.15,
        providerCostPerMillionOutput: 0.6,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 1000,
        minTokenCost: 0.1,
        sortOrder: 14,
        supportsVision: true,
        capabilities: ['streaming', 'vision', 'function_calling'],
        providerMappings: [
          { providerSlug: 'openrouter', modelId: 'openai/gpt-4o-mini', priority: 1, isActive: true },
          { providerSlug: 'evolink', modelId: 'gpt-4o-mini', priority: 2, isActive: true },
        ],
        defaultParams: { maxTokens: 4096, temperature: 0.7 },
        limits: { maxInputTokens: 128000, maxOutputTokens: 16384 },
      },

      // ════════════════════════════════════════════════════
      // IMAGE МОДЕЛИ  (цены: $провайдера × 90 = 🔥, round2)
      // ════════════════════════════════════════════════════
      {
        slug: 'gpt-5-image',
        name: 'GPT-5 Image 2',
        displayName: 'GPT-5 Image 2',
        description: 'Новейший генератор изображений OpenAI (GPT Image 2)',
        type: 'image',
        fixedCostPerGeneration: 0.00816,
        tokensPerDollar: 90,
        minTokenCost: 0.73,
        sortOrder: 1,
        capabilities: ['text_rendering', 'image_editing'],
        providerMappings: [
          { providerSlug: 'openrouter-image', modelId: 'openai/gpt-5.4-image-2', priority: 1, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: true, maxInputImages: 4 },
        pricingMatrix: [
          { conditions: { quality: 'high' },   costInTokens: 11.23, costInDollars: 0.1248,  label: 'Высокое качество' },
          { conditions: { quality: 'medium' }, costInTokens: 2.85,  costInDollars: 0.03168, label: 'Среднее качество' },
          { conditions: { quality: 'low' },    costInTokens: 0.73,  costInDollars: 0.00816, label: 'Базовое качество' },
        ],
        uiParameters: [
          {
            key: 'quality', label: 'Качество', type: 'select', affectsPrice: true, defaultValue: 'medium',
            options: [
              { value: 'low', label: 'Базовое (0.73🔥)' },
              { value: 'medium', label: 'Среднее (2.85🔥)' },
              { value: 'high', label: 'Высокое (11.23🔥)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Соотношение сторон', type: 'select', affectsPrice: false, defaultValue: '1:1',
            options: [
              { value: '1:1', label: 'Квадрат (1:1)' },
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '3:2', label: 'Фото (3:2)' },
              { value: '2:3', label: 'Портрет (2:3)' },
            ],
          },
        ],
      },
      {
        slug: 'gpt-image-1.5-lite',
        name: 'GPT Image 1.5 Lite',
        displayName: 'GPT Image 1.5 Lite',
        description: 'Облегчённая версия генератора изображений OpenAI',
        type: 'image',
        fixedCostPerGeneration: 0.0435,
        tokensPerDollar: 90,
        minTokenCost: 3.92,
        sortOrder: 2,
        capabilities: ['text_to_image', 'image_editing'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'gpt-image-1.5', priority: 1, isActive: true },
        ],
        defaultParams: { aspectRatio: '1:1', quality: 'medium' },
        limits: { maxResolution: '1536x1024' },
        inputCapabilities: { acceptsImages: true, maxInputImages: 4 },
        // ⚠️ B3: 3-уровневая прикидка качества (провайдер token-based, без явного quality)
        pricingMatrix: [
          { conditions: { quality: 'high' },   costInTokens: 15.68, costInDollars: 0.1742, label: 'Высокое качество' },
          { conditions: { quality: 'medium' }, costInTokens: 7.84,  costInDollars: 0.0871, label: 'Среднее качество' },
          { conditions: { quality: 'low' },    costInTokens: 3.92,  costInDollars: 0.0435, label: 'Базовое качество' },
        ],
        uiParameters: [
          {
            key: 'quality', label: 'Качество', type: 'select', affectsPrice: true, defaultValue: 'medium',
            options: [
              { value: 'low', label: 'Базовое (3.92🔥)' },
              { value: 'medium', label: 'Среднее (7.84🔥)' },
              { value: 'high', label: 'Высокое (15.68🔥)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Соотношение сторон', type: 'select', affectsPrice: false, defaultValue: '1:1',
            options: [
              { value: '1:1', label: 'Квадрат (1:1)' },
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '3:2', label: 'Фото (3:2)' },
              { value: '2:3', label: 'Портрет (2:3)' },
            ],
          },
        ],
      },
            {
        slug: 'midjourney',
        name: 'Midjourney',
        displayName: 'Midjourney V7',
        description: 'Лучший генератор изображений',
        type: 'image',
        fixedCostPerGeneration: 0.040,
        tokensPerDollar: 90,
        minTokenCost: 3.6,
        sortOrder: 3,
        capabilities: ['variations', 'upscale'],
        providerMappings: [
          // { providerSlug: 'kie', modelId: 'mj_txt2img', priority: 1, isActive: true }, // ⏸ нет модели у kie
          { providerSlug: 'evolink', modelId: 'mj-v7', priority: 1, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        pricingMatrix: [
          { conditions: { mode: 'turbo' }, costInTokens: 14.31, costInDollars: 0.159, label: 'Турбо режим' },
          { conditions: { mode: 'fast' },  costInTokens: 7.11,  costInDollars: 0.079, label: 'Быстрый режим' },
          { conditions: { mode: 'relax' }, costInTokens: 3.6,   costInDollars: 0.040, label: 'Relax режим' },
        ],
        uiParameters: [
          {
            key: 'mode', label: 'Режим генерации', type: 'select', affectsPrice: true, defaultValue: 'fast',
            options: [
              { value: 'relax', label: 'Relax (3.6🔥, ~5 мин)' },
              { value: 'fast', label: 'Быстрый (7.11🔥, ~30 сек)' },
              { value: 'turbo', label: 'Турбо (14.31🔥, ~15 сек)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Соотношение сторон', type: 'select', affectsPrice: false, defaultValue: '1:1',
            options: [
              { value: '1:1', label: 'Квадрат (1:1)' },
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '4:3', label: 'Стандарт (4:3)' },
              { value: '3:4', label: 'Портрет (3:4)' },
              { value: '3:2', label: 'Фото (3:2)' },
              { value: '2:3', label: 'Книга (2:3)' },
            ],
          },
        ],
      },
      {
        slug: 'midjourney-img2img',
        name: 'Midjourney Img2Img',
        displayName: 'Midjourney V7 (Image to Image)',
        description: 'Трансформация изображений через Midjourney',
        type: 'image',
        fixedCostPerGeneration: 0.040,
        tokensPerDollar: 90,
        minTokenCost: 3.6,
        sortOrder: 4,
        capabilities: ['image_to_image', 'variations'],
        providerMappings: [
          // { providerSlug: 'kie', modelId: 'mj_img2img', priority: 1, isActive: true }, // ⏸ нет модели у kie
          { providerSlug: 'evolink', modelId: 'mj-v7', priority: 1, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        pricingMatrix: [
          { conditions: { mode: 'turbo' }, costInTokens: 14.31, costInDollars: 0.159, label: 'Турбо режим' },
          { conditions: { mode: 'fast' },  costInTokens: 7.11,  costInDollars: 0.079, label: 'Быстрый режим' },
          { conditions: { mode: 'relax' }, costInTokens: 3.6,   costInDollars: 0.040, label: 'Relax режим' },
        ],
        uiParameters: [
          {
            key: 'mode', label: 'Режим генерации', type: 'select', affectsPrice: true, defaultValue: 'fast',
            options: [
              { value: 'relax', label: 'Relax (3.6🔥)' },
              { value: 'fast', label: 'Быстрый (7.11🔥)' },
              { value: 'turbo', label: 'Турбо (14.31🔥)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Соотношение сторон', type: 'select', affectsPrice: false, defaultValue: '1:1',
            options: [
              { value: '1:1', label: 'Квадрат (1:1)' },
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '3:2', label: 'Фото (3:2)' },
              { value: '2:3', label: 'Портрет (2:3)' },
            ],
          },
        ],
      },
      {
        slug: 'seedream-5-lite',
        name: 'Seedream 5.0 Lite',
        displayName: 'Seedream 5.0 Lite',
        description: 'Быстрый генератор Seedream',
        type: 'image',
        fixedCostPerGeneration: 0.0275,
        tokensPerDollar: 90,
        minTokenCost: 2.48,
        sortOrder: 5,
        capabilities: [],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'seedream/5-lite-text-to-image', priority: 1, isActive: true },
          { providerSlug: 'evolink', modelId: 'seedream', priority: 2, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        pricingMatrix: [
          { costInTokens: 2.48, costInDollars: 0.0275, label: 'Стандартная генерация' },
        ],
        uiParameters: [
          {
            key: 'aspectRatio', label: 'Соотношение сторон', type: 'select', affectsPrice: false, defaultValue: '1:1',
            options: [
              { value: '1:1', label: 'Квадрат (1:1)' },
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
            ],
          },
        ],
      },
      {
        slug: 'imagen-4',
        name: 'Imagen 4',
        displayName: 'Google Imagen 4',
        description: 'Генератор изображений от Google',
        type: 'image',
        fixedCostPerGeneration: 0.020,
        tokensPerDollar: 90,
        minTokenCost: 1.8,
        sortOrder: 6,
        capabilities: [],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'google/imagen4-fast', priority: 1, isActive: true },
          { providerSlug: 'evolink', modelId: 'imagen-3', priority: 2, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        pricingMatrix: [
          { costInTokens: 1.8, costInDollars: 0.020, label: 'Стандартная генерация' },
        ],
        uiParameters: [
          {
            key: 'aspectRatio', label: 'Соотношение сторон', type: 'select', affectsPrice: false, defaultValue: '1:1',
            options: [
              { value: '1:1', label: 'Квадрат (1:1)' },
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '4:3', label: 'Стандарт (4:3)' },
              { value: '3:4', label: 'Портрет (3:4)' },
            ],
          },
        ],
      },
      {
        slug: 'flux-2',
        name: 'Flux 2',
        displayName: 'Flux 2',
        description: 'Новая версия Flux',
        type: 'image',
        fixedCostPerGeneration: 0.025,
        tokensPerDollar: 90,
        minTokenCost: 2.25,
        sortOrder: 7,
        capabilities: ['text_to_image', 'image_to_image'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'flux-2/flex-text-to-image', priority: 1, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024, steps: 28 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        pricingMatrix: [
          { conditions: { version: 'flex', resolution: '2K' }, costInTokens: 10.8, costInDollars: 0.12,  label: 'Flex × 2K' },
          { conditions: { version: 'flex', resolution: '1K' }, costInTokens: 6.3,  costInDollars: 0.07,  label: 'Flex × 1K' },
          { conditions: { version: 'pro',  resolution: '2K' }, costInTokens: 3.15, costInDollars: 0.035, label: 'Pro × 2K' },
          { conditions: { version: 'pro',  resolution: '1K' }, costInTokens: 2.25, costInDollars: 0.025, label: 'Pro × 1K' },
        ],
        uiParameters: [
          {
            key: 'version', label: 'Версия модели', type: 'select', affectsPrice: true, defaultValue: 'flex',
            options: [
              { value: 'flex', label: 'Flex' },
              { value: 'pro', label: 'Pro' },
            ],
          },
          {
            key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '1K',
            options: [
              { value: '1K', label: '1K (1024×1024)' },
              { value: '2K', label: '2K (2048×2048)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Соотношение сторон', type: 'select', affectsPrice: false, defaultValue: '1:1',
            options: [
              { value: '1:1', label: 'Квадрат (1:1)' },
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '4:3', label: 'Стандарт (4:3)' },
              { value: '3:4', label: 'Портрет (3:4)' },
            ],
          },
        ],
      },
      {
        slug: 'flux-2-img2img',
        name: 'Flux 2 Img2Img',
        displayName: 'Flux 2 (Image to Image)',
        description: 'Flux 2 для трансформации изображений',
        type: 'image',
        fixedCostPerGeneration: 0.025,
        tokensPerDollar: 90,
        minTokenCost: 2.25,
        sortOrder: 8,
        capabilities: ['image_to_image'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'flux-2/flex-image-to-image', priority: 1, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024, steps: 28 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: true, maxInputImages: 8 },
        pricingMatrix: [
          { conditions: { version: 'flex', resolution: '2K' }, costInTokens: 10.8, costInDollars: 0.12,  label: 'Flex × 2K' },
          { conditions: { version: 'flex', resolution: '1K' }, costInTokens: 6.3,  costInDollars: 0.07,  label: 'Flex × 1K' },
          { conditions: { version: 'pro',  resolution: '2K' }, costInTokens: 3.15, costInDollars: 0.035, label: 'Pro × 2K' },
          { conditions: { version: 'pro',  resolution: '1K' }, costInTokens: 2.25, costInDollars: 0.025, label: 'Pro × 1K' },
        ],
        uiParameters: [
          {
            key: 'version', label: 'Версия модели', type: 'select', affectsPrice: true, defaultValue: 'flex',
            options: [
              { value: 'flex', label: 'Flex' },
              { value: 'pro', label: 'Pro' },
            ],
          },
          {
            key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '1K',
            options: [
              { value: '1K', label: '1K (1024×1024)' },
              { value: '2K', label: '2K (2048×2048)' },
            ],
          },
        ],
      },
      {
        slug: 'nano-banana-2',
        name: 'Nano Banana 2',
        displayName: 'Nano Banana 2',
        description: 'Стандартная версия Nano Banana (Gemini 3.1 Flash Image)',
        type: 'image',
        fixedCostPerGeneration: 0.04,
        tokensPerDollar: 90,
        minTokenCost: 3.6,
        sortOrder: 9,
        capabilities: [],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'nano-banana-2', priority: 1, isActive: true },
          { providerSlug: 'evolink', modelId: 'nano-banana', priority: 2, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '4096x4096' },
        inputCapabilities: { acceptsImages: true, maxInputImages: 14 },
        pricingMatrix: [
          { conditions: { resolution: '4K' }, costInTokens: 8.1, costInDollars: 0.09, label: '4K разрешение' },
          { conditions: { resolution: '2K' }, costInTokens: 5.4, costInDollars: 0.06, label: '2K разрешение' },
          { conditions: { resolution: '1K' }, costInTokens: 3.6, costInDollars: 0.04, label: '1K разрешение' },
        ],
        uiParameters: [
          {
            key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '1K',
            options: [
              { value: '1K', label: '1K (3.6🔥)' },
              { value: '2K', label: '2K (5.4🔥)' },
              { value: '4K', label: '4K (8.1🔥)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Соотношение сторон', type: 'select', affectsPrice: false, defaultValue: '1:1',
            options: [
              { value: '1:1', label: 'Квадрат (1:1)' },
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '4:3', label: 'Стандарт (4:3)' },
              { value: '3:4', label: 'Портрет (3:4)' },
            ],
          },
          {
            key: 'outputFormat', label: 'Формат файла', type: 'select', affectsPrice: false, defaultValue: 'png',
            options: [
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPEG' },
              { value: 'webp', label: 'WebP' },
            ],
          },
        ],
      },
      {
        slug: 'nano-banana-pro',
        name: 'Nano Banana Pro',
        displayName: 'Nano Banana Pro',
        description: 'Продвинутая версия Nano Banana с улучшенной детализацией',
        type: 'image',
        fixedCostPerGeneration: 0.09,
        tokensPerDollar: 90,
        minTokenCost: 8.1,
        sortOrder: 10,
        capabilities: ['high_quality'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'nano-banana-pro', priority: 1, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '4096x4096' },
        inputCapabilities: { acceptsImages: true, maxInputImages: 8 },
        pricingMatrix: [
          { conditions: { resolution: '4K' }, costInTokens: 10.8, costInDollars: 0.12, label: '4K разрешение' },
          { conditions: { resolution: '2K' }, costInTokens: 8.1,  costInDollars: 0.09, label: '2K разрешение' },
          { conditions: { resolution: '1K' }, costInTokens: 8.1,  costInDollars: 0.09, label: '1K разрешение' },
        ],
        uiParameters: [
          {
            key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '1K',
            options: [
              { value: '1K', label: '1K (8.1🔥)' },
              { value: '2K', label: '2K (8.1🔥)' },
              { value: '4K', label: '4K (10.8🔥)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Соотношение сторон', type: 'select', affectsPrice: false, defaultValue: '1:1',
            options: [
              { value: '1:1', label: 'Квадрат (1:1)' },
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '4:3', label: 'Стандарт (4:3)' },
              { value: '3:4', label: 'Портрет (3:4)' },
            ],
          },
          {
            key: 'outputFormat', label: 'Формат файла', type: 'select', affectsPrice: false, defaultValue: 'png',
            options: [
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPEG' },
              { value: 'webp', label: 'WebP' },
            ],
          },
        ],
      },

      // ════════════════════════════════════════════════════
      // VIDEO МОДЕЛИ
      // ════════════════════════════════════════════════════
      {
        slug: 'veo-3.1-fast',
        name: 'Veo 3.1 Fast',
        displayName: 'Google Veo 3.1 Fast',
        description: 'Быстрая версия Veo от Google',
        type: 'video',
        fixedCostPerGeneration: 0.15,
        tokensPerDollar: 50,
        minTokenCost: 32,
        sortOrder: 1,
        capabilities: ['text_to_video'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'veo-3.1-fast-generate-preview', priority: 1, isActive: true },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 8 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        pricingMatrix: [
          { costInTokens: 32, costInDollars: 0.32, label: 'Veo 3.1 Fast' },
        ],
        uiParameters: [
          {
            key: 'aspectRatio', label: 'Соотношение сторон', type: 'select', affectsPrice: false, defaultValue: '16:9',
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
            ],
          },
        ],
      },
      {
        slug: 'veo-3.1-pro',
        name: 'Veo 3.1 Pro',
        displayName: 'Google Veo 3.1 Pro',
        description: 'Премиум версия Veo от Google',
        type: 'video',
        fixedCostPerGeneration: 0.3,
        tokensPerDollar: 40,
        minTokenCost: 65,
        sortOrder: 2,
        isPremium: true,
        capabilities: ['text_to_video', 'high_quality'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'veo-3.1-generate-preview', priority: 1, isActive: true },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 10, includedInPlans: ['pro', 'unlimited'] },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        pricingMatrix: [
          { costInTokens: 65, costInDollars: 0.65, label: 'Veo 3.1 Pro' },
        ],
        uiParameters: [
          {
            key: 'aspectRatio', label: 'Соотношение сторон', type: 'select', affectsPrice: false, defaultValue: '16:9',
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
            ],
          },
        ],
      },
      {
        slug: 'sora-2-pro',
        name: 'Sora 2 Pro',
        displayName: 'OpenAI Sora 2 Pro',
        description: 'Флагманский генератор видео от OpenAI',
        type: 'video',
        fixedCostPerGeneration: 0.9583,
        tokensPerDollar: 30,
        minTokenCost: 200,
        sortOrder: 3,
        isPremium: true,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'sora-2-pro-preview', priority: 1, isActive: true },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 20, includedInPlans: ['unlimited'] },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        pricingMatrix: [
          { conditions: { duration: 15 }, costInTokens: 280, costInDollars: 2.8, label: '15 секунд' },
          { conditions: { duration: 10 }, costInTokens: 200, costInDollars: 2, label: '10 секунд' },
          { costInTokens: 200, costInDollars: 2, label: 'Стандарт (5 сек)' },
        ],
                uiParameters: [
          {
            key: 'duration', label: 'Длительность (сек)', type: 'select', affectsPrice: true, defaultValue: 5,
            options: [
              { value: 5, label: '5 сек (200🔥)' },
              { value: 10, label: '10 сек (200🔥)' },
              { value: 15, label: '15 сек (280🔥)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Соотношение сторон', type: 'select', affectsPrice: false, defaultValue: '16:9',
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
            ],
          },
        ],
      },
      {
        slug: 'kling-2.5-turbo-pro',
        name: 'Kling 2.5 Turbo Pro',
        displayName: 'Kling 2.5 Turbo Pro',
        description: 'Быстрый и качественный генератор видео Kling',
        type: 'video',
        fixedCostPerGeneration: 0.42,
        tokensPerDollar: 40,
        minTokenCost: 75,
        sortOrder: 4,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'kling/2.5-turbo-pro-text-to-video', priority: 1, isActive: true },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 10 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        pricingMatrix: [
          { conditions: { duration: 10 }, costInTokens: 135, costInDollars: 1.5, label: '10 секунд' },
          { conditions: { duration: 5 },  costInTokens: 75,  costInDollars: 0.84, label: '5 секунд' },
        ],
        uiParameters: [
          {
            key: 'duration', label: 'Длительность (сек)', type: 'select', affectsPrice: true, defaultValue: 5,
            options: [
              { value: 5, label: '5 сек (75🔥)' },
              { value: 10, label: '10 сек (135🔥)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Соотношение сторон', type: 'select', affectsPrice: false, defaultValue: '16:9',
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '1:1', label: 'Квадрат (1:1)' },
            ],
          },
        ],
      },
      {
        slug: 'kling-2.5-turbo-pro-img2video',
        name: 'Kling 2.5 Turbo Pro Img2Video',
        displayName: 'Kling 2.5 Turbo Pro (Image to Video)',
        description: 'Анимация изображений через Kling 2.5',
        type: 'video',
        fixedCostPerGeneration: 0.42,
        tokensPerDollar: 40,
        minTokenCost: 75,
        sortOrder: 5,
        capabilities: ['image_to_video'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'kling/2.5-turbo-pro-image-to-video', priority: 1, isActive: true },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 10 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        pricingMatrix: [
          { conditions: { duration: 10 }, costInTokens: 135, costInDollars: 1.5, label: '10 секунд' },
          { conditions: { duration: 5 },  costInTokens: 75,  costInDollars: 0.84, label: '5 секунд' },
        ],
        uiParameters: [
          {
            key: 'duration', label: 'Длительность (сек)', type: 'select', affectsPrice: true, defaultValue: 5,
            options: [
              { value: 5, label: '5 сек (75🔥)' },
              { value: 10, label: '10 сек (135🔥)' },
            ],
          },
        ],
      },
      {
        slug: 'wan-2.5',
        name: 'WAN 2.5',
        displayName: 'WAN 2.5 (Alibaba)',
        description: 'Видеогенератор от Alibaba',
        type: 'video',
        fixedCostPerGeneration: 0.4,
        tokensPerDollar: 40,
        minTokenCost: 70,
        sortOrder: 6,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'wan/2.5-text-to-video', priority: 1, isActive: true },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 10 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        pricingMatrix: [
          { conditions: { duration: 10 }, costInTokens: 130, costInDollars: 1.45, label: '10 секунд' },
          { conditions: { duration: 5 },  costInTokens: 70,  costInDollars: 0.78, label: '5 секунд' },
        ],
        uiParameters: [
          {
            key: 'duration', label: 'Длительность (сек)', type: 'select', affectsPrice: true, defaultValue: 5,
            options: [
              { value: 5, label: '5 сек (70🔥)' },
              { value: 10, label: '10 сек (130🔥)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Соотношение сторон', type: 'select', affectsPrice: false, defaultValue: '16:9',
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
            ],
          },
        ],
      },

      // ════════════════════════════════════════════════════
      // AUDIO МОДЕЛИ
      // ════════════════════════════════════════════════════
      {
        slug: 'suno-v5',
        name: 'Suno V5',
        displayName: 'Suno V5',
        description: 'Генератор музыки с вокалом',
        type: 'audio',
        fixedCostPerGeneration: 0.10,
        tokensPerDollar: 60,
        minTokenCost: 6,
        sortOrder: 1,
        capabilities: ['music_generation', 'vocal'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'suno/v5', priority: 1, isActive: true },
        ],
        defaultParams: { duration: 120 },
        limits: { maxDuration: 240 },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        pricingMatrix: [
          { costInTokens: 6, costInDollars: 0.10, label: 'Стандартный трек' },
        ],
        uiParameters: [
          {
            key: 'style', label: 'Стиль музыки', type: 'select', affectsPrice: false, defaultValue: 'pop',
            options: [
              { value: 'pop', label: 'Pop' },
              { value: 'rock', label: 'Rock' },
              { value: 'electronic', label: 'Electronic' },
              { value: 'jazz', label: 'Jazz' },
              { value: 'classical', label: 'Classical' },
              { value: 'hip-hop', label: 'Hip-Hop' },
            ],
          },
        ],
      },
    ];
  }
}