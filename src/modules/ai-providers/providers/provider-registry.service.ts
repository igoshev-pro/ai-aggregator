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

      const costPerMillionInputTokens =
        (modelData as any).costPerMillionInputTokens ?? 0;
      const costPerMillionOutputTokens =
        (modelData as any).costPerMillionOutputTokens ?? 0;
      const fixedCostPerGeneration =
        (modelData as any).fixedCostPerGeneration ?? 0;

      let tokenCost = modelData.minTokenCost;
      if (modelData.type === 'text') {
        const avgCost = (costPerMillionInputTokens + costPerMillionOutputTokens) / 2;
        tokenCost = Math.max(
          modelData.minTokenCost,
          Math.ceil((avgCost * modelData.tokensPerDollar) / 1000),
        );
      } else {
        tokenCost = Math.max(
          modelData.minTokenCost,
          Math.ceil(fixedCostPerGeneration * modelData.tokensPerDollar),
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

      // ─── ONE-TIME MIGRATION (старая) ───
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
      // Перезаписывает minTokenCost, tokenCost и цены за 1M токенов
      // на актуальные значения из каталога.
      if (FORCE_TEXT_PRICES_MIGRATION && modelData.type === 'text') {
        await this.modelModel.updateOne(
          { slug },
          {
            $set: {
              minTokenCost: modelData.minTokenCost,
              tokenCost,
              costPerMillionInputTokens,
              costPerMillionOutputTokens,
              tokensPerDollar: modelData.tokensPerDollar,
              isPremium: (modelData as any).isPremium ?? false,
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
  // Цены текстовых моделей: minTokenCost = минимальная стоимость
  // одного короткого запроса (~50 токенов) в спичках.
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
        // 🆕 цена: от 0.1 🔥
        costPerMillionInputTokens: 0.039,
        costPerMillionOutputTokens: 0.19,
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
        // 🆕 цена: от 0.5 🔥
        costPerMillionInputTokens: 1.0,
        costPerMillionOutputTokens: 5.0,
        tokensPerDollar: 1000,
        minTokenCost: 0.5,
        sortOrder: 2,
        capabilities: ['streaming', 'vision', 'thinking'],
        providerMappings: [
          { providerSlug: 'openrouter', modelId: 'anthropic/claude-haiku-4.5', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 200000, maxOutputTokens: 8192 },
      },
            {
        slug: 'deepseek-v3.2',
        name: 'DeepSeek V3.2',
        displayName: 'DeepSeek V3.2',
        description: 'Улучшенная версия DeepSeek с DSA и reasoning',
        type: 'text',
        // 🆕 цена: от 0.1 🔥
        costPerMillionInputTokens: 0.26,
        costPerMillionOutputTokens: 0.38,
        tokensPerDollar: 1000,
        minTokenCost: 0.1,
        sortOrder: 3,
        capabilities: ['streaming', 'reasoning'],
        providerMappings: [
          { providerSlug: 'openrouter', modelId: 'deepseek/deepseek-v3.2', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 164000, maxOutputTokens: 8192 },
      },
      {
        slug: 'grok-4.20',
        name: 'Grok 4.20',
        displayName: 'Grok 4.20',
        description: 'Быстрая версия Grok от xAI',
        type: 'text',
        // 🆕 цена: от 0.3 🔥 (не было в твоём списке, оставил умеренную)
        costPerMillionInputTokens: 0.20,
        costPerMillionOutputTokens: 0.50,
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
        // 🆕 цена: от 1.2 🔥 (соответствует "Grok 4.3" из ТЗ)
        costPerMillionInputTokens: 3.0,
        costPerMillionOutputTokens: 15.0,
        tokensPerDollar: 1000,
        minTokenCost: 1.2,
        sortOrder: 5,
        isPremium: true,
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
        // 🆕 цена: от 1.0 🔥
        costPerMillionInputTokens: 1.0,
        costPerMillionOutputTokens: 1.0,
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
        // 🆕 цена: от 0.8 🔥
        costPerMillionInputTokens: 14.0,
        costPerMillionOutputTokens: 14.0,
        tokensPerDollar: 1000,
        minTokenCost: 0.8,
        sortOrder: 7,
        isPremium: true,
        capabilities: ['streaming', 'vision', 'function_calling'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'gpt-5.4', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 128000, maxOutputTokens: 16384, includedInPlans: ['unlimited'] },
      },
      {
        slug: 'claude-opus-4.6',
        name: 'Claude Opus 4.6',
        displayName: 'Claude Opus 4.6',
        description: 'Самая мощная модель Anthropic',
        type: 'text',
        // 🆕 цена: от 1.5 🔥 (соответствует "Claude Opus 4.7" из ТЗ)
        costPerMillionInputTokens: 25.382,
        costPerMillionOutputTokens: 25.382,
        tokensPerDollar: 1000,
        minTokenCost: 1.5,
        sortOrder: 8,
        isPremium: true,
        capabilities: ['streaming', 'vision', 'thinking'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'claude-opus-4-6', priority: 1, isActive: true },
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
        // 🆕 цена: от 0.8 🔥
        costPerMillionInputTokens: 15.3,
        costPerMillionOutputTokens: 15.3,
        tokensPerDollar: 1000,
        minTokenCost: 0.8,
        sortOrder: 9,
        isPremium: true,
        capabilities: ['streaming', 'vision', 'thinking'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'claude-sonnet-4-6', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 200000, maxOutputTokens: 8192, includedInPlans: ['pro', 'unlimited'] },
      },
      {
        slug: 'deepseek-v4',
        name: 'DeepSeek V4',
        displayName: 'DeepSeek V4',
        description: 'Новейшая модель DeepSeek (появится в ближайшее время)',
        type: 'text',
        // 🆕 цена: от 0.2 🔥 (как "DeepSeek V4 Pro" из ТЗ)
        costPerMillionInputTokens: 0.26,
        costPerMillionOutputTokens: 1.0,
        tokensPerDollar: 1000,
        minTokenCost: 0.2,
        sortOrder: 10,
        capabilities: ['streaming', 'reasoning', 'function_calling'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'deepseek-v4-pro', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 164000, maxOutputTokens: 8192 },
      },
      {
        slug: 'gemini-3.1-pro',
        name: 'Gemini 3.1 Pro',
        displayName: 'Gemini 3.1 Pro',
        description: 'Продвинутая модель Google',
        type: 'text',
        // 🆕 цена: от 0.2 🔥
        costPerMillionInputTokens: 4.0,
        costPerMillionOutputTokens: 4.0,
        tokensPerDollar: 1000,
        minTokenCost: 0.2,
        sortOrder: 11,
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
        // 🆕 цена: от 0.1 🔥
        costPerMillionInputTokens: 1.05,
        costPerMillionOutputTokens: 1.05,
        tokensPerDollar: 1000,
        minTokenCost: 0.1,
        sortOrder: 12,
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
        costPerMillionInputTokens: 2.5,
        costPerMillionOutputTokens: 10.0,
        tokensPerDollar: 1000,
        minTokenCost: 0.3,
        sortOrder: 13,
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
        costPerMillionInputTokens: 0.15,
        costPerMillionOutputTokens: 0.6,
        tokensPerDollar: 1000,
        minTokenCost: 0.1,
        sortOrder: 14,
        capabilities: ['streaming', 'vision', 'function_calling'],
        providerMappings: [
          { providerSlug: 'openrouter', modelId: 'openai/gpt-4o-mini', priority: 1, isActive: true },
          { providerSlug: 'evolink', modelId: 'gpt-4o-mini', priority: 2, isActive: true },
        ],
        defaultParams: { maxTokens: 4096, temperature: 0.7 },
        limits: { maxInputTokens: 128000, maxOutputTokens: 16384 },
      },

      // ════════════════════════════════════════════════════
      // 📌 Остальные модели (image / video / audio) без изменений
      // Сохрани из оригинала всё начиная с { slug: 'gpt-5-image', ... }
      // и до конца массива. Структуру и цены этих моделей я НЕ трогаю.
      // ════════════════════════════════════════════════════

      // ↓↓↓ ВСТАВЬ СЮДА свой оригинальный код моделей:
      //     gpt-5-image, gpt-image-1.5-lite, midjourney, midjourney-img2img,
      //     seedream-5-lite, imagen-4, flux-2, flux-2-img2img,
      //     nano-banana-2, nano-banana-pro,
      //     veo-3.1-fast, veo-3.1-pro, sora-2-pro, sora-2, sora-2-img2vid,
      //     kling-3.0, kling-3.0-img2vid, kling-3.0-motion,
      //     runway, hailuo-2.3-standard, hailuo-2.3-pro,
      //     suno-v4, elevenlabs-tts-turbo, elevenlabs-tts-multilingual,
      //     elevenlabs-dialogue, elevenlabs-isolation, elevenlabs-stt, elevenlabs-sfx
    ];
  }
}