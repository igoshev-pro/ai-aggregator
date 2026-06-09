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
  ) { }

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
        webSearchCostInTokens: (modelData as any).webSearchCostInTokens ?? 0,  // 🆕
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
              webSearchCostInTokens: (modelData as any).webSearchCostInTokens ?? 0,  // 🆕
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
        pricePerMillionInputTokens: 90,
        pricePerMillionOutputTokens: 90,
        providerCostPerMillionInput: 1.0,
        providerCostPerMillionOutput: 1.0,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 1000,

        // 🆕 НАДБАВКА ЗА WEB SEARCH
        // OpenRouter: $0.005/запрос × 90 (наценка ×3, курс 90₽/$, ÷3₽/спичка) = 0.45🔥
        webSearchCostInTokens: 0.45,

        // 🆕 minTokenCost поднимаем, чтобы покрыть поиск + минимум токенов
        // было 1 → должно покрывать хотя бы стоимость поиска + базу
        minTokenCost: 1.5,

        sortOrder: 6,
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
      // IMAGE МОДЕЛИ  (фикс цены по новой таблице, в спичках 🔥)
      // ════════════════════════════════════════════════════
      {
        slug: 'gpt-5-image',
        name: 'GPT-5 Image 2',
        displayName: 'GPT-5 Image 2',
        description: 'Новейший генератор изображений OpenAI (GPT Image 2)',
        type: 'image',
        fixedCostPerGeneration: 0.03, // справочно (1K)
        tokensPerDollar: 90,
        minTokenCost: 2.7,
        sortOrder: 1,
        capabilities: ['text_rendering', 'image_editing'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'gpt-image-2-text-to-image', priority: 1, isActive: true },
        ],
        // kie ждёт aspect_ratio + resolution
        defaultParams: { aspect_ratio: 'auto', resolution: '1K' },
        limits: { maxResolution: '4096x4096' },
        inputCapabilities: { acceptsImages: true, maxInputImages: 4 },
        // Фикс цены: 1K=2.7, 2K=4.5, 4K=7.2
        pricingMatrix: [
          { conditions: { resolution: '4K' }, costInTokens: 7.2, costInDollars: 0.08, label: '4K разрешение' },
          { conditions: { resolution: '2K' }, costInTokens: 4.5, costInDollars: 0.05, label: '2K разрешение' },
          { conditions: { resolution: '1K' }, costInTokens: 2.7, costInDollars: 0.03, label: '1K разрешение' },
        ],
        uiParameters: [
          {
            key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '1K',
            options: [
              { value: '1K', label: '1K (2.7🔥)' },
              { value: '2K', label: '2K (4.5🔥)' },
              { value: '4K', label: '4K (7.2🔥)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Соотношение сторон', type: 'select', affectsPrice: false, defaultValue: '1:1',
            // ⚠️ 1:1 нельзя конвертировать в 4K; auto/без AR → только 1K (ограничение kie)
            options: [
              { value: '1:1', label: 'Квадрат (1:1)' },
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '3:2', label: 'Фото (3:2)' },
              { value: '2:3', label: 'Портрет (2:3)' },
              { value: '4:3', label: 'Стандарт (4:3)' },
              { value: '3:4', label: 'Портрет (3:4)' },
            ],
          },
        ],
      },
      {
        slug: 'imagen-4-ultra',
        name: 'Imagen 4 Ultra',
        displayName: 'Google Imagen 4 Ultra',
        description: 'Топовый генератор изображений от Google (Imagen 4 Ultra)',
        type: 'image',
        fixedCostPerGeneration: 0.04, // справочно
        tokensPerDollar: 90,
        minTokenCost: 3.6,
        sortOrder: 2,
        capabilities: ['text_to_image'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'google/imagen4-ultra', priority: 1, isActive: true },
        ],
        defaultParams: { aspect_ratio: '1:1' },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        // Фикс цена: 3.6🔥
        pricingMatrix: [
          { costInTokens: 3.6, costInDollars: 0.04, label: 'Стандартная генерация' },
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
        slug: 'midjourney',
        name: 'Midjourney',
        displayName: 'Midjourney V7',
        description: 'Лучший генератор изображений',
        type: 'image',
        fixedCostPerGeneration: 0.015, // справочно (обычный режим)
        tokensPerDollar: 90,
        minTokenCost: 1.3, // ← минимальная строка матрицы (обычный)
        sortOrder: 3,
        capabilities: ['variations', 'upscale'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'mj-v7', priority: 1, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        // Таблица: Обычный 1.3, Быстрый 3, Турбо 5.7
        // ⚠️ evolink ждёт model_params.speed = draft|fast|turbo — провайдер маппит mode → speed
        pricingMatrix: [
          { conditions: { mode: 'turbo' }, costInTokens: 5.7, costInDollars: 0.08, label: 'Турбо режим' },
          { conditions: { mode: 'fast' }, costInTokens: 3, costInDollars: 0.04, label: 'Быстрый режим' },
          { conditions: { mode: 'draft' }, costInTokens: 1.3, costInDollars: 0.015, label: 'Обычный режим' },
        ],
        uiParameters: [
          {
            key: 'mode', label: 'Режим генерации', type: 'select', affectsPrice: true, defaultValue: 'draft',
            options: [
              { value: 'draft', label: 'Обычный (1.3🔥)' },
              { value: 'fast', label: 'Быстрый (3🔥, ~30 сек)' },
              { value: 'turbo', label: 'Турбо (5.7🔥, ~15 сек)' },
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
        fixedCostPerGeneration: 0.015, // справочно (обычный режим)
        tokensPerDollar: 90,
        minTokenCost: 1.3, // ← минимальная строка матрицы (обычный)
        sortOrder: 4,
        capabilities: ['image_to_image', 'variations'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'mj-v7', priority: 1, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        // Таблица: Обычный 1.3, Быстрый 3, Турбо 5.7
        pricingMatrix: [
          { conditions: { mode: 'turbo' }, costInTokens: 5.7, costInDollars: 0.08, label: 'Турбо режим' },
          { conditions: { mode: 'fast' }, costInTokens: 3, costInDollars: 0.04, label: 'Быстрый режим' },
          { conditions: { mode: 'draft' }, costInTokens: 1.3, costInDollars: 0.015, label: 'Обычный режим' },
        ],
        uiParameters: [
          {
            key: 'mode', label: 'Режим генерации', type: 'select', affectsPrice: true, defaultValue: 'draft',
            options: [
              { value: 'draft', label: 'Обычный (1.3🔥)' },
              { value: 'fast', label: 'Быстрый (3🔥)' },
              { value: 'turbo', label: 'Турбо (5.7🔥)' },
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
        fixedCostPerGeneration: 0.0178, // справочно
        tokensPerDollar: 90,
        minTokenCost: 1.6,
        sortOrder: 5,
        capabilities: [],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'seedream/5-lite-text-to-image', priority: 1, isActive: true },
          { providerSlug: 'evolink', modelId: 'seedream', priority: 2, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        // Фикс цена: 1.6🔥
        pricingMatrix: [
          { costInTokens: 1.6, costInDollars: 0.0178, label: 'Стандартная генерация' },
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
        displayName: 'Google Imagen 4 Fast',
        description: 'Быстрый генератор изображений от Google',
        type: 'image',
        fixedCostPerGeneration: 0.0133, // справочно
        tokensPerDollar: 90,
        minTokenCost: 1.2,
        sortOrder: 6,
        capabilities: [],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'google/imagen4-fast', priority: 1, isActive: true },
          { providerSlug: 'evolink', modelId: 'imagen-3', priority: 2, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        // Фикс цена: 1.2🔥
        pricingMatrix: [
          { costInTokens: 1.2, costInDollars: 0.0133, label: 'Стандартная генерация' },
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
        minTokenCost: 1.8, // ← минимальная строка матрицы (Pro × 1K)
        sortOrder: 7,
        capabilities: ['text_to_image', 'image_to_image'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'flux-2/flex-text-to-image', priority: 1, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024, steps: 28 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        // Таблица: Flex 1K=5, Flex 2K=7.5, Pro 1K=1.8, Pro 2K=2
        pricingMatrix: [
          { conditions: { version: 'flex', resolution: '2K' }, costInTokens: 7.5, costInDollars: 0.12, label: 'Flex × 2K' },
          { conditions: { version: 'flex', resolution: '1K' }, costInTokens: 5, costInDollars: 0.07, label: 'Flex × 1K' },
          { conditions: { version: 'pro', resolution: '2K' }, costInTokens: 2, costInDollars: 0.035, label: 'Pro × 2K' },
          { conditions: { version: 'pro', resolution: '1K' }, costInTokens: 1.8, costInDollars: 0.025, label: 'Pro × 1K' },
        ],
        uiParameters: [
          {
            key: 'version', label: 'Версия модели', type: 'select', affectsPrice: true, defaultValue: 'pro',
            options: [
              { value: 'flex', label: 'Flex (от 5🔥)' },
              { value: 'pro', label: 'Pro (от 1.8🔥)' },
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
        minTokenCost: 1.8, // ← минимальная строка матрицы (Pro × 1K)
        sortOrder: 8,
        capabilities: ['image_to_image'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'flux-2/flex-image-to-image', priority: 1, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024, steps: 28 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: true, maxInputImages: 8 },
        // Таблица: Flex 1K=5, Flex 2K=7.5, Pro 1K=1.8, Pro 2K=2
        pricingMatrix: [
          { conditions: { version: 'flex', resolution: '2K' }, costInTokens: 7.5, costInDollars: 0.12, label: 'Flex × 2K' },
          { conditions: { version: 'flex', resolution: '1K' }, costInTokens: 5, costInDollars: 0.07, label: 'Flex × 1K' },
          { conditions: { version: 'pro', resolution: '2K' }, costInTokens: 2, costInDollars: 0.035, label: 'Pro × 2K' },
          { conditions: { version: 'pro', resolution: '1K' }, costInTokens: 1.8, costInDollars: 0.025, label: 'Pro × 1K' },
        ],
        uiParameters: [
          {
            key: 'version', label: 'Версия модели', type: 'select', affectsPrice: true, defaultValue: 'pro',
            options: [
              { value: 'flex', label: 'Flex (от 5🔥)' },
              { value: 'pro', label: 'Pro (от 1.8🔥)' },
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
        minTokenCost: 3.3, // ← минимальная строка матрицы (1K)
        sortOrder: 9,
        capabilities: [],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'nano-banana-2', priority: 1, isActive: true },
          { providerSlug: 'evolink', modelId: 'nano-banana', priority: 2, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '4096x4096' },
        inputCapabilities: { acceptsImages: true, maxInputImages: 14 },
        // Таблица: 1K=3.3, 2K=4, 4K=6
        pricingMatrix: [
          { conditions: { resolution: '4K' }, costInTokens: 6, costInDollars: 0.09, label: '4K разрешение' },
          { conditions: { resolution: '2K' }, costInTokens: 4, costInDollars: 0.06, label: '2K разрешение' },
          { conditions: { resolution: '1K' }, costInTokens: 3.3, costInDollars: 0.04, label: '1K разрешение' },
        ],
        uiParameters: [
          {
            key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '1K',
            options: [
              { value: '1K', label: '1K (3.3🔥)' },
              { value: '2K', label: '2K (4🔥)' },
              { value: '4K', label: '4K (6🔥)' },
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
        minTokenCost: 6, // ← минимальная строка матрицы (1K/2K)
        sortOrder: 10,
        capabilities: ['high_quality'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'nano-banana-pro', priority: 1, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '4096x4096' },
        inputCapabilities: { acceptsImages: true, maxInputImages: 8 },
        // Таблица: 1K=6, 2K=6, 4K=7.7
        pricingMatrix: [
          { conditions: { resolution: '4K' }, costInTokens: 7.7, costInDollars: 0.12, label: '4K разрешение' },
          { conditions: { resolution: '2K' }, costInTokens: 6, costInDollars: 0.09, label: '2K разрешение' },
          { conditions: { resolution: '1K' }, costInTokens: 6, costInDollars: 0.09, label: '1K разрешение' },
        ],
        uiParameters: [
          {
            key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '1K',
            options: [
              { value: '1K', label: '1K (6🔥)' },
              { value: '2K', label: '2K (6🔥)' },
              { value: '4K', label: '4K (7.7🔥)' },
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
        fixedCostPerGeneration: 0.1681, // справочно (720p 8сек)
        tokensPerDollar: 90,
        minTokenCost: 15, // ← минимальная строка (720p/1080p)
        sortOrder: 1,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'veo-3.1-fast-generate-preview', priority: 1, isActive: true },
        ],
        // API: quality (720p/1080p/4k), duration (4/6/8), aspect_ratio (auto/16:9/9:16)
        defaultParams: { duration: 8, quality: '720p', aspect_ratio: 'auto' },
        limits: { maxDuration: 8 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        // Таблица: 720p/1080p 8сек = 15, 4K 8сек = 45.3
        pricingMatrix: [
          { conditions: { quality: '4k' }, costInTokens: 45.3, costInDollars: 0.5042, label: '4K (8 сек)' },
          { conditions: { quality: '1080p' }, costInTokens: 15, costInDollars: 0.1681, label: '1080p (8 сек)' },
          { conditions: { quality: '720p' }, costInTokens: 15, costInDollars: 0.1681, label: '720p (8 сек)' },
        ],
        uiParameters: [
          {
            key: 'quality', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '720p',
            options: [
              { value: '720p', label: '720p (15🔥)' },
              { value: '1080p', label: '1080p (15🔥)' },
              { value: '4k', label: '4K (45.3🔥)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Соотношение сторон', type: 'select', affectsPrice: false, defaultValue: '16:9',
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
            ],
          },
          {
            key: 'generateAudio', label: 'Со звуком', type: 'select', affectsPrice: false, defaultValue: true,
            options: [
              { value: true, label: 'Да' },
              { value: false, label: 'Нет' },
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
        fixedCostPerGeneration: 0.8333, // справочно (720p 8сек)
        tokensPerDollar: 90,
        minTokenCost: 75, // ← минимальная строка (720p/1080p)
        sortOrder: 2,
        isPremium: true,
        capabilities: ['text_to_video', 'image_to_video', 'high_quality'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'veo-3.1-generate-preview', priority: 1, isActive: true },
        ],
        // API: quality (720p/1080p/4k), duration (4/6/8), aspect_ratio (auto/16:9/9:16)
        defaultParams: { duration: 8, quality: '720p', aspect_ratio: 'auto' },
        limits: { maxDuration: 8, includedInPlans: ['pro', 'unlimited'] },
        inputCapabilities: { acceptsImages: true, maxInputImages: 2 },
        // Таблица: 720p/1080p 8сек = 75, 4K 8сек = 112
        pricingMatrix: [
          { conditions: { quality: '4k' }, costInTokens: 112, costInDollars: 1.25, label: '4K (8 сек)' },
          { conditions: { quality: '1080p' }, costInTokens: 75, costInDollars: 0.8333, label: '1080p (8 сек)' },
          { conditions: { quality: '720p' }, costInTokens: 75, costInDollars: 0.8333, label: '720p (8 сек)' },
        ],
        uiParameters: [
          {
            key: 'quality', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '720p',
            options: [
              { value: '720p', label: '720p (75🔥)' },
              { value: '1080p', label: '1080p (75🔥)' },
              { value: '4k', label: '4K (112🔥)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Соотношение сторон', type: 'select', affectsPrice: false, defaultValue: '16:9',
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
            ],
          },
          {
            key: 'generateAudio', label: 'Со звуком', type: 'select', affectsPrice: false, defaultValue: true,
            options: [
              { value: true, label: 'Да' },
              { value: false, label: 'Нет' },
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
        tokensPerDollar: 90,
        minTokenCost: 86, // ← минимальная строка (720p)
        sortOrder: 3,
        isPremium: true,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'sora-2-pro-preview', priority: 1, isActive: true },
        ],
        // API: duration (4/8/12), quality (720p/1080p ×1.667), aspect_ratio (16:9/9:16)
        defaultParams: { duration: 12, quality: '720p', aspect_ratio: '16:9' },
        limits: { maxDuration: 12, includedInPlans: ['unlimited'] },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        // Таблица: 86🔥. 1080p = ×1.667 → 143
        pricingMatrix: [
          { conditions: { quality: '1080p' }, costInTokens: 143, costInDollars: 1.598, label: '1080p HD' },
          { conditions: { quality: '720p' }, costInTokens: 86, costInDollars: 0.9583, label: '720p Standard' },
        ],
        uiParameters: [
          {
            key: 'quality', label: 'Качество', type: 'select', affectsPrice: true, defaultValue: '720p',
            options: [
              { value: '720p', label: '720p (86🔥)' },
              { value: '1080p', label: '1080p HD (143🔥)' },
            ],
          },
          {
            key: 'duration', label: 'Длительность (сек)', type: 'select', affectsPrice: false, defaultValue: 12,
            options: [
              { value: 4, label: '4 сек' },
              { value: 8, label: '8 сек' },
              { value: 12, label: '12 сек' },
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
        tokensPerDollar: 90,
        minTokenCost: 21.5, // ← минимальная строка (5 сек × 4.3)
        sortOrder: 4,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'kling/v2-5-turbo-text-to-video-pro', priority: 1, isActive: true },
        ],
        // API kie: duration '5'/'10' (STRING), aspect_ratio 16:9/9:16/1:1, cfg_scale
        defaultParams: { duration: '5', aspect_ratio: '16:9', cfg_scale: 0.5 },
        limits: { maxDuration: 10 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        // Таблица Kling 3.0: 4.3🔥/сек → 5сек=21.5, 10сек=43
        pricingMatrix: [
          { conditions: { duration: '10' }, costInTokens: 43, costInDollars: 0.7, label: '10 секунд' },
          { conditions: { duration: '5' }, costInTokens: 21.5, costInDollars: 0.35, label: '5 секунд' },
          // fallback на числовой тип, если фронт шлёт number
          { conditions: { duration: 10 }, costInTokens: 43, costInDollars: 0.7, label: '10 секунд' },
          { conditions: { duration: 5 }, costInTokens: 21.5, costInDollars: 0.35, label: '5 секунд' },
        ],
        uiParameters: [
          {
            key: 'duration', label: 'Длительность (сек)', type: 'select', affectsPrice: true, defaultValue: '5',
            options: [
              { value: '5', label: '5 сек (21.5🔥)' },
              { value: '10', label: '10 сек (43🔥)' },
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
        tokensPerDollar: 90,
        minTokenCost: 21.5, // ← минимальная строка (5 сек × 4.3)
        sortOrder: 5,
        capabilities: ['image_to_video'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'kling/v2-5-turbo-image-to-video-pro', priority: 1, isActive: true },
        ],
        // API kie: duration '5'/'10' (STRING), cfg_scale, image_url
        defaultParams: { duration: '5', cfg_scale: 0.5 },
        limits: { maxDuration: 10 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        // Таблица Kling 3.0: 4.3🔥/сек → 5сек=21.5, 10сек=43
        pricingMatrix: [
          { conditions: { duration: '10' }, costInTokens: 43, costInDollars: 0.7, label: '10 секунд' },
          { conditions: { duration: '5' }, costInTokens: 21.5, costInDollars: 0.35, label: '5 секунд' },
          { conditions: { duration: 10 }, costInTokens: 43, costInDollars: 0.7, label: '10 секунд' },
          { conditions: { duration: 5 }, costInTokens: 21.5, costInDollars: 0.35, label: '5 секунд' },
        ],
        uiParameters: [
          {
            key: 'duration', label: 'Длительность (сек)', type: 'select', affectsPrice: true, defaultValue: '5',
            options: [
              { value: '5', label: '5 сек (21.5🔥)' },
              { value: '10', label: '10 сек (43🔥)' },
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
        tokensPerDollar: 90,
        minTokenCost: 70, // ← минимальная строка (720p 5сек)
        sortOrder: 6,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'wan/2-5-text-to-video', priority: 1, isActive: true },
        ],
        // API kie: duration '5'/'10' (STRING), resolution 720p/1080p, aspect_ratio 16:9/9:16/1:1
        defaultParams: { duration: '5', resolution: '720p', aspect_ratio: '16:9' },
        limits: { maxDuration: 10 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        // Нет в таблице → 720p: 5сек=70, 10сек=130; 1080p: 5сек=105, 10сек=200
        pricingMatrix: [
          { conditions: { resolution: '1080p', duration: '10' }, costInTokens: 200, costInDollars: 2.2, label: '1080p × 10 сек' },
          { conditions: { resolution: '1080p', duration: '5' }, costInTokens: 105, costInDollars: 1.16, label: '1080p × 5 сек' },
          { conditions: { resolution: '720p', duration: '10' }, costInTokens: 130, costInDollars: 1.45, label: '720p × 10 сек' },
          { conditions: { resolution: '720p', duration: '5' }, costInTokens: 70, costInDollars: 0.78, label: '720p × 5 сек' },
        ],
        uiParameters: [
          {
            key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '720p',
            options: [
              { value: '720p', label: '720p' },
              { value: '1080p', label: '1080p' },
            ],
          },
          {
            key: 'duration', label: 'Длительность (сек)', type: 'select', affectsPrice: true, defaultValue: '5',
            options: [
              { value: '5', label: '5 сек' },
              { value: '10', label: '10 сек' },
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