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
  //                  Используется для синхронизации БД после изменения тарифа.
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
        tokenCost = Math.max(
          modelData.minTokenCost,
          Math.ceil(fixedCostPerGeneration * (modelData.tokensPerDollar || 30)),
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
        slug: 'claude-opus-4.8',
        name: 'Claude Opus 4.8',
        displayName: 'Claude Opus 4.8',
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
          { providerSlug: 'evolink', modelId: 'claude-opus-4-8', priority: 1, isActive: true },
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
      // 📌 МЕДИА-МОДЕЛИ (image / video / audio)
      // ════════════════════════════════════════════════════
      // Сейчас в каталоге их НЕТ — они существуют только в БД
      // (созданы ранее или скриптами seed-*.js).
      //
      // ⚠️ FORCE_TEXT_PRICES_MIGRATION фильтрует по type === 'text',
      //    поэтому media-модели в БД НЕ затрагиваются — их цены,
      //    pricingMatrix и uiParameters остаются нетронутыми.
      //
      // 👉 Когда будем разбираться с media — добавим их сюда:
      //     gpt-5-image, gpt-image-1.5-lite, midjourney, seedream-5-lite,
      //     imagen-4, flux-2, nano-banana-2, nano-banana-pro,
      //     veo-3.1-fast/pro, sora-2/pro, kling-3.0, runway,
      //     hailuo-2.3, suno-v4, elevenlabs-*
    ];
  }
}