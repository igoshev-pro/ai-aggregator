// src/modules/ai-providers/provider-registry.service.ts
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
  //   ONE-TIME MIGRATION — для существующих моделей БЕЗ pricingMatrix
  //                  применяется один раз: добавляет матрицу/UI-параметры
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

      // $setOnInsert — только при первом создании (цены, матрицы, isActive)
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

      // ─── ONE-TIME MIGRATION ───
      // Если модель уже существовала, но не имеет pricingMatrix/uiParameters
      // (наследие до Итерации 2) — заливаем матрицу из сида ОДИН РАЗ.
      // После этого админка/ручные правки управляют этими полями.
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
    }

    this.logger.log(
      `🌱 Models synced — created: ${created}, updated: ${updated}, migrated: ${migrated}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // КАТАЛОГ МОДЕЛЕЙ — данные для seed
  // ═══════════════════════════════════════════════════════════════
  private buildModelsCatalog(): any[] {
    return [
      // ════════════════════════════════════════════════════
      // ТЕКСТОВЫЕ МОДЕЛИ (без матриц — цена по токенам стрима)
      // ════════════════════════════════════════════════════
      {
        slug: 'gpt-oss-120b',
        name: 'GPT-OSS 120B',
        displayName: 'GPT-OSS 120B',
        description: 'Open-source 117B MoE model, оптимизирована для H100',
        type: 'text',
        costPerMillionInputTokens: 0.039,
        costPerMillionOutputTokens: 0.19,
        tokensPerDollar: 1000,
        minTokenCost: 0.5,
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
        costPerMillionInputTokens: 1.0,
        costPerMillionOutputTokens: 5.0,
        tokensPerDollar: 1000,
        minTokenCost: 1,
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
        costPerMillionInputTokens: 0.26,
        costPerMillionOutputTokens: 0.38,
        tokensPerDollar: 1000,
        minTokenCost: 0.5,
        sortOrder: 3,
        capabilities: ['streaming', 'reasoning'],
        providerMappings: [
          { providerSlug: 'openrouter', modelId: 'deepseek/deepseek-v3.2', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 164000, maxOutputTokens: 8192 },
      },
      {
        slug: 'grok-4.1-fast',
        name: 'Grok 4.1 Fast',
        displayName: 'Grok 4.1 Fast',
        description: 'Быстрая версия Grok от xAI',
        type: 'text',
        costPerMillionInputTokens: 0.20,
        costPerMillionOutputTokens: 0.50,
        tokensPerDollar: 1000,
        minTokenCost: 0.5,
        sortOrder: 4,
        capabilities: ['streaming', 'reasoning', 'function_calling'],
        providerMappings: [
          { providerSlug: 'openrouter', modelId: 'x-ai/grok-4.1-fast', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 4096, temperature: 0.7 },
        limits: { maxInputTokens: 2000000, maxOutputTokens: 4096 },
      },
      {
        slug: 'grok-4',
        name: 'Grok 4',
        displayName: 'Grok 4',
        description: 'Флагманская reasoning модель от xAI',
        type: 'text',
        costPerMillionInputTokens: 3.0,
        costPerMillionOutputTokens: 15.0,
        tokensPerDollar: 1000,
        minTokenCost: 3,
        sortOrder: 5,
        isPremium: true,
        capabilities: ['streaming', 'reasoning', 'vision'],
        providerMappings: [
          { providerSlug: 'openrouter', modelId: 'x-ai/grok-4', priority: 1, isActive: true },
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
        costPerMillionInputTokens: 1.0,
        costPerMillionOutputTokens: 1.0,
        tokensPerDollar: 1000,
        minTokenCost: 1,
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
        costPerMillionInputTokens: 14.0,
        costPerMillionOutputTokens: 14.0,
        tokensPerDollar: 1000,
        minTokenCost: 10,
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
        costPerMillionInputTokens: 25.382,
        costPerMillionOutputTokens: 25.382,
        tokensPerDollar: 1000,
        minTokenCost: 15,
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
        costPerMillionInputTokens: 15.3,
        costPerMillionOutputTokens: 15.3,
        tokensPerDollar: 1000,
        minTokenCost: 8,
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
        costPerMillionInputTokens: 0.26,
        costPerMillionOutputTokens: 1.0,
        tokensPerDollar: 1000,
        minTokenCost: 1,
        sortOrder: 10,
        capabilities: ['streaming', 'reasoning', 'function_calling'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'deepseek-chat', priority: 1, isActive: false },
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
        costPerMillionInputTokens: 4.0,
        costPerMillionOutputTokens: 4.0,
        tokensPerDollar: 1000,
        minTokenCost: 3,
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
        costPerMillionInputTokens: 1.05,
        costPerMillionOutputTokens: 1.05,
        tokensPerDollar: 1000,
        minTokenCost: 1,
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
        minTokenCost: 3,
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
        minTokenCost: 1,
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
      // МОДЕЛИ ИЗОБРАЖЕНИЙ — с pricingMatrix + uiParameters
      // ════════════════════════════════════════════════════
      {
        slug: 'gpt-5-image',
        name: 'GPT-5 Image',
        displayName: 'GPT-5 Image',
        description: 'Новейший генератор изображений OpenAI',
        type: 'image',
        fixedCostPerGeneration: 0.04,
        tokensPerDollar: 100,
        minTokenCost: 5,
        sortOrder: 1,
        capabilities: ['text_rendering', 'image_editing'],
        providerMappings: [
          { providerSlug: 'openrouter-image', modelId: 'openai/gpt-5-image', priority: 1, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: true, maxInputImages: 4 },
        pricingMatrix: [
          {
            conditions: { quality: 'hd' },
            costInTokens: 12,
            costInDollars: 0.08,
            label: 'HD качество',
          },
          {
            conditions: { quality: 'standard' },
            costInTokens: 9,
            costInDollars: 0.04,
            label: 'Стандартное качество',
          },
        ],
        uiParameters: [
          {
            key: 'quality',
            label: 'Качество',
            type: 'select',
            defaultValue: 'standard',
            affectsPrice: true,
            options: [
              { value: 'standard', label: 'Стандарт (9🔥)' },
              { value: 'hd', label: 'HD (12🔥)' },
            ],
          },
          {
            key: 'aspectRatio',
            label: 'Соотношение сторон',
            type: 'select',
            defaultValue: '1:1',
            affectsPrice: false,
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
        fixedCostPerGeneration: 0.0125,
        tokensPerDollar: 100,
        minTokenCost: 2,
        sortOrder: 2,
        capabilities: ['text_to_image', 'image_editing'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'gpt-image-1.5', priority: 1, isActive: true },
        ],
        defaultParams: { aspectRatio: '1:1' },
        limits: { maxResolution: '1536x1024' },
        inputCapabilities: { acceptsImages: true, maxInputImages: 4 },
        pricingMatrix: [
          {
            conditions: {},
            costInTokens: 3,
            costInDollars: 0.0125,
            label: 'Стандартная генерация',
          },
        ],
        uiParameters: [
          {
            key: 'aspectRatio',
            label: 'Соотношение сторон',
            type: 'select',
            defaultValue: '1:1',
            affectsPrice: false,
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
        displayName: 'Midjourney',
        description: 'Лучший генератор изображений',
        type: 'image',
        fixedCostPerGeneration: 0.055,
        tokensPerDollar: 100,
        minTokenCost: 5,
        sortOrder: 3,
        capabilities: ['variations', 'upscale'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'mj_txt2img', priority: 1, isActive: true },
          { providerSlug: 'evolink', modelId: 'midjourney', priority: 2, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        pricingMatrix: [
          {
            conditions: { mode: 'turbo' },
            costInTokens: 22,
            costInDollars: 0.22,
            label: 'Турбо режим',
          },
          {
            conditions: { mode: 'fast' },
            costInTokens: 12,
            costInDollars: 0.12,
            label: 'Быстрый режим',
          },
          {
            conditions: { mode: 'relax' },
            costInTokens: 5,
            costInDollars: 0.05,
            label: 'Relax режим',
          },
        ],
        uiParameters: [
          {
            key: 'mode',
            label: 'Режим генерации',
            type: 'select',
            defaultValue: 'fast',
            affectsPrice: true,
            options: [
              { value: 'relax', label: 'Relax (5🔥, ~5 мин)' },
              { value: 'fast', label: 'Быстрый (12🔥, ~30 сек)' },
              { value: 'turbo', label: 'Турбо (22🔥, ~15 сек)' },
            ],
          },
          {
            key: 'aspectRatio',
            label: 'Соотношение сторон',
            type: 'select',
            defaultValue: '1:1',
            affectsPrice: false,
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
        displayName: 'Midjourney (Image to Image)',
        description: 'Трансформация изображений через Midjourney',
        type: 'image',
        fixedCostPerGeneration: 0.055,
        tokensPerDollar: 100,
        minTokenCost: 5,
        sortOrder: 4,
        capabilities: ['image_to_image', 'variations'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'mj_img2img', priority: 1, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        pricingMatrix: [
          {
            conditions: { mode: 'turbo' },
            costInTokens: 22,
            costInDollars: 0.22,
            label: 'Турбо режим',
          },
          {
            conditions: { mode: 'fast' },
            costInTokens: 12,
            costInDollars: 0.12,
            label: 'Быстрый режим',
          },
          {
            conditions: { mode: 'relax' },
            costInTokens: 5,
            costInDollars: 0.05,
            label: 'Relax режим',
          },
        ],
        uiParameters: [
          {
            key: 'mode',
            label: 'Режим генерации',
            type: 'select',
            defaultValue: 'fast',
            affectsPrice: true,
            options: [
              { value: 'relax', label: 'Relax (5🔥)' },
              { value: 'fast', label: 'Быстрый (12🔥)' },
              { value: 'turbo', label: 'Турбо (22🔥)' },
            ],
          },
          {
            key: 'aspectRatio',
            label: 'Соотношение сторон',
            type: 'select',
            defaultValue: '1:1',
            affectsPrice: false,
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
        tokensPerDollar: 100,
        minTokenCost: 4,
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
          {
            conditions: {},
            costInTokens: 6,
            costInDollars: 0.0275,
            label: 'Стандартная генерация',
          },
        ],
        uiParameters: [
          {
            key: 'aspectRatio',
            label: 'Соотношение сторон',
            type: 'select',
            defaultValue: '1:1',
            affectsPrice: false,
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
        fixedCostPerGeneration: 0.02,
        tokensPerDollar: 100,
        minTokenCost: 3,
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
          {
            conditions: {},
            costInTokens: 5,
            costInDollars: 0.02,
            label: 'Стандартная генерация',
          },
        ],
        uiParameters: [
          {
            key: 'aspectRatio',
            label: 'Соотношение сторон',
            type: 'select',
            defaultValue: '1:1',
            affectsPrice: false,
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
        fixedCostPerGeneration: 0.035,
        tokensPerDollar: 100,
        minTokenCost: 4,
        sortOrder: 7,
        capabilities: ['text_to_image', 'image_to_image'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'flux-2/flex-text-to-image', priority: 1, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024, steps: 28 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        pricingMatrix: [
          {
            conditions: { version: 'pro', resolution: '2K' },
            costInTokens: 14,
            costInDollars: 0.06,
            label: 'Pro × 2K',
          },
          {
            conditions: { version: 'pro', resolution: '1K' },
            costInTokens: 10,
            costInDollars: 0.045,
            label: 'Pro × 1K',
          },
          {
            conditions: { version: 'flex', resolution: '2K' },
            costInTokens: 10,
            costInDollars: 0.045,
            label: 'Flex × 2K',
          },
          {
            conditions: { version: 'flex', resolution: '1K' },
            costInTokens: 8,
            costInDollars: 0.035,
            label: 'Flex × 1K',
          },
        ],
        uiParameters: [
          {
            key: 'version',
            label: 'Версия модели',
            type: 'select',
            defaultValue: 'flex',
            affectsPrice: true,
            options: [
              { value: 'flex', label: 'Flex (быстрее)' },
              { value: 'pro', label: 'Pro (качественнее)' },
            ],
          },
          {
            key: 'resolution',
            label: 'Разрешение',
            type: 'select',
            defaultValue: '1K',
            affectsPrice: true,
            options: [
              { value: '1K', label: '1K (1024×1024)' },
              { value: '2K', label: '2K (2048×2048)' },
            ],
          },
          {
            key: 'aspectRatio',
            label: 'Соотношение сторон',
            type: 'select',
            defaultValue: '1:1',
            affectsPrice: false,
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
        fixedCostPerGeneration: 0.035,
        tokensPerDollar: 100,
        minTokenCost: 4,
        sortOrder: 8,
        capabilities: ['image_to_image'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'flux-2/flex-image-to-image', priority: 1, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024, steps: 28 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: true, maxInputImages: 8 },
        pricingMatrix: [
          {
            conditions: { version: 'pro', resolution: '2K' },
            costInTokens: 14,
            costInDollars: 0.06,
            label: 'Pro × 2K',
          },
          {
            conditions: { version: 'pro', resolution: '1K' },
            costInTokens: 10,
            costInDollars: 0.045,
            label: 'Pro × 1K',
          },
          {
            conditions: { version: 'flex', resolution: '2K' },
            costInTokens: 10,
            costInDollars: 0.045,
            label: 'Flex × 2K',
          },
          {
            conditions: { version: 'flex', resolution: '1K' },
            costInTokens: 8,
            costInDollars: 0.035,
            label: 'Flex × 1K',
          },
        ],
        uiParameters: [
          {
            key: 'version',
            label: 'Версия модели',
            type: 'select',
            defaultValue: 'flex',
            affectsPrice: true,
            options: [
              { value: 'flex', label: 'Flex (быстрее)' },
              { value: 'pro', label: 'Pro (качественнее)' },
            ],
          },
          {
            key: 'resolution',
            label: 'Разрешение',
            type: 'select',
            defaultValue: '1K',
            affectsPrice: true,
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
        description: 'Стандартная версия Nano Banana',
        type: 'image',
        fixedCostPerGeneration: 0.025,
        tokensPerDollar: 100,
        minTokenCost: 3,
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
          {
            conditions: { resolution: '4K' },
            costInTokens: 10,
            costInDollars: 0.04,
            label: '4K разрешение',
          },
          {
            conditions: { resolution: '2K' },
            costInTokens: 8,
            costInDollars: 0.035,
            label: '2K разрешение',
          },
          {
            conditions: { resolution: '1K' },
            costInTokens: 6,
            costInDollars: 0.025,
            label: '1K разрешение',
          },
        ],
        uiParameters: [
          {
            key: 'resolution',
            label: 'Разрешение',
            type: 'select',
            defaultValue: '1K',
            affectsPrice: true,
            options: [
              { value: '1K', label: '1K (6🔥)' },
              { value: '2K', label: '2K (8🔥)' },
              { value: '4K', label: '4K (10🔥)' },
            ],
          },
          {
            key: 'aspectRatio',
            label: 'Соотношение сторон',
            type: 'select',
            defaultValue: '1:1',
            affectsPrice: false,
            options: [
              { value: '1:1', label: 'Квадрат (1:1)' },
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '4:3', label: 'Стандарт (4:3)' },
              { value: '3:4', label: 'Портрет (3:4)' },
            ],
          },
          {
            key: 'outputFormat',
            label: 'Формат файла',
            type: 'select',
            defaultValue: 'png',
            affectsPrice: false,
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
        description: 'Продвинутая версия Nano Banana',
        type: 'image',
        fixedCostPerGeneration: 0.04,
        tokensPerDollar: 100,
        minTokenCost: 5,
        sortOrder: 10,
        capabilities: ['high_quality'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'nano-banana-pro', priority: 1, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '4096x4096' },
        inputCapabilities: { acceptsImages: true, maxInputImages: 8 },
        pricingMatrix: [
          {
            conditions: { resolution: '4K' },
            costInTokens: 14,
            costInDollars: 0.06,
            label: '4K разрешение',
          },
          {
            conditions: { resolution: '2K' },
            costInTokens: 11,
            costInDollars: 0.05,
            label: '2K разрешение',
          },
          {
            conditions: { resolution: '1K' },
            costInTokens: 9,
            costInDollars: 0.04,
            label: '1K разрешение',
          },
        ],
        uiParameters: [
          {
            key: 'resolution',
            label: 'Разрешение',
            type: 'select',
            defaultValue: '1K',
            affectsPrice: true,
            options: [
              { value: '1K', label: '1K (9🔥)' },
              { value: '2K', label: '2K (11🔥)' },
              { value: '4K', label: '4K (14🔥)' },
            ],
          },
          {
            key: 'aspectRatio',
            label: 'Соотношение сторон',
            type: 'select',
            defaultValue: '1:1',
            affectsPrice: false,
            options: [
              { value: '1:1', label: 'Квадрат (1:1)' },
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '4:3', label: 'Стандарт (4:3)' },
              { value: '3:4', label: 'Портрет (3:4)' },
            ],
          },
          {
            key: 'outputFormat',
            label: 'Формат файла',
            type: 'select',
            defaultValue: 'png',
            affectsPrice: false,
            options: [
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPEG' },
              { value: 'webp', label: 'WebP' },
            ],
          },
        ],
      },

      // ════════════════════════════════════════════════════
      // МОДЕЛИ ВИДЕО — с pricingMatrix + uiParameters
      // ════════════════════════════════════════════════════
      {
        slug: 'veo-3.1-fast',
        name: 'Veo 3.1 Fast',
        displayName: 'Google Veo 3.1 Fast',
        description: 'Быстрая версия Veo от Google',
        type: 'video',
        fixedCostPerGeneration: 0.15,
        tokensPerDollar: 100,
        minTokenCost: 15,
        sortOrder: 1,
        capabilities: ['text_to_video'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'veo-3.1-fast-generate-preview', priority: 1, isActive: true },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 8 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        pricingMatrix: [
          {
            conditions: {},
            costInTokens: 32,
            costInDollars: 0.32,
            label: 'Veo 3.1 Fast',
          },
        ],
        uiParameters: [
          {
            key: 'aspectRatio',
            label: 'Соотношение сторон',
            type: 'select',
            defaultValue: '16:9',
            affectsPrice: false,
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
        fixedCostPerGeneration: 0.30,
        tokensPerDollar: 100,
        minTokenCost: 30,
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
          {
            conditions: {},
            costInTokens: 65,
            costInDollars: 0.65,
            label: 'Veo 3.1 Pro',
          },
        ],
        uiParameters: [
          {
            key: 'aspectRatio',
            label: 'Соотношение сторон',
            type: 'select',
            defaultValue: '16:9',
            affectsPrice: false,
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
        tokensPerDollar: 100,
        minTokenCost: 50,
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
          {
            conditions: { duration: 15 },
            costInTokens: 280,
            costInDollars: 2.80,
            label: '15 секунд',
          },
          {
            conditions: { duration: 10 },
            costInTokens: 200,
            costInDollars: 2.00,
            label: '10 секунд',
          },
          {
            conditions: {},
            costInTokens: 200,
            costInDollars: 2.00,
            label: 'Стандарт (5 сек)',
          },
        ],
        uiParameters: [
          {
            key: 'duration',
            label: 'Длительность (сек)',
            type: 'select',
            defaultValue: 5,
            affectsPrice: true,
            options: [
              { value: 5, label: '5 сек (200🔥)' },
              { value: 10, label: '10 сек (200🔥)' },
              { value: 15, label: '15 сек (280🔥)' },
            ],
          },
          {
            key: 'aspectRatio',
            label: 'Соотношение сторон',
            type: 'select',
            defaultValue: '16:9',
            affectsPrice: false,
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
            ],
          },
        ],
      },
      {
        slug: 'sora-2',
        name: 'Sora 2',
        displayName: 'OpenAI Sora 2',
        description: 'Стандартная версия Sora',
        type: 'video',
        fixedCostPerGeneration: 0.15,
        tokensPerDollar: 100,
        minTokenCost: 20,
        sortOrder: 4,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'sora-2-text-to-video', priority: 1, isActive: true },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 15 },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        pricingMatrix: [
          {
            conditions: { duration: 15 },
            costInTokens: 45,
            costInDollars: 0.45,
            label: '15 секунд',
          },
          {
            conditions: { duration: 10 },
            costInTokens: 30,
            costInDollars: 0.30,
            label: '10 секунд',
          },
          {
            conditions: {},
            costInTokens: 20,
            costInDollars: 0.20,
            label: 'Стандарт (5 сек)',
          },
        ],
        uiParameters: [
          {
            key: 'duration',
            label: 'Длительность (сек)',
            type: 'select',
            defaultValue: 5,
            affectsPrice: true,
            options: [
              { value: 5, label: '5 сек (20🔥)' },
              { value: 10, label: '10 сек (30🔥)' },
              { value: 15, label: '15 сек (45🔥)' },
            ],
          },
          {
            key: 'aspectRatio',
            label: 'Соотношение сторон',
            type: 'select',
            defaultValue: '16:9',
            affectsPrice: false,
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
            ],
          },
        ],
      },
      {
        slug: 'sora-2-img2vid',
        name: 'Sora 2 Img2Vid',
        displayName: 'Sora 2 (Image to Video)',
        description: 'Sora для анимации изображений',
        type: 'video',
        fixedCostPerGeneration: 0.175,
        tokensPerDollar: 100,
        minTokenCost: 22,
        sortOrder: 5,
        capabilities: ['image_to_video'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'sora-2-image-to-video', priority: 1, isActive: true },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 15 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        pricingMatrix: [
          {
            conditions: { duration: 15 },
            costInTokens: 50,
            costInDollars: 0.50,
            label: '15 секунд',
          },
          {
            conditions: { duration: 10 },
            costInTokens: 35,
            costInDollars: 0.35,
            label: '10 секунд',
          },
          {
            conditions: {},
            costInTokens: 22,
            costInDollars: 0.22,
            label: 'Стандарт (5 сек)',
          },
        ],
        uiParameters: [
          {
            key: 'duration',
            label: 'Длительность (сек)',
            type: 'select',
            defaultValue: 5,
            affectsPrice: true,
            options: [
              { value: 5, label: '5 сек (22🔥)' },
              { value: 10, label: '10 сек (35🔥)' },
              { value: 15, label: '15 сек (50🔥)' },
            ],
          },
          {
            key: 'aspectRatio',
            label: 'Соотношение сторон',
            type: 'select',
            defaultValue: '16:9',
            affectsPrice: false,
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
            ],
          },
        ],
      },
      {
        slug: 'kling-3.0',
        name: 'Kling 3.0',
        displayName: 'Kling 3.0',
        description: 'Генератор видео Kling (Text-to-Video)',
        type: 'video',
        fixedCostPerGeneration: 0.075,
        tokensPerDollar: 100,
        minTokenCost: 10,
        sortOrder: 6,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'kling-3.0/video', priority: 1, isActive: true },
          { providerSlug: 'evolink', modelId: 'kling-v3-text-to-video', priority: 2, isActive: true },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 10 },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        pricingMatrix: [
          {
            conditions: { mode: 'pro', sound: true },
            costInTokens: 28,
            costInDollars: 0.28,
            label: 'Pro + звук',
          },
          {
            conditions: { mode: 'pro', sound: false },
            costInTokens: 22,
            costInDollars: 0.22,
            label: 'Pro без звука',
          },
          {
            conditions: { mode: 'std', sound: true },
            costInTokens: 20,
            costInDollars: 0.20,
            label: 'Стандарт + звук',
          },
          {
            conditions: { mode: 'std', sound: false },
            costInTokens: 17,
            costInDollars: 0.17,
            label: 'Стандарт без звука',
          },
        ],
        uiParameters: [
          {
            key: 'mode',
            label: 'Режим',
            type: 'select',
            defaultValue: 'std',
            affectsPrice: true,
            options: [
              { value: 'std', label: 'Стандарт (17🔥)' },
              { value: 'pro', label: 'Pro (22🔥)' },
            ],
          },
          {
            key: 'sound',
            label: 'Со звуком',
            type: 'boolean',
            defaultValue: false,
            affectsPrice: true,
          },
          {
            key: 'duration',
            label: 'Длительность (сек)',
            type: 'select',
            defaultValue: 5,
            affectsPrice: false,
            options: [
              { value: 5, label: '5 сек' },
              { value: 10, label: '10 сек' },
            ],
          },
          {
            key: 'aspectRatio',
            label: 'Соотношение сторон',
            type: 'select',
            defaultValue: '16:9',
            affectsPrice: false,
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '1:1', label: 'Квадрат (1:1)' },
            ],
          },
        ],
      },
      {
        slug: 'kling-3.0-img2vid',
        name: 'Kling 3.0 Img2Vid',
        displayName: 'Kling 3.0 (Image to Video)',
        description: 'Kling для анимации изображений',
        type: 'video',
        fixedCostPerGeneration: 0.10,
        tokensPerDollar: 100,
        minTokenCost: 12,
        sortOrder: 7,
        capabilities: ['image_to_video', 'motion_control'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'kling-3.0/video', priority: 1, isActive: true },
          { providerSlug: 'evolink', modelId: 'kling-v3-image-to-video', priority: 2, isActive: true },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 10 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        pricingMatrix: [
          {
            conditions: { mode: 'pro', sound: true },
            costInTokens: 32,
            costInDollars: 0.32,
            label: 'Pro + звук',
          },
          {
            conditions: { mode: 'pro', sound: false },
            costInTokens: 26,
            costInDollars: 0.26,
            label: 'Pro без звука',
          },
          {
            conditions: { mode: 'std', sound: true },
            costInTokens: 25,
            costInDollars: 0.25,
            label: 'Стандарт + звук',
          },
          {
            conditions: { mode: 'std', sound: false },
            costInTokens: 22,
            costInDollars: 0.22,
            label: 'Стандарт без звука',
          },
        ],
        uiParameters: [
          {
            key: 'mode',
            label: 'Режим',
            type: 'select',
            defaultValue: 'std',
            affectsPrice: true,
            options: [
              { value: 'std', label: 'Стандарт (22🔥)' },
              { value: 'pro', label: 'Pro (26🔥)' },
            ],
          },
          {
            key: 'sound',
            label: 'Со звуком',
            type: 'boolean',
            defaultValue: false,
            affectsPrice: true,
          },
          {
            key: 'duration',
            label: 'Длительность (сек)',
            type: 'select',
            defaultValue: 5,
            affectsPrice: false,
            options: [
              { value: 5, label: '5 сек' },
              { value: 10, label: '10 сек' },
            ],
          },
        ],
      },
      {
        slug: 'kling-3.0-motion',
        name: 'Kling 3.0 Motion Control',
        displayName: 'Kling 3.0 Motion Control',
        description: 'Kling с контролем движения (image + motion reference video)',
        type: 'video',
        fixedCostPerGeneration: 0.12,
        tokensPerDollar: 100,
        minTokenCost: 15,
        sortOrder: 8,
        capabilities: ['motion_control', 'image_to_video'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'kling-v3-motion-control', priority: 1, isActive: true },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 10 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1, acceptsVideos: true },
        pricingMatrix: [
          {
            conditions: {},
            costInTokens: 26,
            costInDollars: 0.26,
            label: 'Motion Control',
          },
        ],
        uiParameters: [
          {
            key: 'duration',
            label: 'Длительность (сек)',
            type: 'select',
            defaultValue: 5,
            affectsPrice: false,
            options: [
              { value: 5, label: '5 сек' },
              { value: 10, label: '10 сек' },
            ],
          },
        ],
      },
            {
        slug: 'runway',
        name: 'Runway',
        displayName: 'Runway Gen-3',
        description: 'Генератор видео от Runway',
        type: 'video',
        fixedCostPerGeneration: 0.10,
        tokensPerDollar: 100,
        minTokenCost: 15,
        sortOrder: 9,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'runway', priority: 1, isActive: true },
          { providerSlug: 'evolink', modelId: 'runway-gen3', priority: 2, isActive: false },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 10 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        pricingMatrix: [
          {
            conditions: { resolution: '1080p', duration: 10 },
            costInTokens: 40,
            costInDollars: 0.40,
            label: '1080p × 10s',
          },
          {
            conditions: { resolution: '1080p', duration: 5 },
            costInTokens: 28,
            costInDollars: 0.28,
            label: '1080p × 5s',
          },
          {
            conditions: { resolution: '720p', duration: 10 },
            costInTokens: 28,
            costInDollars: 0.28,
            label: '720p × 10s',
          },
          {
            conditions: { resolution: '720p', duration: 5 },
            costInTokens: 20,
            costInDollars: 0.20,
            label: '720p × 5s',
          },
        ],
        uiParameters: [
          {
            key: 'resolution',
            label: 'Разрешение',
            type: 'select',
            defaultValue: '720p',
            affectsPrice: true,
            options: [
              { value: '720p', label: '720p (20🔥)' },
              { value: '1080p', label: '1080p (28🔥)' },
            ],
          },
          {
            key: 'duration',
            label: 'Длительность (сек)',
            type: 'select',
            defaultValue: 5,
            affectsPrice: true,
            options: [
              { value: 5, label: '5 сек' },
              { value: 10, label: '10 сек' },
            ],
          },
          {
            key: 'aspectRatio',
            label: 'Соотношение сторон',
            type: 'select',
            defaultValue: '16:9',
            affectsPrice: false,
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
            ],
          },
        ],
      },
      {
        slug: 'hailuo-2.3-standard',
        name: 'Hailuo 2.3 Standard',
        displayName: 'Hailuo 2.3 Standard',
        description: 'Стандартная версия Hailuo',
        type: 'video',
        fixedCostPerGeneration: 0.08,
        tokensPerDollar: 100,
        minTokenCost: 10,
        sortOrder: 10,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'hailuo/02-text-to-video-standard', priority: 1, isActive: true },
          { providerSlug: 'evolink', modelId: 'hailuo', priority: 2, isActive: false },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 10 },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        pricingMatrix: [
          {
            conditions: { resolution: '768p', duration: 10 },
            costInTokens: 28,
            costInDollars: 0.28,
            label: '768p × 10s',
          },
          {
            conditions: { resolution: '768p', duration: 6 },
            costInTokens: 18,
            costInDollars: 0.18,
            label: '768p × 6s',
          },
          {
            conditions: {},
            costInTokens: 16,
            costInDollars: 0.16,
            label: 'Стандарт',
          },
        ],
        uiParameters: [
          {
            key: 'resolution',
            label: 'Разрешение',
            type: 'select',
            defaultValue: '768p',
            affectsPrice: true,
            options: [
              { value: '768p', label: '768p (HD)' },
            ],
          },
          {
            key: 'duration',
            label: 'Длительность (сек)',
            type: 'select',
            defaultValue: 6,
            affectsPrice: true,
            options: [
              { value: 6, label: '6 сек (18🔥)' },
              { value: 10, label: '10 сек (28🔥)' },
            ],
          },
        ],
      },
      {
        slug: 'hailuo-2.3-pro',
        name: 'Hailuo 2.3 Pro',
        displayName: 'Hailuo 2.3 Pro',
        description: 'Премиум версия Hailuo',
        type: 'video',
        fixedCostPerGeneration: 0.12,
        tokensPerDollar: 100,
        minTokenCost: 15,
        sortOrder: 11,
        capabilities: ['text_to_video', 'image_to_video', 'high_quality'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'hailuo/2-3-image-to-video-pro', priority: 1, isActive: true },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 10 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        pricingMatrix: [
          {
            conditions: { resolution: '1080p', duration: 10 },
            costInTokens: 45,
            costInDollars: 0.45,
            label: '1080p × 10s',
          },
          {
            conditions: { resolution: '1080p', duration: 6 },
            costInTokens: 30,
            costInDollars: 0.30,
            label: '1080p × 6s',
          },
          {
            conditions: {},
            costInTokens: 25,
            costInDollars: 0.25,
            label: 'Стандарт',
          },
        ],
        uiParameters: [
          {
            key: 'resolution',
            label: 'Разрешение',
            type: 'select',
            defaultValue: '1080p',
            affectsPrice: true,
            options: [
              { value: '1080p', label: '1080p (Full HD)' },
            ],
          },
          {
            key: 'duration',
            label: 'Длительность (сек)',
            type: 'select',
            defaultValue: 6,
            affectsPrice: true,
            options: [
              { value: 6, label: '6 сек (30🔥)' },
              { value: 10, label: '10 сек (45🔥)' },
            ],
          },
        ],
      },

      // ════════════════════════════════════════════════════
      // МОДЕЛИ АУДИО — с pricingMatrix + uiParameters
      // ════════════════════════════════════════════════════
      {
        slug: 'suno-v4',
        name: 'Suno V4',
        displayName: 'Suno V4',
        description: 'Генератор музыки от Suno',
        type: 'audio',
        fixedCostPerGeneration: 0.06,
        tokensPerDollar: 100,
        minTokenCost: 8,
        sortOrder: 1,
        capabilities: ['text_to_music', 'lyrics', 'instrumental'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'ai-music-api/generate', priority: 1, isActive: true },
        ],
        defaultParams: { duration: 30 },
        limits: { maxDuration: 240 },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        pricingMatrix: [
          {
            conditions: {},
            costInTokens: 13,
            costInDollars: 0.13,
            label: 'Генерация трека',
          },
        ],
        uiParameters: [
          {
            key: 'operation',
            label: 'Операция',
            type: 'select',
            defaultValue: 'generate',
            affectsPrice: false,
            options: [
              { value: 'generate', label: 'Создать трек' },
            ],
          },
          {
            key: 'customMode',
            label: 'Кастомный режим',
            type: 'boolean',
            defaultValue: false,
            affectsPrice: false,
          },
          {
            key: 'instrumental',
            label: 'Только инструментал',
            type: 'boolean',
            defaultValue: false,
            affectsPrice: false,
          },
        ],
      },
      {
        slug: 'elevenlabs-tts-turbo',
        name: 'ElevenLabs TTS Turbo',
        displayName: 'ElevenLabs Turbo 2.5',
        description: 'Быстрый синтез речи от ElevenLabs',
        type: 'audio',
        fixedCostPerGeneration: 0.03,
        tokensPerDollar: 100,
        minTokenCost: 3,
        sortOrder: 2,
        capabilities: ['text_to_speech', 'multilingual', 'voice_selection'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'elevenlabs/text-to-speech-turbo-2-5', priority: 1, isActive: true },
        ],
        defaultParams: {},
        limits: { maxDuration: 600 },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        pricingMatrix: [
          {
            conditions: {},
            costInTokens: 5,
            costInDollars: 0.03,
            label: 'TTS Turbo',
          },
        ],
        uiParameters: [
          {
            key: 'voice',
            label: 'Голос',
            type: 'select',
            defaultValue: 'rachel',
            affectsPrice: false,
            options: [
              { value: 'rachel', label: 'Rachel (женский)' },
              { value: 'adam', label: 'Adam (мужской)' },
              { value: 'antoni', label: 'Antoni (мужской)' },
              { value: 'bella', label: 'Bella (женский)' },
              { value: 'domi', label: 'Domi (женский)' },
            ],
          },
        ],
      },
      {
        slug: 'elevenlabs-tts-multilingual',
        name: 'ElevenLabs Multilingual V2',
        displayName: 'ElevenLabs Multilingual V2',
        description: 'Мультиязычный синтез речи высокого качества',
        type: 'audio',
        fixedCostPerGeneration: 0.06,
        tokensPerDollar: 100,
        minTokenCost: 5,
        sortOrder: 3,
        capabilities: ['text_to_speech', 'multilingual', 'voice_selection'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'elevenlabs/text-to-speech-multilingual-v2', priority: 1, isActive: true },
        ],
        defaultParams: {},
        limits: { maxDuration: 600 },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        pricingMatrix: [
          {
            conditions: {},
            costInTokens: 9,
            costInDollars: 0.06,
            label: 'TTS Multilingual',
          },
        ],
        uiParameters: [
          {
            key: 'voice',
            label: 'Голос',
            type: 'select',
            defaultValue: 'rachel',
            affectsPrice: false,
            options: [
              { value: 'rachel', label: 'Rachel (женский)' },
              { value: 'adam', label: 'Adam (мужской)' },
              { value: 'antoni', label: 'Antoni (мужской)' },
              { value: 'bella', label: 'Bella (женский)' },
              { value: 'domi', label: 'Domi (женский)' },
            ],
          },
        ],
      },
      {
        slug: 'elevenlabs-dialogue',
        name: 'ElevenLabs Dialogue',
        displayName: 'ElevenLabs Text-to-Dialogue',
        description: 'Генерация диалогов с несколькими голосами',
        type: 'audio',
        fixedCostPerGeneration: 0.07,
        tokensPerDollar: 100,
        minTokenCost: 7,
        sortOrder: 4,
        capabilities: ['text_to_speech', 'dialogue', 'multi_voice'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'elevenlabs/text-to-dialogue-v3', priority: 1, isActive: true },
        ],
        defaultParams: {},
        limits: { maxDuration: 600 },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        pricingMatrix: [
          {
            conditions: {},
            costInTokens: 10,
            costInDollars: 0.07,
            label: 'Dialogue v3',
          },
        ],
        uiParameters: [],
      },
      {
        slug: 'elevenlabs-isolation',
        name: 'ElevenLabs Isolation',
        displayName: 'ElevenLabs Audio Isolation',
        description: 'Удаление шума и изоляция голоса из аудио',
        type: 'audio',
        fixedCostPerGeneration: 0.001,
        tokensPerDollar: 100,
        minTokenCost: 1,
        sortOrder: 5,
        capabilities: ['audio_isolation', 'noise_removal'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'elevenlabs/audio-isolation', priority: 1, isActive: true },
        ],
        defaultParams: {},
        limits: {},
        inputCapabilities: { acceptsImages: false, maxInputImages: 0, acceptsAudio: true },
        pricingMatrix: [
          {
            conditions: {},
            costInTokens: 1,
            costInDollars: 0.001,
            label: 'Audio Isolation',
          },
        ],
        uiParameters: [],
      },
      {
        slug: 'elevenlabs-stt',
        name: 'ElevenLabs STT',
        displayName: 'ElevenLabs Speech-to-Text',
        description: 'Распознавание речи с поддержкой языков',
        type: 'audio',
        fixedCostPerGeneration: 0.0175,
        tokensPerDollar: 100,
        minTokenCost: 2,
        sortOrder: 6,
        capabilities: ['speech_to_text', 'multilingual'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'elevenlabs/speech-to-text', priority: 1, isActive: true },
        ],
        defaultParams: {},
        limits: {},
        inputCapabilities: { acceptsImages: false, maxInputImages: 0, acceptsAudio: true },
        pricingMatrix: [
          {
            conditions: {},
            costInTokens: 3,
            costInDollars: 0.0175,
            label: 'Speech-to-Text',
          },
        ],
        uiParameters: [],
      },
      {
        slug: 'elevenlabs-sfx',
        name: 'ElevenLabs SFX',
        displayName: 'ElevenLabs Sound Effects',
        description: 'Генерация звуковых эффектов по описанию',
        type: 'audio',
        fixedCostPerGeneration: 0.03,
        tokensPerDollar: 100,
        minTokenCost: 3,
        sortOrder: 7,
        capabilities: ['sound_effects', 'loop'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'elevenlabs/sound-effect-v2', priority: 1, isActive: true },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 30 },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        pricingMatrix: [
          {
            conditions: {},
            costInTokens: 5,
            costInDollars: 0.03,
            label: 'Sound Effect',
          },
        ],
        uiParameters: [
          {
            key: 'duration',
            label: 'Длительность (сек)',
            type: 'select',
            defaultValue: 5,
            affectsPrice: false,
            options: [
              { value: 3, label: '3 сек' },
              { value: 5, label: '5 сек' },
              { value: 10, label: '10 сек' },
              { value: 20, label: '20 сек' },
              { value: 30, label: '30 сек' },
            ],
          },
        ],
      },
    ];
  }
}