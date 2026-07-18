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
 */
const FORCE_TEXT_PRICES_MIGRATION = true;

/**
 * ⚙️ Разовая принудительная миграция MEDIA-моделей (image/video/audio).
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

      const costPerMillionInputTokens =
        (modelData as any).costPerMillionInputTokens ?? pricePerMillionInputTokens;
      const costPerMillionOutputTokens =
        (modelData as any).costPerMillionOutputTokens ?? pricePerMillionOutputTokens;
      const fixedCostPerGeneration =
        (modelData as any).fixedCostPerGeneration ?? 0;

      let tokenCost = modelData.minTokenCost;
      if (modelData.type === 'text') {
        const previewCost =
          (avgTokensPerRequest *
            (0.3 * pricePerMillionInputTokens +
              0.7 * pricePerMillionOutputTokens)) /
          1_000_000;
        tokenCost = Math.max(modelData.minTokenCost, previewCost);
        tokenCost = Math.round(tokenCost * 100) / 100;
      } else {
        const computed = fixedCostPerGeneration * (modelData.tokensPerDollar || 90);
        tokenCost = Math.max(
          modelData.minTokenCost,
          Math.round(computed * 100) / 100,
        );
      }

      const setAlways: Record<string, any> = {
        name: modelData.name,
        displayName: modelData.displayName,
        description: modelData.description,
        type: modelData.type,
        sortOrder: modelData.sortOrder,
        capabilities: modelData.capabilities || [],
        providerMappings: mappings,
        limits: modelData.limits || {},
        defaultParams: modelData.defaultParams || {},
        supportsVision: (modelData as any).supportsVision ?? false,
        // 🆕 Посимвольная тарификация (для ElevenLabs аудио-моделей)
        charBasedPricing: (modelData as any).charBasedPricing ?? false,
        pricePerThousandChars: (modelData as any).pricePerThousandChars ?? 0,
        // 🆕 Посекундная тарификация с видео-референсом (Seedance 2/2-fast)
        videoRefPricing: (modelData as any).videoRefPricing ?? false,
        videoRefRatePerSecond:
          (modelData as any).videoRefRatePerSecond ?? {},
      };

      const setOnCreate: Record<string, any> = {
        slug,
        isActive: true,
        isPremium: (modelData as any).isPremium ?? false,
        tokensPerDollar: modelData.tokensPerDollar,
        minTokenCost: modelData.minTokenCost,
        tokenCost,
        pricePerMillionInputTokens,
        pricePerMillionOutputTokens,
        avgTokensPerRequest,
        providerCostPerMillionInput,
        providerCostPerMillionOutput,
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
        webSearchCostInTokens: (modelData as any).webSearchCostInTokens ?? 0,
      };

      const result = await this.modelModel.findOneAndUpdate(
        { slug },
        { $set: setAlways, $setOnInsert: setOnCreate },
        { upsert: true, new: true, rawResult: true } as any,
      );

      const wasInserted = !!(result as any).lastErrorObject?.upserted;
      if (wasInserted) created++;
      else updated++;

      // ─── ONE-TIME MIGRATION (media uiParameters/pricingMatrix) ───
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

      // ─── PRICE MIGRATION (текстовые модели) ───
      if (FORCE_TEXT_PRICES_MIGRATION && modelData.type === 'text') {
        await this.modelModel.updateOne(
          { slug },
          {
            $set: {
              minTokenCost: modelData.minTokenCost,
              tokenCost,
              pricePerMillionInputTokens,
              pricePerMillionOutputTokens,
              webSearchCostInTokens: (modelData as any).webSearchCostInTokens ?? 0,
              avgTokensPerRequest,
              providerCostPerMillionInput,
              providerCostPerMillionOutput,
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

      // ─── MEDIA MIGRATION (image/video/audio) ───
      if (FORCE_MEDIA_MIGRATION && modelData.type !== 'text') {
        const mediaSet: Record<string, any> = {
          minTokenCost: modelData.minTokenCost,
          tokenCost,
          tokensPerDollar: modelData.tokensPerDollar,
          fixedCostPerGeneration,
          isPremium: (modelData as any).isPremium ?? false,
          charBasedPricing: (modelData as any).charBasedPricing ?? false,
          pricePerThousandChars: (modelData as any).pricePerThousandChars ?? 0,
          // 🆕 Посекундная тарификация с видео-референсом (Seedance 2/2-fast)
          videoRefPricing: (modelData as any).videoRefPricing ?? false,
          videoRefRatePerSecond:
            (modelData as any).videoRefRatePerSecond ?? {},
        };

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

    // 🆕 Деактивируем устаревшие slug'и Suno (заменены на единый 'suno')
    const DEPRECATED_AUDIO_SLUGS = ['suno-v4', 'suno-v4_5'];
    const deactivated = await this.modelModel.updateMany(
      { slug: { $in: DEPRECATED_AUDIO_SLUGS }, isActive: true },
      { $set: { isActive: false } },
    );

    if (deactivated.modifiedCount > 0) {
      this.logger.warn(
        `🚫 Deactivated ${deactivated.modifiedCount} deprecated Suno models: ${DEPRECATED_AUDIO_SLUGS.join(', ')}`,
      );
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

  private buildModelsCatalog(): any[] {
    return [
      // ════════════════════════════════════════════════════
      // ТЕКСТОВЫЕ МОДЕЛИ (без изменений)
      // ════════════════════════════════════════════════════
      {
        slug: 'claude-haiku-4.5',
        name: 'Claude Haiku 4.5',
        displayName: 'Claude Haiku 4.5',
        description: 'Быстрая модель Anthropic с расширенным мышлением',
        type: 'text',
        pricePerMillionInputTokens: 90,
        pricePerMillionOutputTokens: 450,
        providerCostPerMillionInput: 1.0,
        providerCostPerMillionOutput: 5.0,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 90,
        minTokenCost: 0.5,
        sortOrder: 1,
        supportsVision: true,
        capabilities: ['streaming', 'vision', 'thinking'],
        providerMappings: [
          { providerSlug: 'openrouter', modelId: 'anthropic/claude-haiku-4.5', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 200000, maxOutputTokens: 8192 },
      },
      {
        slug: 'claude-opus-4.7',
        name: 'Claude Opus 4.7',
        displayName: 'Claude Opus 4.7',
        description: 'Самая мощная модель Anthropic',
        type: 'text',
        pricePerMillionInputTokens: 405,
        pricePerMillionOutputTokens: 2025,
        providerCostPerMillionInput: 4.5,
        providerCostPerMillionOutput: 22.5,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 90,
        minTokenCost: 1.5,
        sortOrder: 2,
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
        description: 'Самая мощная модель Anthropic (новейшая)',
        type: 'text',
        pricePerMillionInputTokens: 405,
        pricePerMillionOutputTokens: 2025,
        providerCostPerMillionInput: 4.5,
        providerCostPerMillionOutput: 22.5,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 90,
        minTokenCost: 1.5,
        sortOrder: 3,
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
        pricePerMillionInputTokens: 243,
        pricePerMillionOutputTokens: 1215,
        providerCostPerMillionInput: 2.7,
        providerCostPerMillionOutput: 13.5,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 90,
        minTokenCost: 0.8,
        sortOrder: 4,
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
        slug: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        displayName: 'DeepSeek V4 Flash',
        description: 'Быстрая универсальная модель DeepSeek, контекст 1M',
        type: 'text',
        pricePerMillionInputTokens: 13.23,
        pricePerMillionOutputTokens: 26.46,
        providerCostPerMillionInput: 0.147,
        providerCostPerMillionOutput: 0.294,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 90,
        minTokenCost: 0.1,
        sortOrder: 5,
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
        pricePerMillionInputTokens: 158.85,
        pricePerMillionOutputTokens: 317.61,
        providerCostPerMillionInput: 1.765,
        providerCostPerMillionOutput: 3.529,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 90,
        minTokenCost: 0.5,
        sortOrder: 6,
        isPremium: true,
        capabilities: ['streaming', 'reasoning', 'function_calling'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'deepseek-v4-pro', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 1000000, maxOutputTokens: 16384 },
      },
      {
        slug: 'gemini-3-flash',
        name: 'Gemini 3 Flash',
        displayName: 'Gemini 3 Flash',
        description: 'Быстрая модель Google',
        type: 'text',
        pricePerMillionInputTokens: 13.5,
        pricePerMillionOutputTokens: 351,
        providerCostPerMillionInput: 0.15,
        providerCostPerMillionOutput: 3.9,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 90,
        minTokenCost: 0.1,
        sortOrder: 7,
        supportsVision: true,
        capabilities: ['streaming', 'vision'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'gemini-3-flash', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 1000000, maxOutputTokens: 8192 },
      },
      {
        slug: 'gemini-3.1-pro',
        name: 'Gemini 3.1 Pro',
        displayName: 'Gemini 3.1 Pro',
        description: 'Продвинутая модель Google',
        type: 'text',
        pricePerMillionInputTokens: 45,
        pricePerMillionOutputTokens: 315,
        providerCostPerMillionInput: 0.5,
        providerCostPerMillionOutput: 3.5,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 90,
        minTokenCost: 0.2,
        sortOrder: 8,
        supportsVision: true,
        capabilities: ['streaming', 'vision'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'gemini-3.1-pro', priority: 1, isActive: true },
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
        pricePerMillionInputTokens: 225,
        pricePerMillionOutputTokens: 900,
        providerCostPerMillionInput: 2.5,
        providerCostPerMillionOutput: 10.0,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 90,
        minTokenCost: 0.3,
        sortOrder: 9,
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
        pricePerMillionInputTokens: 13.5,
        pricePerMillionOutputTokens: 54,
        providerCostPerMillionInput: 0.15,
        providerCostPerMillionOutput: 0.6,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 90,
        minTokenCost: 0.1,
        sortOrder: 10,
        supportsVision: true,
        capabilities: ['streaming', 'vision', 'function_calling'],
        providerMappings: [
          { providerSlug: 'openrouter', modelId: 'openai/gpt-4o-mini', priority: 1, isActive: true },
          { providerSlug: 'evolink', modelId: 'gpt-4o-mini', priority: 2, isActive: true },
        ],
        defaultParams: { maxTokens: 4096, temperature: 0.7 },
        limits: { maxInputTokens: 128000, maxOutputTokens: 16384 },
      },
      {
        slug: 'gpt-5.4',
        name: 'GPT-5.4',
        displayName: 'GPT-5.4',
        description: 'Новейшая флагманская модель OpenAI',
        type: 'text',
        pricePerMillionInputTokens: 202.5,
        pricePerMillionOutputTokens: 1215,
        providerCostPerMillionInput: 2.25,
        providerCostPerMillionOutput: 13.5,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 90,
        minTokenCost: 0.8,
        sortOrder: 11,
        isPremium: true,
        supportsVision: true,
        capabilities: ['streaming', 'vision', 'function_calling'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'gpt-5.4', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 128000, maxOutputTokens: 16384, includedInPlans: ['unlimited'] },
      },
           // ─── GPT 5.6 (KIE /codex/v1/responses) ──────────────
      {
        slug: 'gpt-5-6-luna',
        name: 'GPT-5.6 Luna',
        displayName: 'GPT-5.6 Luna',
        description: 'Быстрая мультимодальная модель OpenAI (Luna) с управляемым мышлением',
        type: 'text',
        pricePerMillionInputTokens: 25.2,
        pricePerMillionOutputTokens: 151.2,
        providerCostPerMillionInput: 0.28,
        providerCostPerMillionOutput: 1.68,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 90,
        minTokenCost: 0.2,
        sortOrder: 16,
        supportsVision: true,
        capabilities: ['streaming', 'vision', 'reasoning', 'web_search'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'gpt-5-6-luna', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 128000, maxOutputTokens: 16384 },
      },
      {
        slug: 'gpt-5-6-terra',
        name: 'GPT-5.6 Terra',
        displayName: 'GPT-5.6 Terra',
        description: 'Сбалансированная мультимодальная модель OpenAI (Terra) с управляемым мышлением',
        type: 'text',
        pricePerMillionInputTokens: 63,
        pricePerMillionOutputTokens: 378,
        providerCostPerMillionInput: 0.70,
        providerCostPerMillionOutput: 4.20,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 90,
        minTokenCost: 0.5,
        sortOrder: 17,
        isPremium: true,
        supportsVision: true,
        capabilities: ['streaming', 'vision', 'reasoning', 'web_search'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'gpt-5-6-terra', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 128000, maxOutputTokens: 16384 },
      },
      {
        slug: 'gpt-5-6-sol',
        name: 'GPT-5.6 Sol',
        displayName: 'GPT-5.6 Sol',
        description: 'Флагманская мультимодальная модель OpenAI (Sol) — максимальное качество мышления',
        type: 'text',
        pricePerMillionInputTokens: 126,
        pricePerMillionOutputTokens: 756,
        providerCostPerMillionInput: 1.40,
        providerCostPerMillionOutput: 8.40,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 90,
        minTokenCost: 0.9,
        sortOrder: 18,
        isPremium: true,
        supportsVision: true,
        capabilities: ['streaming', 'vision', 'reasoning', 'web_search'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'gpt-5-6-sol', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: { maxInputTokens: 128000, maxOutputTokens: 16384 },
      },
      {
        slug: 'gpt-oss-120b',
        name: 'GPT-OSS 120B',
        displayName: 'GPT-OSS 120B',
        description: 'Open-source 117B MoE model, оптимизирована для H100',
        type: 'text',
        pricePerMillionInputTokens: 3.51,
        pricePerMillionOutputTokens: 16.2,
        providerCostPerMillionInput: 0.039,
        providerCostPerMillionOutput: 0.18,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 90,
        minTokenCost: 0.1,
        sortOrder: 12,
        capabilities: ['streaming', 'function_calling'],
        providerMappings: [
          { providerSlug: 'openrouter', modelId: 'openai/gpt-oss-120b', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 4096, temperature: 0.7 },
        limits: { maxInputTokens: 131072, maxOutputTokens: 16384 },
      },
      {
        slug: 'grok-4.20',
        name: 'Grok 4.20',
        displayName: 'Grok 4.20',
        description: 'Быстрая версия Grok от xAI',
        type: 'text',
        pricePerMillionInputTokens: 112.5,
        pricePerMillionOutputTokens: 225,
        providerCostPerMillionInput: 1.25,
        providerCostPerMillionOutput: 2.5,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 90,
        minTokenCost: 0.3,
        sortOrder: 13,
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
        pricePerMillionInputTokens: 112.5,
        pricePerMillionOutputTokens: 225,
        providerCostPerMillionInput: 1.25,
        providerCostPerMillionOutput: 2.5,
        avgTokensPerRequest: 1500,
        tokensPerDollar: 90,
        minTokenCost: 1.2,
        sortOrder: 14,
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
        tokensPerDollar: 90,
        webSearchCostInTokens: 0.45,
        minTokenCost: 1,
        sortOrder: 15,
        supportsVision: true, // 🆕 Sonar понимает изображения (OpenRouter vision)
        capabilities: ['streaming', 'web_search', 'citations', 'vision'], // 🆕 vision
        providerMappings: [
          { providerSlug: 'openrouter', modelId: 'perplexity/sonar', priority: 1, isActive: true },
        ],
        defaultParams: { maxTokens: 4096, temperature: 0.7 },
        limits: { maxInputTokens: 127000, maxOutputTokens: 4096 },
      },

      // ════════════════════════════════════════════════════
      // IMAGE МОДЕЛИ (без изменений)
      // ════════════════════════════════════════════════════
      {
        slug: 'gpt-5-image',
        name: 'GPT Image 2',
        displayName: 'GPT Image 2',
        description: 'Новейший генератор изображений OpenAI (GPT Image 2)',
        type: 'image',
        fixedCostPerGeneration: 0.03,
        tokensPerDollar: 90,
        minTokenCost: 2.7,
        sortOrder: 1,
        capabilities: ['text_rendering', 'image_editing'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'gpt-image-2-text-to-image', priority: 1, isActive: true },
        ],
        defaultParams: { aspect_ratio: 'auto', resolution: '1K' },
        limits: { maxResolution: '4096x4096' },
        inputCapabilities: { acceptsImages: true, maxInputImages: 4 },
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
        fixedCostPerGeneration: 0.04,
        tokensPerDollar: 90,
        minTokenCost: 3.6,
        sortOrder: 3,
        capabilities: ['text_to_image'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'google/imagen4-ultra', priority: 1, isActive: true },
        ],
        defaultParams: { aspect_ratio: '1:1' },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
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
        fixedCostPerGeneration: 0.028,
        tokensPerDollar: 90,
        minTokenCost: 2.5,
        sortOrder: 4,
        capabilities: ['variations', 'upscale', 'image_to_image'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'mj-v7', priority: 1, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: true, maxInputImages: 5 },
        pricingMatrix: [
          { conditions: { mode: 'turbo' }, costInTokens: 9.5, costInDollars: 0.106, label: 'Турбо режим' },
          { conditions: { mode: 'fast' }, costInTokens: 5, costInDollars: 0.056, label: 'Быстрый режим' },
          { conditions: { mode: 'draft' }, costInTokens: 2.5, costInDollars: 0.028, label: 'Обычный режим' },
        ],
        uiParameters: [
          {
            key: 'mode', label: 'Режим генерации', type: 'select', affectsPrice: true, defaultValue: 'draft',
            options: [
              { value: 'draft', label: 'Обычный (2.5🔥)' },
              { value: 'fast', label: 'Быстрый (5🔥, ~30 сек)' },
              { value: 'turbo', label: 'Турбо (9.5🔥, ~15 сек)' },
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
      // {
      //   slug: 'midjourney-img2img',
      //   name: 'Midjourney Img2Img',
      //   displayName: 'Midjourney V7 (Image to Image)',
      //   description: 'Трансформация изображений через Midjourney',
      //   type: 'image',
      //   fixedCostPerGeneration: 0.028,
      //   tokensPerDollar: 90,
      //   minTokenCost: 2.5,
      //   sortOrder: 4,
      //   capabilities: ['image_to_image', 'variations'],
      //   providerMappings: [
      //     { providerSlug: 'evolink', modelId: 'mj-v7', priority: 1, isActive: true },
      //   ],
      //   defaultParams: { width: 1024, height: 1024 },
      //   limits: { maxResolution: '2048x2048' },
      //   inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
      //   pricingMatrix: [
      //     { conditions: { mode: 'turbo' }, costInTokens: 9.5, costInDollars: 0.106, label: 'Турбо режим' },
      //     { conditions: { mode: 'fast' }, costInTokens: 5, costInDollars: 0.056, label: 'Быстрый режим' },
      //     { conditions: { mode: 'draft' }, costInTokens: 2.5, costInDollars: 0.028, label: 'Обычный режим' },
      //   ],
      //   uiParameters: [
      //     {
      //       key: 'mode', label: 'Режим генерации', type: 'select', affectsPrice: true, defaultValue: 'draft',
      //       options: [
      //         { value: 'draft', label: 'Обычный (2.5🔥)' },
      //         { value: 'fast', label: 'Быстрый (5🔥)' },
      //         { value: 'turbo', label: 'Турбо (9.5🔥)' },
      //       ],
      //     },
      //     {
      //       key: 'aspectRatio', label: 'Соотношение сторон', type: 'select', affectsPrice: false, defaultValue: '1:1',
      //       options: [
      //         { value: '1:1', label: 'Квадрат (1:1)' },
      //         { value: '16:9', label: 'Горизонталь (16:9)' },
      //         { value: '9:16', label: 'Вертикаль (9:16)' },
      //         { value: '3:2', label: 'Фото (3:2)' },
      //         { value: '2:3', label: 'Портрет (2:3)' },
      //       ],
      //     },
      //   ],
      // },
      {
        slug: 'seedream-5-lite',
        name: 'Seedream 5.0 Lite',
        displayName: 'Seedream 5.0 Lite',
        description: 'Быстрый генератор Seedream',
        type: 'image',
        fixedCostPerGeneration: 0.0178,
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
        fixedCostPerGeneration: 0.0133,
        tokensPerDollar: 90,
        minTokenCost: 1.2,
        sortOrder: 2,
        capabilities: [],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'google/imagen4-fast', priority: 1, isActive: true },
          { providerSlug: 'evolink', modelId: 'imagen-3', priority: 2, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
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
        minTokenCost: 1.8,
        sortOrder: 7,
        capabilities: ['text_to_image', 'image_to_image'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'flux-2/flex-text-to-image', priority: 1, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024, steps: 28 },
        limits: { maxResolution: '2048x2048' },
        inputCapabilities: { acceptsImages: true, maxInputImages: 8 }, // 🆕 фото → авто iti
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
      // {
      //   slug: 'flux-2-img2img',
      //   name: 'Flux 2 Img2Img',
      //   displayName: 'Flux 2 (Image to Image)',
      //   description: 'Flux 2 для трансформации изображений',
      //   type: 'image',
      //   fixedCostPerGeneration: 0.025,
      //   tokensPerDollar: 90,
      //   minTokenCost: 1.8,
      //   sortOrder: 8,
      //   capabilities: ['image_to_image'],
      //   providerMappings: [
      //     { providerSlug: 'kie', modelId: 'flux-2/flex-image-to-image', priority: 1, isActive: true },
      //   ],
      //   defaultParams: { width: 1024, height: 1024, steps: 28 },
      //   limits: { maxResolution: '2048x2048' },
      //   inputCapabilities: { acceptsImages: true, maxInputImages: 8 },
      //   pricingMatrix: [
      //     { conditions: { version: 'flex', resolution: '2K' }, costInTokens: 7.5, costInDollars: 0.12, label: 'Flex × 2K' },
      //     { conditions: { version: 'flex', resolution: '1K' }, costInTokens: 5, costInDollars: 0.07, label: 'Flex × 1K' },
      //     { conditions: { version: 'pro', resolution: '2K' }, costInTokens: 2, costInDollars: 0.035, label: 'Pro × 2K' },
      //     { conditions: { version: 'pro', resolution: '1K' }, costInTokens: 1.8, costInDollars: 0.025, label: 'Pro × 1K' },
      //   ],
      //   uiParameters: [
      //     {
      //       key: 'version', label: 'Версия модели', type: 'select', affectsPrice: true, defaultValue: 'pro',
      //       options: [
      //         { value: 'flex', label: 'Flex (от 5🔥)' },
      //         { value: 'pro', label: 'Pro (от 1.8🔥)' },
      //       ],
      //     },
      //     {
      //       key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '1K',
      //       options: [
      //         { value: '1K', label: '1K (1024×1024)' },
      //         { value: '2K', label: '2K (2048×2048)' },
      //       ],
      //     },
      //   ],
      // },
      {
        slug: 'nano-banana-2',
        name: 'Nano Banana 2',
        displayName: 'Nano Banana 2',
        description: 'Стандартная версия Nano Banana (Gemini 3.1 Flash Image)',
        type: 'image',
        fixedCostPerGeneration: 0.04,
        tokensPerDollar: 90,
        minTokenCost: 3.3,
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
        minTokenCost: 6,
        sortOrder: 10,
        capabilities: [],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'nano-banana-pro', priority: 1, isActive: true },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '4096x4096' },
        inputCapabilities: { acceptsImages: true, maxInputImages: 8 },
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

      // ─── Veo 3.1 Lite (KIE) ─────────────────────────────
      {
        slug: 'veo3_lite',
        name: 'Veo 3.1 Lite',
        displayName: 'Google Veo 3.1 Lite',
        description: 'Самая доступная модель Veo 3.1 — быстрая генерация видео с аудио',
        type: 'video',
        fixedCostPerGeneration: 0.40,
        tokensPerDollar: 90,
        minTokenCost: 9,
        sortOrder: 1,
        capabilities: ['text_to_video', 'image_to_video', 'audio'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'veo3_lite', priority: 1, isActive: true },
        ],
        defaultParams: { aspectRatio: '16:9', duration: 4 },
        limits: { maxDuration: 8 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 3 },
        pricingMatrix: [
          // duration × resolution
          { conditions: { duration: 8, resolution: '720p' }, costInTokens: 9, costInDollars: 0.40, label: '8с × 720p' },
          { conditions: { duration: 8, resolution: '1080p' }, costInTokens: 12.7, costInDollars: 0.60, label: '8с × 1080p' },
          { conditions: { duration: 8, resolution: '4k' }, costInTokens: 45.4, costInDollars: 1.20, label: '8с × 4K' },
          { conditions: { duration: 6, resolution: '720p' }, costInTokens: 9, costInDollars: 0.30, label: '6с × 720p' },
          { conditions: { duration: 6, resolution: '1080p' }, costInTokens: 12.7, costInDollars: 0.45, label: '6с × 1080p' },
          { conditions: { duration: 6, resolution: '4k' }, costInTokens: 45.4, costInDollars: 0.90, label: '6с × 4K' },
          { conditions: { duration: 4, resolution: '720p' }, costInTokens: 9, costInDollars: 0.20, label: '4с × 720p' },
          { conditions: { duration: 4, resolution: '1080p' }, costInTokens: 12.7, costInDollars: 0.30, label: '4с × 1080p' },
          { conditions: { duration: 4, resolution: '4k' }, costInTokens: 45.4, costInDollars: 0.60, label: '4с × 4K' },
        ],
        uiParameters: [
          {
            key: 'duration', label: 'Длительность', type: 'select', affectsPrice: true, defaultValue: 8,
            options: [
              { value: 4, label: '4 секунды' },
              { value: 6, label: '6 секунд' },
              { value: 8, label: '8 секунд' },
            ],
          },
          {
            key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '720p',
            options: [
              { value: '720p', label: '720p (от 9🔥)' },
              { value: '1080p', label: '1080p (от 12.7🔥)' },
              { value: '4k', label: '4K (от 45.4🔥)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Формат', type: 'select', affectsPrice: false, defaultValue: '16:9',
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
            ],
          },
        ],
      },

      // ─── Veo 3.1 Fast (KIE) ─────────────────────────────
      {
        slug: 'veo3_fast',
        name: 'Veo 3.1 Fast',
        displayName: 'Google Veo 3.1 Fast',
        description: 'Быстрая и сбалансированная модель Veo 3.1 с высоким качеством',
        type: 'video',
        fixedCostPerGeneration: 0.70,
        tokensPerDollar: 90,
        minTokenCost: 18,
        sortOrder: 2,
        capabilities: ['text_to_video', 'image_to_video', 'audio', 'reference_to_video'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'veo3_fast', priority: 1, isActive: true },
        ],
        defaultParams: { aspectRatio: '16:9', duration: 4 },
        limits: { maxDuration: 4 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 3 },
        pricingMatrix: [
          { conditions: { duration: 8, resolution: '720p' }, costInTokens: 18, costInDollars: 0.70, label: '8с × 720p' },
          { conditions: { duration: 8, resolution: '1080p' }, costInTokens: 19.7, costInDollars: 1.05, label: '8с × 1080p' },
          { conditions: { duration: 8, resolution: '4k' }, costInTokens: 54, costInDollars: 2.10, label: '8с × 4K' },
          { conditions: { duration: 6, resolution: '720p' }, costInTokens: 18, costInDollars: 0.525, label: '6с × 720p' },
          { conditions: { duration: 6, resolution: '1080p' }, costInTokens: 19.4, costInDollars: 0.788, label: '6с × 1080p' },
          { conditions: { duration: 6, resolution: '4k' }, costInTokens: 54, costInDollars: 1.575, label: '6с × 4K' },
          { conditions: { duration: 4, resolution: '720p' }, costInTokens: 18, costInDollars: 0.35, label: '4с × 720p' },
          { conditions: { duration: 4, resolution: '1080p' }, costInTokens: 19.7, costInDollars: 0.525, label: '4с × 1080p' },
          { conditions: { duration: 4, resolution: '4k' }, costInTokens: 54, costInDollars: 1.05, label: '4с × 4K' },
        ],
        uiParameters: [
          {
            key: 'duration', label: 'Длительность', type: 'select', affectsPrice: true, defaultValue: 8,
            options: [
              { value: 4, label: '4 секунды' },
              { value: 6, label: '6 секунд' },
              { value: 8, label: '8 секунд' },
            ],
          },
          {
            key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '720p',
            options: [
              { value: '720p', label: '720p (от 18🔥)' },
              { value: '1080p', label: '1080p (от 19.7🔥)' },
              { value: '4k', label: '4K (от 54🔥)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Формат', type: 'select', affectsPrice: false, defaultValue: '16:9',
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
            ],
          },
        ],
      },

      // ─── Veo 3.1 Quality (KIE) ──────────────────────────
      {
        slug: 'veo3',
        name: 'Veo 3.1 Quality',
        displayName: 'Google Veo 3.1 Quality',
        description: 'Флагманская модель Veo 3.1 — максимальное качество и реализм',
        type: 'video',
        fixedCostPerGeneration: 2.50,
        tokensPerDollar: 90,
        minTokenCost: 75.4,
        sortOrder: 3,
        isPremium: true,
        capabilities: ['text_to_video', 'image_to_video', 'audio'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'veo3', priority: 1, isActive: true },
        ],
        defaultParams: { aspectRatio: '16:9', duration: 4 },
        limits: { maxDuration: 8 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 2 },
        pricingMatrix: [
          { conditions: { duration: 8, resolution: '720p' }, costInTokens: 75.4, costInDollars: 2.50, label: '8с × 720p' },
          { conditions: { duration: 8, resolution: '1080p' }, costInTokens: 76.7, costInDollars: 3.75, label: '8с × 1080p' },
          { conditions: { duration: 8, resolution: '4k' }, costInTokens: 111.4, costInDollars: 7.50, label: '8с × 4K' },
          { conditions: { duration: 6, resolution: '720p' }, costInTokens: 75.4, costInDollars: 1.875, label: '6с × 720p' },
          { conditions: { duration: 6, resolution: '1080p' }, costInTokens: 76.7, costInDollars: 2.813, label: '6с × 1080p' },
          { conditions: { duration: 6, resolution: '4k' }, costInTokens: 111.4, costInDollars: 5.625, label: '6с × 4K' },
          { conditions: { duration: 4, resolution: '720p' }, costInTokens: 75.4, costInDollars: 1.25, label: '4с × 720p' },
          { conditions: { duration: 4, resolution: '1080p' }, costInTokens: 76.7, costInDollars: 1.875, label: '4с × 1080p' },
          { conditions: { duration: 4, resolution: '4k' }, costInTokens: 111.4, costInDollars: 3.75, label: '4с × 4K' },
        ],
        uiParameters: [
          {
            key: 'duration', label: 'Длительность', type: 'select', affectsPrice: true, defaultValue: 8,
            options: [
              { value: 4, label: '4 секунды' },
              { value: 6, label: '6 секунд' },
              { value: 8, label: '8 секунд' },
            ],
          },
          {
            key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '720p',
            options: [
              { value: '720p', label: '720p (от 75.4🔥)' },
              { value: '1080p', label: '1080p (от 76.7🔥)' },
              { value: '4k', label: '4K (от 111.4🔥)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Формат', type: 'select', affectsPrice: false, defaultValue: '16:9',
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
            ],
          },
        ],
      },

      // ─── Sora 2 (Evolink) ────────────────────────────────
      {
        slug: 'sora-2',
        name: 'Sora 2',
        displayName: 'OpenAI Sora 2',
        description: 'Видеогенерация нового поколения от OpenAI — реалистичная физика и движение',
        type: 'video',
        fixedCostPerGeneration: 0.222,
        tokensPerDollar: 90,
        minTokenCost: 20,
        sortOrder: 4,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'sora-2-preview', priority: 1, isActive: true },
        ],
        defaultParams: { aspectRatio: '16:9', duration: 4 },
        limits: { maxDuration: 12 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 10 },
        pricingMatrix: [
          { conditions: { duration: 4 }, costInTokens: 20, costInDollars: 0.222, label: '4 секунды' },
          { conditions: { duration: 8 }, costInTokens: 41, costInDollars: 0.456, label: '8 секунд' },
          { conditions: { duration: 12 }, costInTokens: 61, costInDollars: 0.678, label: '12 секунд' },
        ],
        uiParameters: [
          {
            key: 'duration', label: 'Длительность', type: 'select', affectsPrice: true, defaultValue: 4,
            options: [
              { value: 4, label: '4 секунды (20🔥)' },
              { value: 8, label: '8 секунд (41🔥)' },
              { value: 12, label: '12 секунд (61🔥)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Формат', type: 'select', affectsPrice: false, defaultValue: '16:9',
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
            ],
          },
          {
            key: 'resizeMode', label: 'Вписывание изображения', type: 'select', affectsPrice: false, defaultValue: 'crop',
            description: 'Применяется только при загрузке изображения',
            options: [
              { value: 'crop', label: 'Обрезать (Crop)' },
              { value: 'pad', label: 'Вписать с полями (Pad)' },
            ],
          },
        ],
      },

      // ─── Sora 2 Pro (Evolink) ────────────────────────────
      {
        slug: 'sora-2-pro',
        name: 'Sora 2 Pro',
        displayName: 'OpenAI Sora 2 Pro',
        description: 'Профессиональная версия Sora 2 — максимальное качество 1080p',
        type: 'video',
        fixedCostPerGeneration: 0.444,
        tokensPerDollar: 90,
        minTokenCost: 61,
        sortOrder: 5,
        isPremium: true,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          { providerSlug: 'evolink', modelId: 'sora-2-pro-preview', priority: 1, isActive: true },
        ],
        defaultParams: { aspectRatio: '16:9', duration: 4, resolution: '720p' },
        limits: { maxDuration: 12 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 10 },
        pricingMatrix: [
          { conditions: { duration: 4, resolution: '720p' }, costInTokens: 61, costInDollars: 0.444, label: '4с × 720p' },
          { conditions: { duration: 4, resolution: '1080p' }, costInTokens: 102, costInDollars: 0.741, label: '4с × 1080p' },
          { conditions: { duration: 8, resolution: '720p' }, costInTokens: 122, costInDollars: 0.889, label: '8с × 720p' },
          { conditions: { duration: 8, resolution: '1080p' }, costInTokens: 203, costInDollars: 1.481, label: '8с × 1080p' },
          { conditions: { duration: 12, resolution: '720p' }, costInTokens: 183, costInDollars: 1.333, label: '12с × 720p' },
          { conditions: { duration: 12, resolution: '1080p' }, costInTokens: 305, costInDollars: 2.222, label: '12с × 1080p' },
        ],
        uiParameters: [
          {
            key: 'duration', label: 'Длительность', type: 'select', affectsPrice: true, defaultValue: 4,
            options: [
              { value: 4, label: '4 секунды' },
              { value: 8, label: '8 секунд' },
              { value: 12, label: '12 секунд' },
            ],
          },
          {
            key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '720p',
            options: [
              { value: '720p', label: '720p (от 61🔥)' },
              { value: '1080p', label: '1080p (от 102🔥)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Формат', type: 'select', affectsPrice: false, defaultValue: '16:9',
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
            ],
          },
          {
            key: 'resizeMode', label: 'Вписывание изображения', type: 'select', affectsPrice: false, defaultValue: 'crop',
            description: 'Применяется только при загрузке изображения',
            options: [
              { value: 'crop', label: 'Обрезать (Crop)' },
              { value: 'pad', label: 'Вписать с полями (Pad)' },
            ],
          },
        ],
      },

      // ─── Kling 2.5 Turbo Pro (KIE) ──────────────────────
      {
        slug: 'kling-2.5-turbo',
        name: 'Kling 2.5 Turbo',
        displayName: 'Kling 2.5 Turbo Pro',
        description: 'Быстрая текстовая видеомодель Kling — кинематографичное 1080p',
        type: 'video',
        fixedCostPerGeneration: 0.156,
        tokensPerDollar: 90,
        minTokenCost: 14,
        sortOrder: 6,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'kling/v2-5-turbo-text-to-video-pro', priority: 1, isActive: true },
        ],
        defaultParams: { aspectRatio: '16:9', duration: 5, cfgScale: 0.5 },
        limits: { maxDuration: 10 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 2 },
        pricingMatrix: [
          { conditions: { duration: 5 }, costInTokens: 14, costInDollars: 0.156, label: '5 секунд' },
          { conditions: { duration: 10 }, costInTokens: 27, costInDollars: 0.300, label: '10 секунд' },
        ],
        uiParameters: [
          {
            key: 'duration', label: 'Длительность', type: 'select', affectsPrice: true, defaultValue: 5,
            options: [
              { value: 5, label: '5 секунд (14🔥)' },
              { value: 10, label: '10 секунд (27🔥)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Формат', type: 'select', affectsPrice: false, defaultValue: '16:9',
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '1:1', label: 'Квадрат (1:1)' },
            ],
          },
          {
            key: 'cfgScale', label: 'Креативность', type: 'slider', affectsPrice: false, defaultValue: 0.5,
            options: [],
          },
        ],
      },

      // ─── Kling 3.0 (KIE) ────────────────────────────────
      {
        slug: 'kling-3.0',
        name: 'Kling 3.0',
        displayName: 'Kling 3.0',
        description: 'Мощная видеомодель: мультисцены, элементы, старт/конец кадр, 4K',
        type: 'video',
        fixedCostPerGeneration: 0.24,
        tokensPerDollar: 90,
        minTokenCost: 12.9,
        sortOrder: 7,
        capabilities: ['text_to_video', 'image_to_video', 'audio', 'multi_shots', 'elements'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'kling-3.0/video', priority: 1, isActive: true },
        ],
        defaultParams: { aspectRatio: '16:9', duration: 5, mode: 'std', sound: false },
        limits: { maxDuration: 15 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 2 },
        pricingMatrix: (() => {
          const rows: any[] = [];
          const durations = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
          // [mode][sound] => ставка спичек за секунду
          const rate: Record<string, { off: number; on: number; label: string }> = {
            std: { off: 4.3, on: 6, label: 'Стандарт' },
            pro: { off: 5.7, on: 8.3, label: 'Pro' },
            '4K': { off: 20, on: 20, label: '4K' },
          };
          const dollarsPerToken = 1 / 90;
          for (const mode of ['std', 'pro', '4K']) {
            for (const sound of [false, true]) {
              const perSec = sound ? rate[mode].on : rate[mode].off;
              for (const d of durations) {
                const tokens = Math.round(perSec * d * 10) / 10;
                rows.push({
                  conditions: { mode, sound, duration: d },
                  costInTokens: tokens,
                  costInDollars: Math.round(tokens * dollarsPerToken * 1000) / 1000,
                  label: `${rate[mode].label} × ${d}с × ${sound ? 'со звуком' : 'без звука'}`,
                });
              }
            }
          }
          return rows;
        })(),
        uiParameters: [
          {
            key: 'mode', label: 'Режим качества', type: 'select', affectsPrice: true, defaultValue: 'std',
            options: [
              { value: 'std', label: 'Стандарт 720p (от 12.9🔥)' },
              { value: 'pro', label: 'Pro 1080p (от 17.1🔥)' },
              { value: '4K', label: '4K Ultra HD (от 60🔥)' },
            ],
          },
          {
            key: 'sound', label: 'Звук', type: 'boolean', affectsPrice: true, defaultValue: false,
            options: [
              { value: false, label: 'Без звука' },
              { value: true, label: 'Со звуком' },
            ],
          },
          {
            key: 'duration', label: 'Длительность', type: 'select', affectsPrice: true, defaultValue: 5,
            options: [
              { value: 3, label: '3 сек' }, { value: 4, label: '4 сек' },
              { value: 5, label: '5 сек' }, { value: 6, label: '6 сек' },
              { value: 7, label: '7 сек' }, { value: 8, label: '8 сек' },
              { value: 9, label: '9 сек' }, { value: 10, label: '10 сек' },
              { value: 11, label: '11 сек' }, { value: 12, label: '12 сек' },
              { value: 13, label: '13 сек' }, { value: 14, label: '14 сек' },
              { value: 15, label: '15 сек' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Формат', type: 'select', affectsPrice: false, defaultValue: '16:9',
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '1:1', label: 'Квадрат (1:1)' },
            ],
          },
        ],
      },

      // ─── Kling 3.0 Motion Control (KIE) ─────────────────
      {
        slug: 'motion-control',
        name: 'Motion Control',
        displayName: 'Kling Motion Control',
        description: 'Перенос движений из видео на персонажа с фото',
        type: 'video',
        fixedCostPerGeneration: 0.1, // справочно (реальная цена из pricingMatrix)
        tokensPerDollar: 90,
        minTokenCost: 27, // 720p × 3с
        sortOrder: 8,
        capabilities: ['image_to_video', 'motion_transfer'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'kling-3.0/motion-control', priority: 1, isActive: true },
        ],
        defaultParams: { mode: '720p', characterOrientation: 'video', duration: 5 },
        limits: { maxDuration: 30 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        pricingMatrix: (() => {
          const rows: any[] = [];
          const rate: Record<string, number> = { '720p': 9, '1080p': 12.3 };
          const dollarsPerToken = 1 / 90;
          for (const mode of ['720p', '1080p']) {
            for (let d = 3; d <= 30; d++) {
              const tokens = Math.round(rate[mode] * d * 10) / 10;
              rows.push({
                conditions: { mode, duration: d },
                costInTokens: tokens,
                costInDollars: Math.round(tokens * dollarsPerToken * 1000) / 1000,
                label: `${mode} × ${d}с`,
              });
            }
          }
          return rows;
        })(),
        uiParameters: [
          {
            key: 'characterOrientation', label: 'Источник ориентации', type: 'select', affectsPrice: false, defaultValue: 'video',
            options: [
              { value: 'video', label: 'По видео (до 30 сек)' },
              { value: 'image', label: 'По фото (до 10 сек)' },
            ],
          },
          {
            key: 'mode', label: 'Качество', type: 'select', affectsPrice: true, defaultValue: '720p',
            options: [
              { value: '720p', label: '720p (9🔥/сек)' },
              { value: '1080p', label: '1080p (12.3🔥/сек)' },
            ],
          },
          {
            key: 'duration', label: 'Длительность (из видео)', type: 'select', affectsPrice: true, defaultValue: 5,
            options: (() => {
              const opts: any[] = [];
              for (let d = 3; d <= 30; d++) opts.push({ value: d, label: `${d} сек` });
              return opts;
            })(),
          },
        ],
      },

      // ─── Runway (KIE) ────────────────────────────────────
      {
        slug: 'runway',
        name: 'Runway',
        displayName: 'Runway Gen-4',
        description: 'Профессиональная видеогенерация Runway',
        type: 'video',
        fixedCostPerGeneration: 0.067,
        tokensPerDollar: 90,
        minTokenCost: 6,
        sortOrder: 9,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'runway', priority: 1, isActive: true },
        ],
        defaultParams: { aspectRatio: '16:9', duration: 5, resolution: '720p' },
        limits: { maxDuration: 10 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        pricingMatrix: [
          { conditions: { duration: 5, resolution: '720p' }, costInTokens: 6, costInDollars: 0.067, label: '5с × 720p' },
          { conditions: { duration: 10, resolution: '720p' }, costInTokens: 15, costInDollars: 0.167, label: '10с × 720p' },
          { conditions: { duration: 5, resolution: '1080p' }, costInTokens: 15, costInDollars: 0.167, label: '5с × 1080p' },
        ],
        uiParameters: [
          {
            key: 'duration', label: 'Длительность', type: 'select', affectsPrice: true, defaultValue: 5,
            options: [
              { value: 5, label: '5 секунд' },
              { value: 10, label: '10 секунд' },
            ],
          },
          {
            key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '720p',
            options: [
              { value: '720p', label: '720p (от 6🔥)' },
              { value: '1080p', label: '1080p (15🔥, только 5с)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Формат', type: 'select', affectsPrice: false, defaultValue: '16:9',
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '1:1', label: 'Квадрат (1:1)' },
              { value: '4:3', label: 'Стандарт (4:3)' },
              { value: '3:4', label: 'Портрет (3:4)' },
            ],
          },
        ],
      },

      // ─── Hailuo 02 (KIE) — t2v/i2v standard+pro ──────────
      {
        slug: 'hailuo-02',
        name: 'Hailuo 02',
        displayName: 'Hailuo 02',
        description: 'Видеогенерация от MiniMax — текст или изображение в видео',
        type: 'video',
        fixedCostPerGeneration: 0.113,
        tokensPerDollar: 90,
        minTokenCost: 10.2,
        sortOrder: 10,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'hailuo/02-text-to-video-standard', priority: 1, isActive: true },
        ],
        defaultParams: { duration: 6, mode: 'standard' },
        limits: { maxDuration: 10 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        pricingMatrix: [
          { conditions: { mode: 'standard', duration: 6 }, costInTokens: 10.2, costInDollars: 0.113, label: 'Standard × 6с' },
          { conditions: { mode: 'standard', duration: 10 }, costInTokens: 17, costInDollars: 0.189, label: 'Standard × 10с' },
          { conditions: { mode: 'pro', duration: 6 }, costInTokens: 20.4, costInDollars: 0.227, label: 'Pro × 6с' },
          { conditions: { mode: 'pro', duration: 10 }, costInTokens: 34, costInDollars: 0.378, label: 'Pro × 10с' },
        ],
        uiParameters: [
          {
            key: 'mode', label: 'Качество', type: 'select', affectsPrice: true, defaultValue: 'standard',
            options: [
              { value: 'standard', label: 'Standard (1.7🔥/сек, от 10.2🔥)' },
              { value: 'pro', label: 'Pro (3.4🔥/сек, от 20.4🔥)' },
            ],
          },
          {
            key: 'duration', label: 'Длительность', type: 'select', affectsPrice: true, defaultValue: 6,
            options: [
              { value: 6, label: '6 секунд' },
              { value: 10, label: '10 секунд' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Формат', type: 'select', affectsPrice: false, defaultValue: '16:9',
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '1:1', label: 'Квадрат (1:1)' },
            ],
          },
        ],
      },
      // ─── Hailuo 2.3 Standard (KIE) — Image to Video ──────
      {
        slug: 'hailuo-2.3-standard',
        name: 'Hailuo 2.3 Standard',
        displayName: 'Hailuo 2.3 Standard',
        description: 'Оживление изображения от MiniMax — 768p/1080p, бюджетный',
        type: 'video',
        fixedCostPerGeneration: 0.1,
        tokensPerDollar: 90,
        minTokenCost: 9,
        sortOrder: 10.1,
        capabilities: ['image_to_video'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'hailuo/2-3-image-to-video-standard', priority: 1, isActive: true },
        ],
        defaultParams: { duration: 6, resolution: '768P' },
        limits: { maxDuration: 10 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        pricingMatrix: [
          // 1080p×10 НЕ поддерживается (заблокируется на фронте автоматически)
          { conditions: { resolution: '768P', duration: 6 }, costInTokens: 9, costInDollars: 0.1, label: '768p × 6с' },
          { conditions: { resolution: '768P', duration: 10 }, costInTokens: 15.8, costInDollars: 0.176, label: '768p × 10с' },
          { conditions: { resolution: '1080P', duration: 6 }, costInTokens: 15.8, costInDollars: 0.176, label: '1080p × 6с' },
        ],
        uiParameters: [
          {
            key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '768P',
            options: [
              { value: '768P', label: '768p (от 9🔥)' },
              { value: '1080P', label: '1080p (15.8🔥, только 6с)' },
            ],
          },
          {
            key: 'duration', label: 'Длительность', type: 'select', affectsPrice: true, defaultValue: 6,
            options: [
              { value: 6, label: '6 секунд' },
              { value: 10, label: '10 секунд' },
            ],
          },
        ],
      },

      // ─── Hailuo 2.3 Pro (KIE) — Image to Video ───────────
      {
        slug: 'hailuo-2.3-pro',
        name: 'Hailuo 2.3 Pro',
        displayName: 'Hailuo 2.3 Pro',
        description: 'Оживление изображения от MiniMax — улучшенное качество',
        type: 'video',
        fixedCostPerGeneration: 0.156,
        tokensPerDollar: 90,
        minTokenCost: 14,
        sortOrder: 10.2,
        isPremium: true,
        capabilities: ['image_to_video'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'hailuo/2-3-image-to-video-pro', priority: 1, isActive: true },
        ],
        defaultParams: { duration: 6, resolution: '768P' },
        limits: { maxDuration: 10 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        pricingMatrix: [
          // 1080p×10 НЕ поддерживается (заблокируется на фронте автоматически)
          { conditions: { resolution: '768P', duration: 6 }, costInTokens: 14, costInDollars: 0.156, label: '768p × 6с' },
          { conditions: { resolution: '768P', duration: 10 }, costInTokens: 27.3, costInDollars: 0.303, label: '768p × 10с' },
          { conditions: { resolution: '1080P', duration: 6 }, costInTokens: 30, costInDollars: 0.333, label: '1080p × 6с' },
        ],
        uiParameters: [
          {
            key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '768P',
            options: [
              { value: '768P', label: '768p (от 14🔥)' },
              { value: '1080P', label: '1080p (30🔥, только 6с)' },
            ],
          },
          {
            key: 'duration', label: 'Длительность', type: 'select', affectsPrice: true, defaultValue: 6,
            options: [
              { value: 6, label: '6 секунд' },
              { value: 10, label: '10 секунд' },
            ],
          },
        ],
      },

      // ─── WanX 2.2 (KIE) ─────────────────────────────────
      // {
      //   slug: 'wan-2.7',
      //   name: 'Wan 2.7',
      //   displayName: 'Wan 2.7',
      //   description: 'Видеогенерация от Alibaba с аудио и высокой детализацией',
      //   type: 'video',
      //   fixedCostPerGeneration: 0.067,
      //   tokensPerDollar: 90,
      //   minTokenCost: 6,
      //   sortOrder: 11,
      //   capabilities: ['text_to_video', 'image_to_video', 'audio'],
      //   providerMappings: [
      //     { providerSlug: 'kie', modelId: 'wan/2-7-text-to-video', priority: 1, isActive: true },
      //   ],
      //   defaultParams: { aspectRatio: '16:9', duration: 5, resolution: '720p' },
      //   limits: { maxDuration: 15 },
      //   inputCapabilities: { acceptsImages: true, maxInputImages: 2 },
      //   pricingMatrix: [
      //     // Wan 2.7 поддерживает только 720p / 1080p (480p НЕТ)
      //     { conditions: { duration: 5, resolution: '720p' }, costInTokens: 6, costInDollars: 0.067, label: '5с × 720p' },
      //     { conditions: { duration: 5, resolution: '1080p' }, costInTokens: 10, costInDollars: 0.111, label: '5с × 1080p' },
      //     { conditions: { duration: 10, resolution: '720p' }, costInTokens: 12, costInDollars: 0.133, label: '10с × 720p' },
      //     { conditions: { duration: 10, resolution: '1080p' }, costInTokens: 20, costInDollars: 0.222, label: '10с × 1080p' },
      //   ],
      //   uiParameters: [
      //     {
      //       key: 'duration', label: 'Длительность', type: 'select', affectsPrice: true, defaultValue: 5,
      //       options: [
      //         { value: 5, label: '5 секунд' },
      //         { value: 10, label: '10 секунд' },
      //       ],
      //     },
      //     {
      //       key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '720p',
      //       options: [
      //         { value: '720p', label: '720p (от 6🔥)' },
      //         { value: '1080p', label: '1080p (от 10🔥)' },
      //       ],
      //     },
      //     {
      //       key: 'aspectRatio', label: 'Формат', type: 'select', affectsPrice: false, defaultValue: '16:9',
      //       options: [
      //         { value: '16:9', label: 'Горизонталь (16:9)' },
      //         { value: '9:16', label: 'Вертикаль (9:16)' },
      //         { value: '1:1', label: 'Квадрат (1:1)' },
      //         { value: '4:3', label: 'Стандарт (4:3)' },
      //         { value: '3:4', label: 'Портрет (3:4)' },
      //       ],
      //     },
      //   ],
      // },

      // ─── Wan 2.5 (KIE) — t2v / i2v, аудио, lip-sync ──────
      // Цена: 720p=5.4🔥/сек, 1080p=8🔥/сек
      {
        slug: 'wan-2.5',
        name: 'Wan 2.5',
        displayName: 'Wan 2.5',
        description: 'Видеогенерация Alibaba Wan 2.5 — аудио, lip-sync, 720p/1080p',
        type: 'video',
        fixedCostPerGeneration: 0.3,
        tokensPerDollar: 90,
        minTokenCost: 27, // 720p × 5с
        sortOrder: 10.9,
        capabilities: ['text_to_video', 'image_to_video', 'audio'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'wan/2-5-text-to-video', priority: 1, isActive: true },
        ],
        defaultParams: { aspectRatio: '16:9', duration: 5, resolution: '720p' },
        limits: { maxDuration: 10 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 1 },
        pricingMatrix: (() => {
          const rows: any[] = [];
          const rate: Record<string, number> = { '720p': 5.4, '1080p': 8 };
          const dollarsPerToken = 1 / 90;
          for (const resolution of ['720p', '1080p']) {
            for (const duration of [5, 10]) {
              const tokens = Math.round(rate[resolution] * duration * 10) / 10;
              rows.push({
                conditions: { resolution, duration },
                costInTokens: tokens,
                costInDollars: Math.round(tokens * dollarsPerToken * 1000) / 1000,
                label: `${resolution} × ${duration}с`,
              });
            }
          }
          return rows;
        })(),
        uiParameters: [
          {
            key: 'duration', label: 'Длительность', type: 'select', affectsPrice: true, defaultValue: 5,
            options: [
              { value: 5, label: '5 секунд' },
              { value: 10, label: '10 секунд' },
            ],
          },
          {
            key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '720p',
            options: [
              { value: '720p', label: '720p (от 27🔥)' },
              { value: '1080p', label: '1080p (от 40🔥)' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Формат', type: 'select', affectsPrice: false, defaultValue: '16:9',
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '1:1', label: 'Квадрат (1:1)' },
            ],
          },
        ],
      },



      // ─── Seedance 1.5 Pro (KIE) — 480/720/1080 × 4/8/12 × звук ─
      {
        slug: 'seedance-1.5-pro',
        name: 'Seedance 1.5 Pro',
        displayName: 'Seedance 1.5 Pro',
        description: 'Видеогенерация от ByteDance с аудио — плавное движение',
        type: 'video',
        fixedCostPerGeneration: 0.031,
        tokensPerDollar: 90,
        minTokenCost: 2.8,
        sortOrder: 12,
        capabilities: ['text_to_video', 'image_to_video', 'audio'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'bytedance/seedance-1.5-pro', priority: 1, isActive: true },
        ],
        defaultParams: { aspectRatio: '16:9', duration: 4, resolution: '480p', sound: false },
        limits: { maxDuration: 12 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 2 },
        pricingMatrix: [
          // 480p
          { conditions: { resolution: '480p', duration: 4, sound: false }, costInTokens: 2.8, costInDollars: 0.031, label: '480p × 4с' },
          { conditions: { resolution: '480p', duration: 4, sound: true }, costInTokens: 5, costInDollars: 0.056, label: '480p × 4с + звук' },
          { conditions: { resolution: '480p', duration: 8, sound: false }, costInTokens: 5.2, costInDollars: 0.058, label: '480p × 8с' },
          { conditions: { resolution: '480p', duration: 8, sound: true }, costInTokens: 10, costInDollars: 0.111, label: '480p × 8с + звук' },
          { conditions: { resolution: '480p', duration: 12, sound: false }, costInTokens: 6.3, costInDollars: 0.07, label: '480p × 12с' },
          { conditions: { resolution: '480p', duration: 12, sound: true }, costInTokens: 12, costInDollars: 0.133, label: '480p × 12с + звук' },
          // 720p
          { conditions: { resolution: '720p', duration: 4, sound: false }, costInTokens: 5.2, costInDollars: 0.058, label: '720p × 4с' },
          { conditions: { resolution: '720p', duration: 4, sound: true }, costInTokens: 10, costInDollars: 0.111, label: '720p × 4с + звук' },
          { conditions: { resolution: '720p', duration: 8, sound: false }, costInTokens: 10.5, costInDollars: 0.117, label: '720p × 8с' },
          { conditions: { resolution: '720p', duration: 8, sound: true }, costInTokens: 20, costInDollars: 0.222, label: '720p × 8с + звук' },
          { conditions: { resolution: '720p', duration: 12, sound: false }, costInTokens: 13.5, costInDollars: 0.15, label: '720p × 12с' },
          { conditions: { resolution: '720p', duration: 12, sound: true }, costInTokens: 26.2, costInDollars: 0.291, label: '720p × 12с + звук' },
          // 1080p
          { conditions: { resolution: '1080p', duration: 4, sound: false }, costInTokens: 11.2, costInDollars: 0.124, label: '1080p × 4с' },
          { conditions: { resolution: '1080p', duration: 4, sound: true }, costInTokens: 22, costInDollars: 0.244, label: '1080p × 4с + звук' },
          { conditions: { resolution: '1080p', duration: 8, sound: false }, costInTokens: 22.5, costInDollars: 0.25, label: '1080p × 8с' },
          { conditions: { resolution: '1080p', duration: 8, sound: true }, costInTokens: 44.4, costInDollars: 0.493, label: '1080p × 8с + звук' },
          { conditions: { resolution: '1080p', duration: 12, sound: false }, costInTokens: 33.5, costInDollars: 0.372, label: '1080p × 12с' },
          { conditions: { resolution: '1080p', duration: 12, sound: true }, costInTokens: 66.4, costInDollars: 0.738, label: '1080p × 12с + звук' },
        ],
        uiParameters: [
          {
            key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '480p',
            options: [
              { value: '480p', label: '480p (от 2.8🔥)' },
              { value: '720p', label: '720p (от 5.2🔥)' },
              { value: '1080p', label: '1080p (от 11.2🔥)' },
            ],
          },
          {
            key: 'duration', label: 'Длительность', type: 'select', affectsPrice: true, defaultValue: 4,
            options: [
              { value: 4, label: '4 секунды' },
              { value: 8, label: '8 секунд' },
              { value: 12, label: '12 секунд' },
            ],
          },
          {
            key: 'sound', label: 'Звук', type: 'boolean', affectsPrice: true, defaultValue: false,
            options: [
              { value: false, label: 'Без звука' },
              { value: true, label: 'Со звуком' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Формат', type: 'select', affectsPrice: false, defaultValue: '16:9',
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '1:1', label: 'Квадрат (1:1)' },
              { value: '4:3', label: 'Стандарт (4:3)' },
              { value: '3:4', label: 'Портрет (3:4)' },
              { value: '21:9', label: 'Кино (21:9)' },
            ],
          },
        ],
      },

            // ─── Seedance 2 (KIE) ────────────────────────────────
      // Ставки заказчика (🔥/сек):
      //   noVideo:   480p=5.7,  720p=12.3, 1080p=30.6
      //   withVideo: 480p=3.45, 720p=7.5,  1080p=18.6
      // Без видео → matrix (noVideo × duration).
      // С видео → videoRefRatePerSecond × (out + refVideoSeconds) — формулой в билинге.
      {
        slug: 'seedance-2',
        name: 'Seedance 2',
        displayName: 'Seedance 2',
        description: 'Новое поколение ByteDance — мультиреференс (фото/видео/аудио), 4-15с',
        type: 'video',
        fixedCostPerGeneration: 0.137, // справочно (720p×5с noVideo = 61.5/90/5)
        tokensPerDollar: 90,
        minTokenCost: 13.8, // мин: 480p × 4с + видео (3.45×4)
        sortOrder: 12.1,
        isPremium: true,
        capabilities: ['text_to_video', 'image_to_video', 'audio', 'reference_to_video'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'bytedance/seedance-2', priority: 1, isActive: true },
        ],
        defaultParams: { aspectRatio: '16:9', duration: 5, resolution: '720p', sound: true },
        limits: { maxDuration: 15 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 10 },
        // 🆕 Формула для видео-референса (videoRef=true считается в билинге, НЕ в матрице)
        videoRefPricing: true,
        videoRefRatePerSecond: { '480p': 3.45, '720p': 7.5, '1080p': 18.6, '4k': 38.4 },
        // Матрица ТОЛЬКО для noVideo (videoRef=false)
        pricingMatrix: (() => {
          const rows: any[] = [];
          const rate: Record<string, number> = { '480p': 5.7, '720p': 12.3, '1080p': 30.6, '4k': 62.4 };
          const dollarsPerToken = 1 / 90;
          for (const resolution of ['480p', '720p', '1080p', '4k']) {
            for (let d = 4; d <= 15; d++) {
              const tokens = Math.round(rate[resolution] * d * 10) / 10;
              rows.push({
                conditions: { resolution, videoRef: false, duration: d },
                costInTokens: tokens,
                costInDollars: Math.round(tokens * dollarsPerToken * 1000) / 1000,
                label: `${resolution} × ${d}с`,
              });
            }
          }
          return rows;
        })(),
        uiParameters: [
          {
            key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '720p',
            options: [
              { value: '480p', label: '480p (от 13.8🔥)' },
              { value: '720p', label: '720p (от 30🔥)' },
              { value: '1080p', label: '1080p (от 74.4🔥)' },
              { value: '4k', label: '4K (от 153.6🔥)' },
            ],
          },
          {
            key: 'duration', label: 'Длительность', type: 'select', affectsPrice: true, defaultValue: 5,
            options: (() => {
              const o: any[] = [];
              for (let d = 4; d <= 15; d++) o.push({ value: d, label: `${d} сек` });
              return o;
            })(),
          },
          {
            key: 'videoRef', label: 'Видео-референс', type: 'boolean', affectsPrice: true, defaultValue: false,
            options: [
              { value: false, label: 'Без видео' },
              { value: true, label: 'С видео (+секунды референса)' },
            ],
          },
          {
            key: 'sound', label: 'Звук', type: 'boolean', affectsPrice: false, defaultValue: true,
            options: [
              { value: false, label: 'Без звука' },
              { value: true, label: 'Со звуком' },
            ],
          },
          {
            key: 'webSearch', label: 'Онлайн-поиск', type: 'boolean', affectsPrice: false, defaultValue: false,
            options: [
              { value: false, label: 'Выкл' },
              { value: true, label: 'Вкл' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Формат', type: 'select', affectsPrice: false, defaultValue: '16:9',
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '1:1', label: 'Квадрат (1:1)' },
              { value: '4:3', label: 'Стандарт (4:3)' },
              { value: '3:4', label: 'Портрет (3:4)' },
              { value: '21:9', label: 'Кино (21:9)' },
            ],
          },
        ],
      },

            // ─── Seedance 2 Fast (KIE) ───────────────────────────
      // Ставки заказчика (🔥/сек):
      //   noVideo:   480p=4.65, 720p=9.9
      //   withVideo: 480p=2.7,  720p=6
      {
        slug: 'seedance-2-fast',
        name: 'Seedance 2 Fast',
        displayName: 'Seedance 2 Fast',
        description: 'Быстрая версия Seedance 2 — 480p/720p, 4-15с',
        type: 'video',
        fixedCostPerGeneration: 0.11, // справочно (720p×5с noVideo = 49.5/90/5)
        tokensPerDollar: 90,
        minTokenCost: 10.8, // мин: 480p × 4с + видео (2.7×4)
        sortOrder: 12.2,
        capabilities: ['text_to_video', 'image_to_video', 'audio'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'bytedance/seedance-2-fast', priority: 1, isActive: true },
        ],
        defaultParams: { aspectRatio: '16:9', duration: 5, resolution: '720p', sound: true },
        limits: { maxDuration: 15 },
        inputCapabilities: { acceptsImages: true, maxInputImages: 10 },
        // 🆕 Формула для видео-референса
        videoRefPricing: true,
        videoRefRatePerSecond: { '480p': 2.7, '720p': 6 },
        pricingMatrix: (() => {
          const rows: any[] = [];
          const rate: Record<string, number> = { '480p': 4.65, '720p': 9.9 };
          const dollarsPerToken = 1 / 90;
          for (const resolution of ['480p', '720p']) {
            for (let d = 4; d <= 15; d++) {
              const tokens = Math.round(rate[resolution] * d * 10) / 10;
              rows.push({
                conditions: { resolution, videoRef: false, duration: d },
                costInTokens: tokens,
                costInDollars: Math.round(tokens * dollarsPerToken * 1000) / 1000,
                label: `${resolution} × ${d}с`,
              });
            }
          }
          return rows;
        })(),
        uiParameters: [
          {
            key: 'resolution', label: 'Разрешение', type: 'select', affectsPrice: true, defaultValue: '720p',
            options: [
              { value: '480p', label: '480p (от 10.8🔥)' },
              { value: '720p', label: '720p (от 24🔥)' },
            ],
          },
          {
            key: 'duration', label: 'Длительность', type: 'select', affectsPrice: true, defaultValue: 5,
            options: (() => {
              const o: any[] = [];
              for (let d = 4; d <= 15; d++) o.push({ value: d, label: `${d} сек` });
              return o;
            })(),
          },
          {
            key: 'videoRef', label: 'Видео-референс', type: 'boolean', affectsPrice: true, defaultValue: false,
            options: [
              { value: false, label: 'Без видео' },
              { value: true, label: 'С видео (+секунды референса)' },
            ],
          },
          {
            key: 'sound', label: 'Звук', type: 'boolean', affectsPrice: false, defaultValue: true,
            options: [
              { value: false, label: 'Без звука' },
              { value: true, label: 'Со звуком' },
            ],
          },
          {
            key: 'webSearch', label: 'Онлайн-поиск', type: 'boolean', affectsPrice: false, defaultValue: false,
            options: [
              { value: false, label: 'Выкл' },
              { value: true, label: 'Вкл' },
            ],
          },
          {
            key: 'aspectRatio', label: 'Формат', type: 'select', affectsPrice: false, defaultValue: '16:9',
            options: [
              { value: '16:9', label: 'Горизонталь (16:9)' },
              { value: '9:16', label: 'Вертикаль (9:16)' },
              { value: '1:1', label: 'Квадрат (1:1)' },
              { value: '4:3', label: 'Стандарт (4:3)' },
              { value: '3:4', label: 'Портрет (3:4)' },
              { value: '21:9', label: 'Кино (21:9)' },
            ],
          },
        ],
      },

      // ════════════════════════════════════════════════════
      // AUDIO МОДЕЛИ
      // ════════════════════════════════════════════════════

      // ─── Suno (KIE, V5) ─────────────────────────────────
      {
        slug: 'suno',
        name: 'Suno',
        displayName: 'Suno V5',
        description: 'Генерация музыки с вокалом — Suno V5',
        type: 'audio',
        fixedCostPerGeneration: 0.041,
        tokensPerDollar: 90,
        minTokenCost: 3.7,
        sortOrder: 1,
        capabilities: ['text_to_audio', 'music_generation'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'suno-v5', priority: 1, isActive: true },
        ],
        defaultParams: { customMode: false, instrumental: false },
        limits: {},
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        pricingMatrix: [
          { conditions: {}, costInTokens: 3.7, costInDollars: 0.041, label: 'Стандартная генерация' },
        ],
        uiParameters: [
          {
            key: 'customMode', label: 'Режим', type: 'boolean',
            affectsPrice: false, defaultValue: false,
            options: [
              { value: false, label: 'Авто' },
              { value: true, label: 'Custom Mode' },
            ],
          },
          {
            key: 'instrumental', label: 'Инструментал', type: 'boolean',
            affectsPrice: false, defaultValue: false,
            options: [
              { value: false, label: 'С вокалом' },
              { value: true, label: 'Инструментал' },
            ],
          },
          {
            key: 'style', label: 'Стиль', type: 'text',
            affectsPrice: false, placeholder: 'pop, rock, jazz...',
            visibleWhen: { customMode: [true] },
          },
          {
            key: 'title', label: 'Название трека', type: 'text',
            affectsPrice: false, placeholder: 'Название (опц.)',
            visibleWhen: { customMode: [true] },
          },
          {
            key: 'negativeTags', label: 'Исключить стили', type: 'text',
            affectsPrice: false, placeholder: 'heavy metal, screamo...',
            visibleWhen: { customMode: [true] },
          },
          {
            key: 'vocalGender', label: 'Голос', type: 'select',
            affectsPrice: false, defaultValue: '',
            options: [
              { value: '', label: 'Авто' },
              { value: 'm', label: 'Мужской' },
              { value: 'f', label: 'Женский' },
            ],
            visibleWhen: { customMode: [true], instrumental: [false] },
          },
          {
            key: 'styleWeight', label: 'Вес стиля', type: 'number',
            affectsPrice: false, defaultValue: 0.65, min: 0, max: 1, step: 0.05,
            visibleWhen: { customMode: [true] },
          },
          {
            key: 'weirdnessConstraint', label: 'Экспериментальность', type: 'number',
            affectsPrice: false, defaultValue: 0.5, min: 0, max: 1, step: 0.05,
            visibleWhen: { customMode: [true] },
          },
          {
            key: 'audioWeight', label: 'Вес аудио', type: 'number',
            affectsPrice: false, defaultValue: 0.65, min: 0, max: 1, step: 0.05,
            visibleWhen: { customMode: [true] },
          },
        ],
      },

      // ─── ElevenLabs TTS Multilingual v2 (KIE) ────────────
      // 🆕 Посимвольная тарификация: 5.4🔥 за 1000 символов
      {
        slug: 'elevenlabs-tts-multilingual-v2',
        name: 'ElevenLabs TTS Multilingual v2',
        displayName: 'ElevenLabs TTS Multilingual v2',
        description: 'Многоязычный синтез речи от ElevenLabs (5.4🔥 за 1000 символов)',
        type: 'audio',
        // 🆕 Посимвольная тарификация
        charBasedPricing: true,
        pricePerThousandChars: 5.4,
        // Минимум за вызов (защита от копеечных списаний)
        minTokenCost: 1,
        // Справочно (legacy fields, не используются при charBasedPricing=true)
        fixedCostPerGeneration: 0.06,
        tokensPerDollar: 90,
        sortOrder: 5,
        capabilities: ['text_to_speech'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'elevenlabs/text-to-speech-multilingual-v2', priority: 1, isActive: true },
        ],
        defaultParams: { voice: 'Rachel', stability: 0.5, similarity_boost: 0.75, speed: 1.0 },
        limits: { maxTextLength: 5000 },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        // pricingMatrix не используется (charBasedPricing имеет приоритет)
        pricingMatrix: [],
        uiParameters: [
          {
            key: 'voice', label: 'Голос', type: 'select', affectsPrice: false, defaultValue: 'Rachel',
            options: [
              { value: 'Rachel', label: 'Rachel (EN, женский)' },
              { value: 'Adam', label: 'Adam (EN, мужской)' },
              { value: 'Antoni', label: 'Antoni (EN, мужской)' },
              { value: 'Arnold', label: 'Arnold (EN, мужской)' },
              { value: 'Bella', label: 'Bella (EN, женский)' },
              { value: 'Domi', label: 'Domi (EN, женский)' },
              { value: 'Elli', label: 'Elli (EN, женский)' },
              { value: 'Josh', label: 'Josh (EN, мужской)' },
              { value: 'Sam', label: 'Sam (EN, мужской)' },
            ],
          },
          {
            key: 'stability', label: 'Стабильность', type: 'number', affectsPrice: false, defaultValue: 0.5,
            min: 0, max: 1, step: 0.05, options: [],
          },
          {
            key: 'similarity_boost', label: 'Сходство', type: 'number', affectsPrice: false, defaultValue: 0.75,
            min: 0, max: 1, step: 0.05, options: [],
          },
          {
            key: 'speed', label: 'Скорость (1× = 100%)', type: 'number', affectsPrice: false, defaultValue: 1.0,
            min: 0.7, max: 1.2, step: 0.05, options: [],
          },
        ],
      },

      // ─── ElevenLabs TTS Turbo 2.5 (KIE) ─────────────────
      // 🆕 Посимвольная тарификация: 2.7🔥 за 1000 символов
      {
        slug: 'elevenlabs-tts-turbo-2-5',
        name: 'ElevenLabs TTS Turbo 2.5',
        displayName: 'ElevenLabs TTS Turbo 2.5',
        description: 'Быстрый синтез речи — ElevenLabs Turbo 2.5 (2.7🔥 за 1000 символов)',
        type: 'audio',
        // 🆕 Посимвольная тарификация
        charBasedPricing: true,
        pricePerThousandChars: 2.7,
        minTokenCost: 0.5,
        // Справочно (legacy fields, не используются при charBasedPricing=true)
        fixedCostPerGeneration: 0.03,
        tokensPerDollar: 90,
        sortOrder: 4,
        capabilities: ['text_to_speech'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'elevenlabs/text-to-speech-turbo-2-5', priority: 1, isActive: true },
        ],
        defaultParams: { voice: 'Rachel', stability: 0.5, similarity_boost: 0.75, speed: 1.0 },
        limits: { maxTextLength: 5000 },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        pricingMatrix: [],
        uiParameters: [
          {
            key: 'voice', label: 'Голос', type: 'select', affectsPrice: false, defaultValue: 'Rachel',
            options: [
              { value: 'Rachel', label: 'Rachel (EN, женский)' },
              { value: 'Adam', label: 'Adam (EN, мужской)' },
              { value: 'Josh', label: 'Josh (EN, мужской)' },
              { value: 'Bella', label: 'Bella (EN, женский)' },
              { value: 'Sam', label: 'Sam (EN, мужской)' },
            ],
          },
          {
            key: 'stability', label: 'Стабильность', type: 'number', affectsPrice: false, defaultValue: 0.5,
            min: 0, max: 1, step: 0.05, options: [],
          },
          {
            key: 'similarity_boost', label: 'Сходство', type: 'number', affectsPrice: false, defaultValue: 0.75,
            min: 0, max: 1, step: 0.05, options: [],
          },
          {
            key: 'speed', label: 'Скорость (1× = 100%)', type: 'number', affectsPrice: false, defaultValue: 1.0,
            min: 0.7, max: 1.2, step: 0.05, options: [],
          },
        ],
      },

      // ─── ElevenLabs Sound Effect v2 (KIE) ────────────────
      // {
      //   slug: 'elevenlabs-sound-effect-v2',
      //   name: 'ElevenLabs Sound Effect v2',
      //   displayName: 'ElevenLabs Sound Effect v2',
      //   description: 'Генерация звуковых эффектов от ElevenLabs',
      //   type: 'audio',
      //   fixedCostPerGeneration: 0.022,
      //   tokensPerDollar: 90,
      //   minTokenCost: 2,
      //   sortOrder: 5,
      //   capabilities: ['text_to_audio', 'sound_effects'],
      //   providerMappings: [
      //     { providerSlug: 'kie', modelId: 'elevenlabs/sound-effect-v2', priority: 1, isActive: true },
      //   ],
      //   defaultParams: { duration_seconds: 5, loop: false, prompt_influence: 0.3 },
      //   limits: { maxDuration: 22 },
      //   inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
      //   pricingMatrix: [
      //     { costInTokens: 2, costInDollars: 0.022, label: 'Стандартная генерация' },
      //   ],
      //   uiParameters: [
      //     {
      //       key: 'duration_seconds', label: 'Длительность (сек)', type: 'slider', affectsPrice: false, defaultValue: 5,
      //       options: [],
      //     },
      //     {
      //       key: 'loop', label: 'Зацикленный', type: 'boolean', affectsPrice: false, defaultValue: false,
      //       options: [
      //         { value: false, label: 'Нет' },
      //         { value: true, label: 'Да' },
      //       ],
      //     },
      //     {
      //       key: 'prompt_influence', label: 'Влияние промпта', type: 'slider', affectsPrice: false, defaultValue: 0.3,
      //       options: [],
      //     },
      //   ],
      // },

      // ─── ElevenLabs Text-to-Dialogue v3 (KIE) ────────────
      // 🆕 Посимвольная тарификация: 6.7🔥 за 1000 символов
      {
        slug: 'elevenlabs-text-to-dialogue-v3',
        name: 'ElevenLabs Text-to-Dialogue v3',
        displayName: 'ElevenLabs Dialogue v3',
        description: 'Генерация диалогов с несколькими голосами от ElevenLabs (6.7🔥 за 1000 символов)',
        type: 'audio',
        // 🆕 Посимвольная тарификация
        charBasedPricing: true,
        pricePerThousandChars: 6.7,
        minTokenCost: 1,
        // Справочно (legacy fields, не используются при charBasedPricing=true)
        fixedCostPerGeneration: 0.074,
        tokensPerDollar: 90,
        sortOrder: 6,
        capabilities: ['text_to_speech', 'dialogue'],
        providerMappings: [
          { providerSlug: 'kie', modelId: 'elevenlabs/text-to-dialogue-v3', priority: 1, isActive: true },
        ],
        defaultParams: { stability: 0.5, speed: 1.0 },
        limits: { maxTextLength: 5000 },
        inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
        pricingMatrix: [],
        uiParameters: [
          {
            key: 'stability', label: 'Стабильность', type: 'number', affectsPrice: false, defaultValue: 0.5,
            min: 0, max: 1, step: 0.05, options: [],
          },
          {
            key: 'speed', label: 'Скорость (1× = 100%)', type: 'number', affectsPrice: false, defaultValue: 1.0,
            min: 0.7, max: 1.2, step: 0.05, options: [],
          },
          {
            key: 'language_code', label: 'Язык', type: 'select', affectsPrice: false, defaultValue: '',
            options: [
              { value: '', label: 'Авто' },
              { value: 'en', label: 'English' },
              { value: 'ru', label: 'Русский' },
              { value: 'de', label: 'Deutsch' },
              { value: 'fr', label: 'Français' },
              { value: 'es', label: 'Español' },
              { value: 'it', label: 'Italiano' },
              { value: 'zh', label: '中文' },
              { value: 'ja', label: '日本語' },
              { value: 'ko', label: '한국어' },
            ],
          },
        ],
      },

      // ─── ElevenLabs Audio Isolation (KIE) ────────────────
      // {
      //   slug: 'elevenlabs-audio-isolation',
      //   name: 'ElevenLabs Audio Isolation',
      //   displayName: 'ElevenLabs Audio Isolation',
      //   description: 'Удаление фонового шума и изоляция голоса от ElevenLabs',
      //   type: 'audio',
      //   fixedCostPerGeneration: 0.033,
      //   tokensPerDollar: 90,
      //   minTokenCost: 3,
      //   sortOrder: 7,
      //   capabilities: ['audio_processing', 'noise_removal'],
      //   providerMappings: [
      //     { providerSlug: 'kie', modelId: 'elevenlabs/audio-isolation', priority: 1, isActive: true },
      //   ],
      //   defaultParams: {},
      //   limits: {},
      //   inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
      //   pricingMatrix: [
      //     { costInTokens: 3, costInDollars: 0.033, label: 'Стандартная обработка' },
      //   ],
      //   uiParameters: [],
      // },

      // ─── ElevenLabs Speech-to-Text (KIE) ─────────────────
      //     {
      //       slug: 'elevenlabs-speech-to-text',
      //       name: 'ElevenLabs Speech-to-Text',
      //       displayName: 'ElevenLabs Speech-to-Text',
      //       description: 'Точное распознавание речи с диаризацией от ElevenLabs',
      //       type: 'audio',
      //       fixedCostPerGeneration: 0.033,
      //       tokensPerDollar: 90,
      //       minTokenCost: 3,
      //       sortOrder: 8,
      //       capabilities: ['speech_to_text', 'transcription'],
      //       providerMappings: [
      //         { providerSlug: 'kie', modelId: 'elevenlabs/speech-to-text', priority: 1, isActive: true },
      //       ],
      //       defaultParams: { diarize: false, tag_audio_events: false },
      //       limits: {},
      //       inputCapabilities: { acceptsImages: false, maxInputImages: 0 },
      //       pricingMatrix: [
      //         { costInTokens: 3, costInDollars: 0.033, label: 'Стандартная транскрипция' },
      //       ],
      //       uiParameters: [
      //         {
      //           key: 'diarize', label: 'Диаризация', type: 'boolean', affectsPrice: false, defaultValue: false,
      //           options: [
      //             { value: false, label: 'Выкл' },
      //             { value: true, label: 'Вкл' },
      //           ],
      //         },
      //         {
      //           key: 'tag_audio_events', label: 'Аудио-события', type: 'boolean', affectsPrice: false, defaultValue: false,
      //           options: [
      //             { value: false, label: 'Выкл' },
      //             { value: true, label: 'Вкл' },
      //           ],
      //         },
      //         {
      //           key: 'language_code', label: 'Язык', type: 'select', affectsPrice: false, defaultValue: '',
      //           options: [
      //             { value: '', label: 'Авто' },
      //             { value: 'en', label: 'English' },
      //             { value: 'ru', label: 'Русский' },
      //             { value: 'de', label: 'Deutsch' },
      //             { value: 'fr', label: 'Français' },
      //             { value: 'es', label: 'Español' },
      //             { value: 'zh', label: '中文' },
      //             { value: 'ja', label: '日本語' },
      //           ],
      //         },
      //       ],
      //     },
    ];
  }
}