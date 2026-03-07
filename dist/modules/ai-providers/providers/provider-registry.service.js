"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var ProviderRegistryService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderRegistryService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const schedule_1 = require("@nestjs/schedule");
const openrouter_provider_1 = require("./openrouter.provider");
const evolink_provider_1 = require("./evolink.provider");
const kie_provider_1 = require("./kie.provider");
const replicate_provider_1 = require("./replicate.provider");
const provider_schema_1 = require("../schemas/provider.schema");
const model_schema_1 = require("../schemas/model.schema");
let ProviderRegistryService = ProviderRegistryService_1 = class ProviderRegistryService {
    constructor(configService, providerModel, modelModel) {
        this.configService = configService;
        this.providerModel = providerModel;
        this.modelModel = modelModel;
        this.logger = new common_1.Logger(ProviderRegistryService_1.name);
        this.providers = new Map();
    }
    async onModuleInit() {
        await this.initializeProviders();
        await this.seedDefaultModels();
    }
    async initializeProviders() {
        const providerConfigs = this.configService.get('providers');
        if (providerConfigs.openrouter?.apiKey) {
            this.providers.set('openrouter', new openrouter_provider_1.OpenRouterProvider({
                apiKey: providerConfigs.openrouter.apiKey,
                baseUrl: providerConfigs.openrouter.baseUrl,
            }));
            this.logger.log('✅ OpenRouter provider initialized');
        }
        if (providerConfigs.evolink?.apiKey) {
            this.providers.set('evolink', new evolink_provider_1.EvolinkProvider({
                apiKey: providerConfigs.evolink.apiKey,
                baseUrl: providerConfigs.evolink.baseUrl,
            }));
            this.logger.log('✅ Evolink provider initialized');
        }
        if (providerConfigs.kie?.apiKey) {
            this.providers.set('kie', new kie_provider_1.KieProvider({
                apiKey: providerConfigs.kie.apiKey,
                baseUrl: providerConfigs.kie.baseUrl,
            }));
            this.logger.log('✅ KIE provider initialized');
        }
        if (providerConfigs.replicate?.apiKey) {
            this.providers.set('replicate', new replicate_provider_1.ReplicateProvider({
                apiKey: providerConfigs.replicate.apiKey,
                baseUrl: 'https://api.replicate.com/v1',
            }));
            this.logger.log('✅ Replicate provider initialized');
        }
        await this.syncProvidersToDB();
    }
    async syncProvidersToDB() {
        for (const [slug, provider] of this.providers) {
            await this.providerModel.findOneAndUpdate({ slug }, {
                slug,
                name: slug.charAt(0).toUpperCase() + slug.slice(1),
                baseUrl: provider.config?.baseUrl || '',
                isActive: true,
                healthStatus: { isHealthy: true, lastCheck: new Date() },
            }, { upsert: true, new: true });
        }
    }
    getProvider(slug) {
        return this.providers.get(slug);
    }
    getAllProviders() {
        return this.providers;
    }
    async getProvidersForModel(modelSlug) {
        const model = await this.modelModel.findOne({ slug: modelSlug, isActive: true });
        if (!model)
            return [];
        const result = [];
        const sortedMappings = [...model.providerMappings]
            .filter((m) => m.isActive)
            .sort((a, b) => a.priority - b.priority);
        for (const mapping of sortedMappings) {
            const providerDoc = await this.providerModel.findOne({
                slug: mapping.providerSlug,
                isActive: true,
            });
            if (!providerDoc)
                continue;
            if (providerDoc.healthStatus?.isHealthy === false &&
                providerDoc.healthStatus?.consecutiveErrors > 5) {
                continue;
            }
            const provider = this.providers.get(mapping.providerSlug);
            if (provider) {
                result.push({ provider, modelId: mapping.modelId });
            }
        }
        return result;
    }
    async healthCheckAll() {
        for (const [slug, provider] of this.providers) {
            try {
                const isHealthy = await provider.healthCheck();
                const now = new Date();
                if (isHealthy) {
                    await this.providerModel.findOneAndUpdate({ slug }, {
                        $set: {
                            'healthStatus.isHealthy': true,
                            'healthStatus.lastCheck': now,
                            'healthStatus.consecutiveErrors': 0,
                        },
                    });
                }
                else {
                    await this.providerModel.findOneAndUpdate({ slug }, {
                        $set: {
                            'healthStatus.isHealthy': false,
                            'healthStatus.lastCheck': now,
                        },
                        $inc: { 'healthStatus.consecutiveErrors': 1 },
                    });
                    this.logger.warn(`⚠️ Provider ${slug} health check failed`);
                }
            }
            catch (error) {
                this.logger.error(`❌ Health check error for ${slug}: ${error.message}`);
            }
        }
    }
    async updateProviderStats(slug, responseTimeMs, success) {
        const update = {
            'healthStatus.lastCheck': new Date(),
            'healthStatus.responseTime': responseTimeMs,
        };
        if (success) {
            update['healthStatus.consecutiveErrors'] = 0;
            update['healthStatus.isHealthy'] = true;
        }
        else {
            await this.providerModel.findOneAndUpdate({ slug }, { $inc: { 'healthStatus.consecutiveErrors': 1 } });
        }
        await this.providerModel.findOneAndUpdate({ slug }, { $set: update });
    }
    async seedDefaultModels() {
        const existingCount = await this.modelModel.countDocuments();
        if (existingCount > 0)
            return;
        this.logger.log('🌱 Seeding default AI models...');
        const defaultModels = [
            {
                slug: 'gpt-4o',
                name: 'GPT-4o',
                displayName: 'ChatGPT 4o',
                description: 'Флагманская модель OpenAI с vision и function calling',
                type: 'text',
                tokenCost: 3,
                sortOrder: 1,
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
                tokenCost: 1,
                sortOrder: 2,
                capabilities: ['streaming', 'vision', 'function_calling'],
                providerMappings: [
                    { providerSlug: 'openrouter', modelId: 'openai/gpt-4o-mini', priority: 1, isActive: true },
                    { providerSlug: 'evolink', modelId: 'gpt-4o-mini', priority: 2, isActive: true },
                ],
                defaultParams: { maxTokens: 4096, temperature: 0.7 },
                limits: { maxInputTokens: 128000, maxOutputTokens: 16384 },
            },
            {
                slug: 'claude-3.5-sonnet',
                name: 'Claude 3.5 Sonnet',
                displayName: 'Claude 3.5 Sonnet',
                description: 'Лучшая модель Anthropic для кода и анализа',
                type: 'text',
                tokenCost: 3,
                sortOrder: 3,
                capabilities: ['streaming', 'vision'],
                providerMappings: [
                    { providerSlug: 'openrouter', modelId: 'anthropic/claude-3.5-sonnet', priority: 1, isActive: true },
                ],
                defaultParams: { maxTokens: 8192, temperature: 0.7 },
                limits: { maxInputTokens: 200000, maxOutputTokens: 8192 },
            },
            {
                slug: 'claude-3-haiku',
                name: 'Claude 3 Haiku',
                displayName: 'Claude 3 Haiku',
                description: 'Быстрая модель Anthropic',
                type: 'text',
                tokenCost: 1,
                sortOrder: 4,
                capabilities: ['streaming', 'vision'],
                providerMappings: [
                    { providerSlug: 'openrouter', modelId: 'anthropic/claude-3-haiku', priority: 1, isActive: true },
                ],
                defaultParams: { maxTokens: 4096, temperature: 0.7 },
                limits: { maxInputTokens: 200000, maxOutputTokens: 4096 },
            },
            {
                slug: 'gemini-2.0-flash',
                name: 'Gemini 2.0 Flash',
                displayName: 'Gemini 2.0 Flash',
                description: 'Быстрая модель Google',
                type: 'text',
                tokenCost: 1,
                sortOrder: 5,
                capabilities: ['streaming', 'vision'],
                providerMappings: [
                    { providerSlug: 'openrouter', modelId: 'google/gemini-2.0-flash-exp', priority: 1, isActive: true },
                ],
                defaultParams: { maxTokens: 8192, temperature: 0.7 },
                limits: { maxInputTokens: 1000000, maxOutputTokens: 8192 },
            },
            {
                slug: 'gemini-1.5-pro',
                name: 'Gemini 1.5 Pro',
                displayName: 'Gemini 1.5 Pro',
                description: 'Мощная модель Google с огромным контекстом',
                type: 'text',
                tokenCost: 3,
                sortOrder: 6,
                capabilities: ['streaming', 'vision'],
                providerMappings: [
                    { providerSlug: 'openrouter', modelId: 'google/gemini-pro-1.5', priority: 1, isActive: true },
                ],
                defaultParams: { maxTokens: 8192, temperature: 0.7 },
                limits: { maxInputTokens: 2000000, maxOutputTokens: 8192 },
            },
            {
                slug: 'deepseek-v3',
                name: 'DeepSeek V3',
                displayName: 'DeepSeek V3',
                description: 'Мощная open-source модель',
                type: 'text',
                tokenCost: 1,
                sortOrder: 7,
                capabilities: ['streaming'],
                providerMappings: [
                    { providerSlug: 'openrouter', modelId: 'deepseek/deepseek-chat', priority: 1, isActive: true },
                ],
                defaultParams: { maxTokens: 4096, temperature: 0.7 },
                limits: { maxInputTokens: 64000, maxOutputTokens: 4096 },
            },
            {
                slug: 'deepseek-r1',
                name: 'DeepSeek R1',
                displayName: 'DeepSeek R1 (Reasoning)',
                description: 'Модель с цепочкой рассуждений',
                type: 'text',
                tokenCost: 2,
                sortOrder: 8,
                capabilities: ['streaming'],
                providerMappings: [
                    { providerSlug: 'openrouter', modelId: 'deepseek/deepseek-r1', priority: 1, isActive: true },
                ],
                defaultParams: { maxTokens: 8192, temperature: 0.6 },
                limits: { maxInputTokens: 64000, maxOutputTokens: 8192 },
            },
            {
                slug: 'grok-3',
                name: 'Grok 3',
                displayName: 'Grok 3',
                description: 'Модель от xAI',
                type: 'text',
                tokenCost: 3,
                sortOrder: 9,
                capabilities: ['streaming'],
                providerMappings: [
                    { providerSlug: 'openrouter', modelId: 'x-ai/grok-3', priority: 1, isActive: true },
                ],
                defaultParams: { maxTokens: 4096, temperature: 0.7 },
                limits: { maxInputTokens: 131072, maxOutputTokens: 4096 },
            },
            {
                slug: 'perplexity-sonar',
                name: 'Perplexity Sonar',
                displayName: 'Perplexity Sonar',
                description: 'Поисковая AI модель с актуальными данными',
                type: 'text',
                tokenCost: 2,
                sortOrder: 10,
                capabilities: ['streaming', 'web_search'],
                providerMappings: [
                    { providerSlug: 'openrouter', modelId: 'perplexity/sonar-pro', priority: 1, isActive: true },
                ],
                defaultParams: { maxTokens: 4096, temperature: 0.7 },
                limits: { maxInputTokens: 127072, maxOutputTokens: 4096 },
            },
            {
                slug: 'qwen-2.5-72b',
                name: 'Qwen 2.5 72B',
                displayName: 'Qwen 2.5',
                description: 'Мощная модель от Alibaba',
                type: 'text',
                tokenCost: 2,
                sortOrder: 11,
                capabilities: ['streaming'],
                providerMappings: [
                    { providerSlug: 'openrouter', modelId: 'qwen/qwen-2.5-72b-instruct', priority: 1, isActive: true },
                ],
                defaultParams: { maxTokens: 4096, temperature: 0.7 },
                limits: { maxInputTokens: 32768, maxOutputTokens: 4096 },
            },
            {
                slug: 'midjourney',
                name: 'Midjourney',
                displayName: 'Midjourney',
                description: 'Лучший генератор изображений',
                type: 'image',
                tokenCost: 10,
                sortOrder: 1,
                capabilities: ['variations', 'upscale'],
                providerMappings: [
                    { providerSlug: 'evolink', modelId: 'midjourney', priority: 1, isActive: true },
                    { providerSlug: 'kie', modelId: 'midjourney', priority: 2, isActive: true },
                ],
                defaultParams: { width: 1024, height: 1024 },
                limits: { maxResolution: '2048x2048' },
            },
            {
                slug: 'dall-e-3',
                name: 'DALL-E 3',
                displayName: 'DALL-E 3',
                description: 'Генератор изображений от OpenAI',
                type: 'image',
                tokenCost: 5,
                sortOrder: 2,
                capabilities: [],
                providerMappings: [
                    { providerSlug: 'openrouter', modelId: 'openai/dall-e-3', priority: 1, isActive: true },
                ],
                defaultParams: { width: 1024, height: 1024 },
                limits: { maxResolution: '1792x1024' },
            },
            {
                slug: 'chatgpt-images',
                name: 'ChatGPT Images',
                displayName: 'ChatGPT Images',
                description: 'Генерация через ChatGPT (GPT-4o image gen)',
                type: 'image',
                tokenCost: 5,
                sortOrder: 3,
                capabilities: [],
                providerMappings: [
                    { providerSlug: 'openrouter', modelId: 'openai/gpt-4o', priority: 1, isActive: true },
                ],
                defaultParams: { width: 1024, height: 1024 },
                limits: {},
            },
            {
                slug: 'flux-pro',
                name: 'Flux Pro',
                displayName: 'Flux Pro',
                description: 'Быстрый генератор от Black Forest Labs',
                type: 'image',
                tokenCost: 5,
                sortOrder: 4,
                capabilities: [],
                providerMappings: [
                    { providerSlug: 'replicate', modelId: 'black-forest-labs/flux-pro', priority: 1, isActive: true },
                    { providerSlug: 'evolink', modelId: 'flux-pro', priority: 2, isActive: true },
                ],
                defaultParams: { width: 1024, height: 1024, steps: 28 },
                limits: { maxResolution: '2048x2048' },
            },
            {
                slug: 'stable-diffusion-xl',
                name: 'Stable Diffusion XL',
                displayName: 'Stable Diffusion XL',
                description: 'Open-source генератор от Stability AI',
                type: 'image',
                tokenCost: 3,
                sortOrder: 5,
                capabilities: ['negative_prompt', 'steps', 'seed'],
                providerMappings: [
                    { providerSlug: 'replicate', modelId: 'stability-ai/sdxl', priority: 1, isActive: true },
                    { providerSlug: 'evolink', modelId: 'stable-diffusion-xl', priority: 2, isActive: true },
                ],
                defaultParams: { width: 1024, height: 1024, steps: 30 },
                limits: { maxResolution: '2048x2048' },
            },
            {
                slug: 'seedream',
                name: 'Seedream',
                displayName: 'Seedream',
                description: 'Генератор изображений Seedream',
                type: 'image',
                tokenCost: 5,
                sortOrder: 6,
                capabilities: [],
                providerMappings: [
                    { providerSlug: 'evolink', modelId: 'seedream', priority: 1, isActive: true },
                ],
                defaultParams: { width: 1024, height: 1024 },
                limits: {},
            },
            {
                slug: 'imagen-3',
                name: 'Imagen 3',
                displayName: 'Imagen 3',
                description: 'Генератор изображений от Google',
                type: 'image',
                tokenCost: 5,
                sortOrder: 7,
                capabilities: [],
                providerMappings: [
                    { providerSlug: 'evolink', modelId: 'imagen-3', priority: 1, isActive: true },
                ],
                defaultParams: { width: 1024, height: 1024 },
                limits: {},
            },
            {
                slug: 'nano-banana',
                name: 'Nano Banana',
                displayName: 'Nano Banana',
                description: 'Генератор изображений Nano Banana',
                type: 'image',
                tokenCost: 5,
                sortOrder: 8,
                capabilities: [],
                providerMappings: [
                    { providerSlug: 'evolink', modelId: 'nano-banana', priority: 1, isActive: true },
                ],
                defaultParams: { width: 1024, height: 1024 },
                limits: {},
            },
            {
                slug: 'sora',
                name: 'Sora',
                displayName: 'Sora',
                description: 'Генератор видео от OpenAI',
                type: 'video',
                tokenCost: 30,
                sortOrder: 1,
                capabilities: ['text_to_video'],
                providerMappings: [
                    { providerSlug: 'evolink', modelId: 'sora', priority: 1, isActive: true },
                ],
                defaultParams: { duration: 5 },
                limits: { maxDuration: 20 },
            },
            {
                slug: 'kling-1.6',
                name: 'Kling 1.6',
                displayName: 'Kling 1.6',
                description: 'Генератор видео Kling',
                type: 'video',
                tokenCost: 20,
                sortOrder: 2,
                capabilities: ['text_to_video', 'image_to_video'],
                providerMappings: [
                    { providerSlug: 'evolink', modelId: 'kling-1.6', priority: 1, isActive: true },
                    { providerSlug: 'kie', modelId: 'kling', priority: 2, isActive: true },
                ],
                defaultParams: { duration: 5 },
                limits: { maxDuration: 10 },
            },
            {
                slug: 'runway-gen3',
                name: 'Runway Gen-3',
                displayName: 'Runway Gen-3 Alpha',
                description: 'Генератор видео от Runway',
                type: 'video',
                tokenCost: 25,
                sortOrder: 3,
                capabilities: ['text_to_video', 'image_to_video'],
                providerMappings: [
                    { providerSlug: 'evolink', modelId: 'runway-gen3', priority: 1, isActive: true },
                ],
                defaultParams: { duration: 5 },
                limits: { maxDuration: 10 },
            },
            {
                slug: 'veo-2',
                name: 'Veo 2',
                displayName: 'Google Veo 2',
                description: 'Генератор видео от Google DeepMind',
                type: 'video',
                tokenCost: 25,
                sortOrder: 4,
                capabilities: ['text_to_video'],
                providerMappings: [
                    { providerSlug: 'evolink', modelId: 'veo-2', priority: 1, isActive: true },
                ],
                defaultParams: { duration: 5 },
                limits: { maxDuration: 8 },
            },
            {
                slug: 'hailuo',
                name: 'Hailuo',
                displayName: 'Hailuo (MiniMax)',
                description: 'Генератор видео от MiniMax',
                type: 'video',
                tokenCost: 15,
                sortOrder: 5,
                capabilities: ['text_to_video', 'image_to_video'],
                providerMappings: [
                    { providerSlug: 'evolink', modelId: 'hailuo', priority: 1, isActive: true },
                ],
                defaultParams: { duration: 5 },
                limits: { maxDuration: 6 },
            },
            {
                slug: 'luma-ray2',
                name: 'Luma Ray2',
                displayName: 'Luma Dream Machine (Ray2)',
                description: 'Генератор видео от Luma AI',
                type: 'video',
                tokenCost: 20,
                sortOrder: 6,
                capabilities: ['text_to_video', 'image_to_video'],
                providerMappings: [
                    { providerSlug: 'replicate', modelId: 'luma/ray', priority: 1, isActive: true },
                    { providerSlug: 'evolink', modelId: 'luma-ray2', priority: 2, isActive: true },
                ],
                defaultParams: { duration: 5 },
                limits: { maxDuration: 5 },
            },
            {
                slug: 'pika-2.0',
                name: 'Pika 2.0',
                displayName: 'Pika 2.0',
                description: 'Генератор видео от Pika Labs',
                type: 'video',
                tokenCost: 15,
                sortOrder: 7,
                capabilities: ['text_to_video', 'image_to_video'],
                providerMappings: [
                    { providerSlug: 'evolink', modelId: 'pika-2.0', priority: 1, isActive: true },
                ],
                defaultParams: { duration: 3 },
                limits: { maxDuration: 4 },
            },
            {
                slug: 'suno-v4',
                name: 'Suno V4',
                displayName: 'Suno V4',
                description: 'Генератор музыки от Suno',
                type: 'audio',
                tokenCost: 10,
                sortOrder: 1,
                capabilities: ['text_to_music', 'lyrics'],
                providerMappings: [
                    { providerSlug: 'evolink', modelId: 'suno-v4', priority: 1, isActive: true },
                ],
                defaultParams: { duration: 30 },
                limits: { maxDuration: 240 },
            },
            {
                slug: 'elevenlabs',
                name: 'ElevenLabs',
                displayName: 'ElevenLabs TTS',
                description: 'Генератор речи от ElevenLabs',
                type: 'audio',
                tokenCost: 5,
                sortOrder: 2,
                capabilities: ['text_to_speech', 'voice_cloning'],
                providerMappings: [
                    { providerSlug: 'evolink', modelId: 'elevenlabs', priority: 1, isActive: true },
                ],
                defaultParams: { duration: 30 },
                limits: { maxDuration: 600 },
            },
        ];
        const providerDocs = await this.providerModel.find();
        const providerMap = new Map(providerDocs.map((p) => [p.slug, p._id]));
        for (const modelData of defaultModels) {
            const mappings = modelData.providerMappings.map((m) => ({
                ...m,
                providerId: providerMap.get(m.providerSlug),
            }));
            await this.modelModel.findOneAndUpdate({ slug: modelData.slug }, {
                ...modelData,
                providerMappings: mappings,
                isActive: true,
                stats: { totalRequests: 0, avgResponseTime: 0, successRate: 100 },
            }, { upsert: true, new: true });
        }
        this.logger.log(`🌱 Seeded ${defaultModels.length} AI models`);
    }
};
exports.ProviderRegistryService = ProviderRegistryService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_MINUTE),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ProviderRegistryService.prototype, "healthCheckAll", null);
exports.ProviderRegistryService = ProviderRegistryService = ProviderRegistryService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, mongoose_1.InjectModel)(provider_schema_1.Provider.name)),
    __param(2, (0, mongoose_1.InjectModel)(model_schema_1.AIModel.name)),
    __metadata("design:paramtypes", [config_1.ConfigService,
        mongoose_2.Model,
        mongoose_2.Model])
], ProviderRegistryService);
//# sourceMappingURL=provider-registry.service.js.map