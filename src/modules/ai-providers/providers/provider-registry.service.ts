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

  private async seedDefaultModels() {
    const existingCount = await this.modelModel.countDocuments();
    this.logger.log(
      `🌱 Syncing ${existingCount > 0 ? 'existing' : 'new'} AI models...`,
    );

    const defaultModels = [
      // ==============================
      // ТЕКСТОВЫЕ МОДЕЛИ
      // ==============================
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
          {
            providerSlug: 'openrouter',
            modelId: 'openai/gpt-oss-120b',
            priority: 1,
            isActive: true,
          },
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
          {
            providerSlug: 'openrouter',
            modelId: 'anthropic/claude-haiku-4-5-20250620',
            priority: 1,
            isActive: true,
          },
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
          {
            providerSlug: 'openrouter',
            modelId: 'deepseek/deepseek-v3.2',
            priority: 1,
            isActive: true,
          },
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
          {
            providerSlug: 'openrouter',
            modelId: 'x-ai/grok-4.1-fast',
            priority: 1,
            isActive: true,
          },
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
          {
            providerSlug: 'openrouter',
            modelId: 'x-ai/grok-4',
            priority: 1,
            isActive: true,
          },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: {
          maxInputTokens: 256000,
          maxOutputTokens: 8192,
          includedInPlans: ['pro', 'unlimited'],
        },
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
          {
            providerSlug: 'openrouter',
            modelId: 'perplexity/sonar',
            priority: 1,
            isActive: true,
          },
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
        // 14$ per 1M tokens (in+out одинаковая цена по доке Evolink)
        costPerMillionInputTokens: 14.0,
        costPerMillionOutputTokens: 14.0,
        tokensPerDollar: 1000,
        minTokenCost: 10,
        sortOrder: 7,
        isPremium: true,
        capabilities: ['streaming', 'vision', 'function_calling'],
        providerMappings: [
          {
            // Evolink model ID из документации
            providerSlug: 'evolink',
            modelId: 'gpt-5.4',
            priority: 1,
            isActive: true,
          },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: {
          maxInputTokens: 128000,
          maxOutputTokens: 16384,
          includedInPlans: ['unlimited'],
        },
      },
      {
        slug: 'claude-opus-4.6',
        name: 'Claude Opus 4.6',
        displayName: 'Claude Opus 4.6',
        description: 'Самая мощная модель Anthropic',
        type: 'text',
        // 25.382$ per 1M tokens
        costPerMillionInputTokens: 25.382,
        costPerMillionOutputTokens: 25.382,
        tokensPerDollar: 1000,
        minTokenCost: 15,
        sortOrder: 8,
        isPremium: true,
        capabilities: ['streaming', 'vision', 'thinking'],
        providerMappings: [
          {
            // Evolink model ID из документации Anthropic Messages API
            providerSlug: 'evolink',
            modelId: 'claude-opus-4-6',
            priority: 1,
            isActive: true,
          },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: {
          maxInputTokens: 200000,
          maxOutputTokens: 8192,
          includedInPlans: ['unlimited'],
        },
      },
      {
        slug: 'claude-sonnet-4.6',
        name: 'Claude Sonnet 4.6',
        displayName: 'Claude Sonnet 4.6',
        description: 'Балансированная модель Anthropic нового поколения',
        type: 'text',
        // 15.3$ per 1M tokens
        costPerMillionInputTokens: 15.3,
        costPerMillionOutputTokens: 15.3,
        tokensPerDollar: 1000,
        minTokenCost: 8,
        sortOrder: 9,
        isPremium: true,
        capabilities: ['streaming', 'vision', 'thinking'],
        providerMappings: [
          {
            // Evolink model ID из документации Anthropic Messages API
            providerSlug: 'evolink',
            modelId: 'claude-sonnet-4-6',
            priority: 1,
            isActive: true,
          },
        ],
        defaultParams: { maxTokens: 8192, temperature: 0.7 },
        limits: {
          maxInputTokens: 200000,
          maxOutputTokens: 8192,
          includedInPlans: ['pro', 'unlimited'],
        },
      },
      {
        // DeepSeek V4 через Evolink
        // По документации Evolink DeepSeek API: model = 'deepseek-chat'
        // Добавляем как только появится — пока isActive: false до релиза
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
          {
            // Evolink DeepSeek API: model IDs = 'deepseek-chat' | 'deepseek-reasoner'
            providerSlug: 'evolink',
            modelId: 'deepseek-chat',
            priority: 1,
            // false — включим когда выйдет официально
            isActive: false,
          },
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
          {
            providerSlug: 'kie',
            modelId: 'gemini-3.1-pro',
            priority: 1,
            isActive: true,
          },
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
          {
            providerSlug: 'kie',
            modelId: 'gemini-3-flash',
            priority: 1,
            isActive: true,
          },
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
          {
            providerSlug: 'openrouter',
            modelId: 'openai/gpt-4o',
            priority: 1,
            isActive: true,
          },
          {
            providerSlug: 'evolink',
            modelId: 'gpt-4o',
            priority: 2,
            isActive: true,
          },
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
          {
            providerSlug: 'openrouter',
            modelId: 'openai/gpt-4o-mini',
            priority: 1,
            isActive: true,
          },
          {
            providerSlug: 'evolink',
            modelId: 'gpt-4o-mini',
            priority: 2,
            isActive: true,
          },
        ],
        defaultParams: { maxTokens: 4096, temperature: 0.7 },
        limits: { maxInputTokens: 128000, maxOutputTokens: 16384 },
      },

      // ==============================
      // МОДЕЛИ ИЗОБРАЖЕНИЙ
      // ==============================
      {
        slug: 'gpt-5-image',
        name: 'GPT-5 Image',
        displayName: 'GPT-5 Image',
        description: 'Новейший генератор изображений OpenAI',
        type: 'image',
        fixedCostPerGeneration: 0.04,
        tokensPerDollar: 125,
        minTokenCost: 5,
        sortOrder: 1,
        capabilities: ['text_rendering', 'image_editing'],
        providerMappings: [
          {
            providerSlug: 'openrouter-image',
            modelId: 'openai/gpt-5-image',
            priority: 1,
            isActive: true,
          },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
      },
      {
        slug: 'gpt-image-1.5-lite',
        name: 'GPT Image 1.5 Lite',
        displayName: 'GPT Image 1.5 Lite',
        description: 'Облегчённая версия генератора изображений OpenAI',
        type: 'image',
        // 0.0125$ per generation из задания
        fixedCostPerGeneration: 0.0125,
        tokensPerDollar: 200,
        minTokenCost: 2,
        sortOrder: 2,
        capabilities: ['text_to_image', 'image_editing'],
        providerMappings: [
          {
            // Evolink image API: model = 'gpt-image-1.5' (Lite версия)
            providerSlug: 'evolink',
            modelId: 'gpt-image-1.5',
            priority: 1,
            isActive: true,
          },
        ],
        defaultParams: { aspectRatio: '1:1' },
        limits: { maxResolution: '1536x1024' },
      },
      {
        slug: 'midjourney',
        name: 'Midjourney',
        displayName: 'Midjourney',
        description: 'Лучший генератор изображений',
        type: 'image',
        fixedCostPerGeneration: 0.055,
        tokensPerDollar: 100,
        minTokenCost: 6,
        sortOrder: 3,
        capabilities: ['variations', 'upscale'],
        providerMappings: [
          {
            providerSlug: 'kie',
            modelId: 'mj_txt2img',
            priority: 1,
            isActive: true,
          },
          {
            providerSlug: 'evolink',
            modelId: 'midjourney',
            priority: 2,
            isActive: true,
          },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
      },
      {
        slug: 'midjourney-img2img',
        name: 'Midjourney Img2Img',
        displayName: 'Midjourney (Image to Image)',
        description: 'Трансформация изображений через Midjourney',
        type: 'image',
        fixedCostPerGeneration: 0.055,
        tokensPerDollar: 100,
        minTokenCost: 6,
        sortOrder: 4,
        capabilities: ['image_to_image', 'variations'],
        providerMappings: [
          {
            providerSlug: 'kie',
            modelId: 'mj_img2img',
            priority: 1,
            isActive: true,
          },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
      },
            {
        slug: 'seedream-5-lite',
        name: 'Seedream 5.0 Lite',
        displayName: 'Seedream 5.0 Lite',
        description: 'Быстрый генератор Seedream',
        type: 'image',
        fixedCostPerGeneration: 0.0275,
        tokensPerDollar: 150,
        minTokenCost: 4,
        sortOrder: 5,
        capabilities: [],
        providerMappings: [
          {
            providerSlug: 'kie',
            modelId: 'seedream/5-lite-text-to-image',
            priority: 1,
            isActive: true,
          },
          {
            providerSlug: 'evolink',
            modelId: 'seedream',
            priority: 2,
            isActive: true,
          },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
      },
      {
        slug: 'imagen-4',
        name: 'Imagen 4',
        displayName: 'Google Imagen 4',
        description: 'Генератор изображений от Google',
        type: 'image',
        fixedCostPerGeneration: 0.02,
        tokensPerDollar: 150,
        minTokenCost: 3,
        sortOrder: 6,
        capabilities: [],
        providerMappings: [
          {
            providerSlug: 'kie',
            modelId: 'google/imagen4-fast',
            priority: 1,
            isActive: true,
          },
          {
            providerSlug: 'evolink',
            modelId: 'imagen-3',
            priority: 2,
            isActive: true,
          },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
      },
      {
        slug: 'flux-2',
        name: 'Flux 2',
        displayName: 'Flux 2',
        description: 'Новая версия Flux',
        type: 'image',
        fixedCostPerGeneration: 0.035,
        tokensPerDollar: 125,
        minTokenCost: 4,
        sortOrder: 7,
        capabilities: ['text_to_image', 'image_to_image'],
        providerMappings: [
          {
            providerSlug: 'kie',
            modelId: 'flux-2/flex-text-to-image',
            priority: 1,
            isActive: true,
          },
        ],
        defaultParams: { width: 1024, height: 1024, steps: 28 },
        limits: { maxResolution: '2048x2048' },
      },
      {
        slug: 'flux-2-img2img',
        name: 'Flux 2 Img2Img',
        displayName: 'Flux 2 (Image to Image)',
        description: 'Flux 2 для трансформации изображений',
        type: 'image',
        fixedCostPerGeneration: 0.035,
        tokensPerDollar: 125,
        minTokenCost: 4,
        sortOrder: 8,
        capabilities: ['image_to_image'],
        providerMappings: [
          {
            providerSlug: 'kie',
            modelId: 'flux-2/flex-image-to-image',
            priority: 1,
            isActive: true,
          },
        ],
        defaultParams: { width: 1024, height: 1024, steps: 28 },
        limits: { maxResolution: '2048x2048' },
      },
      {
        slug: 'nano-banana-2',
        name: 'Nano Banana 2',
        displayName: 'Nano Banana 2',
        description: 'Стандартная версия Nano Banana',
        type: 'image',
        fixedCostPerGeneration: 0.025,
        tokensPerDollar: 150,
        minTokenCost: 3,
        sortOrder: 9,
        capabilities: [],
        providerMappings: [
          {
            providerSlug: 'kie',
            modelId: 'nano-banana-2',
            priority: 1,
            isActive: true,
          },
          {
            providerSlug: 'evolink',
            modelId: 'nano-banana',
            priority: 2,
            isActive: true,
          },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
      },
      {
        slug: 'nano-banana-pro',
        name: 'Nano Banana Pro',
        displayName: 'Nano Banana Pro',
        description: 'Продвинутая версия Nano Banana',
        type: 'image',
        fixedCostPerGeneration: 0.04,
        tokensPerDollar: 125,
        minTokenCost: 5,
        sortOrder: 10,
        capabilities: ['high_quality'],
        providerMappings: [
          {
            providerSlug: 'kie',
            modelId: 'nano-banana-pro',
            priority: 1,
            isActive: true,
          },
        ],
        defaultParams: { width: 1024, height: 1024 },
        limits: { maxResolution: '2048x2048' },
      },

      // ==============================
      // МОДЕЛИ ВИДЕО
      // ==============================
      {
        slug: 'veo-3.1-fast',
        name: 'Veo 3.1 Fast',
        displayName: 'Google Veo 3.1 Fast',
        description: 'Быстрая версия Veo от Google',
        type: 'video',
        fixedCostPerGeneration: 0.15,
        tokensPerDollar: 50,
        minTokenCost: 15,
        sortOrder: 1,
        capabilities: ['text_to_video'],
        providerMappings: [
          {
            // Исправленный model ID для Evolink
            providerSlug: 'evolink',
            modelId: 'veo-3.1-fast-generate-preview',
            priority: 1,
            isActive: true,
          },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 8 },
      },
      {
        slug: 'veo-3.1-pro',
        name: 'Veo 3.1 Pro',
        displayName: 'Google Veo 3.1 Pro',
        description: 'Премиум версия Veo от Google',
        type: 'video',
        fixedCostPerGeneration: 0.30,
        tokensPerDollar: 40,
        minTokenCost: 30,
        sortOrder: 2,
        isPremium: true,
        capabilities: ['text_to_video', 'high_quality'],
        providerMappings: [
          {
            // Исправленный model ID для Evolink
            providerSlug: 'evolink',
            modelId: 'veo-3.1-generate-preview',
            priority: 1,
            isActive: true,
          },
        ],
        defaultParams: { duration: 5 },
        limits: {
          maxDuration: 10,
          includedInPlans: ['pro', 'unlimited'],
        },
      },
      {
        slug: 'sora-2-pro',
        name: 'Sora 2 Pro',
        displayName: 'OpenAI Sora 2 Pro',
        description: 'Флагманский генератор видео от OpenAI',
        type: 'video',
        // 0.9583$ per generation из задания
        fixedCostPerGeneration: 0.9583,
        tokensPerDollar: 30,
        minTokenCost: 50,
        sortOrder: 3,
        isPremium: true,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          {
            // Исправленный model ID из документации Evolink
            providerSlug: 'evolink',
            modelId: 'sora-2-pro-preview',
            priority: 1,
            isActive: true,
          },
        ],
        defaultParams: { duration: 5 },
        limits: {
          maxDuration: 20,
          includedInPlans: ['unlimited'],
        },
      },
      {
        slug: 'sora-2',
        name: 'Sora 2',
        displayName: 'OpenAI Sora 2',
        description: 'Стандартная версия Sora',
        type: 'video',
        fixedCostPerGeneration: 0.15,
        tokensPerDollar: 40,
        minTokenCost: 25,
        sortOrder: 4,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          {
            providerSlug: 'kie',
            modelId: 'sora-2-text-to-video',
            priority: 1,
            isActive: true,
          },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 10 },
      },
      {
        slug: 'sora-2-img2vid',
        name: 'Sora 2 Img2Vid',
        displayName: 'Sora 2 (Image to Video)',
        description: 'Sora для анимации изображений',
        type: 'video',
        fixedCostPerGeneration: 0.175,
        tokensPerDollar: 40,
        minTokenCost: 28,
        sortOrder: 5,
        capabilities: ['image_to_video'],
        providerMappings: [
          {
            providerSlug: 'kie',
            modelId: 'sora-2-image-to-video',
            priority: 1,
            isActive: true,
          },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 10 },
      },
      {
        slug: 'kling-3.0',
        name: 'Kling 3.0',
        displayName: 'Kling 3.0',
        description: 'Генератор видео Kling (Text-to-Video)',
        type: 'video',
        fixedCostPerGeneration: 0.075,
        tokensPerDollar: 60,
        minTokenCost: 10,
        sortOrder: 6,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          {
            providerSlug: 'kie',
            modelId: 'kling-3.0/video',
            priority: 1,
            isActive: true,
          },
          {
            // Включили Evolink маппинг для Kling T2V
            providerSlug: 'evolink',
            modelId: 'kling-v3-text-to-video',
            priority: 2,
            isActive: true,
          },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 10 },
      },
      {
        slug: 'kling-3.0-img2vid',
        name: 'Kling 3.0 Img2Vid',
        displayName: 'Kling 3.0 (Image to Video)',
        description: 'Kling для анимации изображений',
        type: 'video',
        fixedCostPerGeneration: 0.10,
        tokensPerDollar: 60,
        minTokenCost: 12,
        sortOrder: 7,
        capabilities: ['image_to_video', 'motion_control'],
        providerMappings: [
          {
            providerSlug: 'kie',
            modelId: 'kling-3.0/video',
            priority: 1,
            isActive: true,
          },
          {
            // Включили Evolink маппинг для Kling I2V
            providerSlug: 'evolink',
            modelId: 'kling-v3-image-to-video',
            priority: 2,
            isActive: true,
          },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 10 },
      },
      {
        slug: 'kling-3.0-motion',
        name: 'Kling 3.0 Motion Control',
        displayName: 'Kling 3.0 Motion Control',
        description: 'Kling с контролем движения (image + motion reference video)',
        type: 'video',
        fixedCostPerGeneration: 0.12,
        tokensPerDollar: 50,
        minTokenCost: 15,
        sortOrder: 8,
        capabilities: ['motion_control', 'image_to_video'],
        providerMappings: [
          {
            // Новая модель Motion Control
            providerSlug: 'evolink',
            modelId: 'kling-v3-motion-control',
            priority: 1,
            isActive: true,
          },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 30 },
      },
      {
        slug: 'runway',
        name: 'Runway',
        displayName: 'Runway Gen-3',
        description: 'Генератор видео от Runway',
        type: 'video',
        fixedCostPerGeneration: 0.10,
        tokensPerDollar: 50,
        minTokenCost: 15,
        sortOrder: 9,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          {
            providerSlug: 'kie',
            modelId: 'runway',
            priority: 1,
            isActive: true,
          },
          {
            providerSlug: 'evolink',
            modelId: 'runway-gen3',
            priority: 2,
            isActive: false,
          },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 10 },
      },
      {
        slug: 'hailuo-2.3-standard',
        name: 'Hailuo 2.3 Standard',
        displayName: 'Hailuo 2.3 Standard',
        description: 'Стандартная версия Hailuo',
        type: 'video',
        fixedCostPerGeneration: 0.08,
        tokensPerDollar: 60,
        minTokenCost: 10,
        sortOrder: 10,
        capabilities: ['text_to_video', 'image_to_video'],
        providerMappings: [
          {
            providerSlug: 'kie',
            modelId: 'hailuo/02-text-to-video-standard',
            priority: 1,
            isActive: true,
          },
          {
            providerSlug: 'evolink',
            modelId: 'hailuo',
            priority: 2,
            isActive: false,
          },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 6 },
      },
      {
        slug: 'hailuo-2.3-pro',
        name: 'Hailuo 2.3 Pro',
        displayName: 'Hailuo 2.3 Pro',
        description: 'Премиум версия Hailuo',
        type: 'video',
        fixedCostPerGeneration: 0.12,
        tokensPerDollar: 50,
        minTokenCost: 15,
        sortOrder: 11,
        capabilities: ['text_to_video', 'image_to_video', 'high_quality'],
        providerMappings: [
          {
            providerSlug: 'kie',
            modelId: 'hailuo/2-3-image-to-video-pro',
            priority: 1,
            isActive: true,
          },
        ],
        defaultParams: { duration: 5 },
        limits: { maxDuration: 8 },
      },

      // ==============================
      // МОДЕЛИ АУДИО
      // ==============================
      {
        slug: 'suno-v4',
        name: 'Suno V4',
        displayName: 'Suno V4',
        description: 'Генератор музыки от Suno',
        type: 'audio',
        fixedCostPerGeneration: 0.10,
        tokensPerDollar: 100,
        minTokenCost: 10,
        sortOrder: 1,
        capabilities: ['text_to_music', 'lyrics', 'instrumental'],
        providerMappings: [
          {
            providerSlug: 'kie',
            modelId: 'ai-music-api/generate',
            priority: 1,
            isActive: true,
          },
          {
            providerSlug: 'evolink',
            modelId: 'suno-v4',
            priority: 2,
            isActive: true,
          },
        ],
        defaultParams: { duration: 30 },
        limits: { maxDuration: 240 },
      },
      {
        slug: 'elevenlabs-tts',
        name: 'ElevenLabs TTS',
        displayName: 'ElevenLabs Text-to-Speech',
        description: 'Синтез речи от ElevenLabs',
        type: 'audio',
        fixedCostPerGeneration: 0.05,
        tokensPerDollar: 150,
        minTokenCost: 5,
        sortOrder: 2,
        capabilities: ['text_to_speech', 'voice_cloning', 'multilingual'],
        providerMappings: [
          {
            providerSlug: 'kie',
            modelId: 'elevenlabs/text-to-speech-turbo-2-5',
            priority: 1,
            isActive: true,
          },
          {
            providerSlug: 'evolink',
            modelId: 'elevenlabs',
            priority: 2,
            isActive: true,
          },
        ],
        defaultParams: { duration: 30 },
        limits: { maxDuration: 600 },
      },
    ];

    const providerDocs = await this.providerModel.find();
    const providerMap = new Map(providerDocs.map((p) => [p.slug, p._id]));

    for (const modelData of defaultModels) {
      const mappings = modelData.providerMappings.map((m: any) => ({
        ...m,
        providerId: providerMap.get(m.providerSlug),
      }));

      const costPerMillionInputTokens = (modelData as any).costPerMillionInputTokens ?? 0;
      const costPerMillionOutputTokens = (modelData as any).costPerMillionOutputTokens ?? 0;
      const fixedCostPerGeneration = (modelData as any).fixedCostPerGeneration ?? 0;

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

      await this.modelModel.findOneAndUpdate(
        { slug: modelData.slug },
        {
          ...modelData,
          providerMappings: mappings,
          tokenCost,
          isActive: true,
          stats: { totalRequests: 0, avgResponseTime: 0, successRate: 100 },
        },
        { upsert: true, new: true },
      );
    }

    this.logger.log(`🌱 Synced ${defaultModels.length} AI models`);
  }
}