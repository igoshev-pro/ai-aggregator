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
var AiProvidersService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiProvidersService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const model_schema_1 = require("./schemas/model.schema");
const provider_schema_1 = require("./schemas/provider.schema");
const provider_registry_service_1 = require("./providers/provider-registry.service");
let AiProvidersService = AiProvidersService_1 = class AiProvidersService {
    constructor(modelModel, providerModel, registry) {
        this.modelModel = modelModel;
        this.providerModel = providerModel;
        this.registry = registry;
        this.logger = new common_1.Logger(AiProvidersService_1.name);
    }
    async getModelsByType(type) {
        return this.modelModel
            .find({ type, isActive: true })
            .sort({ sortOrder: 1 })
            .exec();
    }
    async getAllModels() {
        return this.modelModel
            .find({ isActive: true })
            .sort({ type: 1, sortOrder: 1 })
            .exec();
    }
    async getModelBySlug(slug) {
        const model = await this.modelModel.findOne({ slug, isActive: true });
        if (!model) {
            throw new common_1.NotFoundException(`Model ${slug} not found or disabled`);
        }
        return model;
    }
    async getModelCost(slug) {
        const model = await this.getModelBySlug(slug);
        return model.tokenCost;
    }
    async generateText(modelSlug, request) {
        const providers = await this.registry.getProvidersForModel(modelSlug);
        if (providers.length === 0) {
            throw new common_1.BadRequestException(`No available providers for model ${modelSlug}`);
        }
        let lastError = null;
        for (const { provider, modelId } of providers) {
            try {
                this.logger.debug(`Trying ${provider.getSlug()} with model ${modelId} for ${modelSlug}`);
                const result = await provider.generateText({
                    ...request,
                    model: modelId,
                });
                await this.registry.updateProviderStats(provider.getSlug(), result.responseTimeMs, result.success);
                if (result.success) {
                    await this.updateModelStats(modelSlug, result.responseTimeMs, true);
                    return result;
                }
                if (result.error?.retryable) {
                    this.logger.warn(`Provider ${provider.getSlug()} failed (retryable): ${result.error.message}`);
                    lastError = result;
                    continue;
                }
                await this.updateModelStats(modelSlug, result.responseTimeMs, false);
                return result;
            }
            catch (error) {
                this.logger.error(`Provider ${provider.getSlug()} threw exception: ${error.message}`);
                lastError = {
                    success: false,
                    error: {
                        code: 'PROVIDER_ERROR',
                        message: error.message,
                        retryable: true,
                    },
                    responseTimeMs: 0,
                    providerSlug: provider.getSlug(),
                };
            }
        }
        await this.updateModelStats(modelSlug, 0, false);
        return lastError || {
            success: false,
            error: {
                code: 'ALL_PROVIDERS_FAILED',
                message: 'All providers failed for this model',
                retryable: false,
            },
            responseTimeMs: 0,
            providerSlug: 'none',
        };
    }
    async *generateTextStream(modelSlug, request) {
        const providers = await this.registry.getProvidersForModel(modelSlug);
        if (providers.length === 0) {
            yield { content: 'Error: No available providers', done: true };
            return;
        }
        for (const { provider, modelId } of providers) {
            try {
                this.logger.debug(`Streaming via ${provider.getSlug()} with model ${modelId}`);
                let hasYielded = false;
                let hasError = false;
                const stream = provider.generateTextStream({
                    ...request,
                    model: modelId,
                    stream: true,
                });
                for await (const chunk of stream) {
                    hasYielded = true;
                    if (chunk.content.startsWith('Error:')) {
                        hasError = true;
                        break;
                    }
                    yield chunk;
                    if (chunk.done) {
                        await this.updateModelStats(modelSlug, 0, true);
                        return;
                    }
                }
                if (hasYielded && !hasError) {
                    return;
                }
                this.logger.warn(`Stream from ${provider.getSlug()} failed, trying next`);
            }
            catch (error) {
                this.logger.error(`Stream error from ${provider.getSlug()}: ${error.message}`);
            }
        }
        yield { content: 'Error: All providers failed', done: true };
    }
    async generateImage(modelSlug, request) {
        return this.executeWithFallback(modelSlug, 'generateImage', request);
    }
    async generateVideo(modelSlug, request) {
        return this.executeWithFallback(modelSlug, 'generateVideo', request);
    }
    async generateAudio(modelSlug, request) {
        return this.executeWithFallback(modelSlug, 'generateAudio', request);
    }
    async checkTaskStatus(providerSlug, taskId) {
        const provider = this.registry.getProvider(providerSlug);
        if (!provider) {
            return { status: 'failed', error: `Provider ${providerSlug} not found` };
        }
        return provider.checkTaskStatus(taskId);
    }
    async getAllProviders() {
        return this.providerModel.find().sort({ priority: 1 }).exec();
    }
    async updateProvider(slug, updates) {
        const provider = await this.providerModel.findOneAndUpdate({ slug }, { $set: updates }, { new: true });
        if (!provider)
            throw new common_1.NotFoundException(`Provider ${slug} not found`);
        return provider;
    }
    async updateModel(slug, updates) {
        const model = await this.modelModel.findOneAndUpdate({ slug }, { $set: updates }, { new: true });
        if (!model)
            throw new common_1.NotFoundException(`Model ${slug} not found`);
        return model;
    }
    async executeWithFallback(modelSlug, method, request) {
        const providers = await this.registry.getProvidersForModel(modelSlug);
        if (providers.length === 0) {
            throw new common_1.BadRequestException(`No providers available for ${modelSlug}`);
        }
        let lastError = null;
        for (const { provider, modelId } of providers) {
            try {
                this.logger.debug(`${method} via ${provider.getSlug()} with model ${modelId}`);
                const result = await provider[method]({
                    ...request,
                    model: modelId,
                });
                await this.registry.updateProviderStats(provider.getSlug(), result.responseTimeMs, result.success);
                if (result.success) {
                    await this.updateModelStats(modelSlug, result.responseTimeMs, true);
                    return result;
                }
                if (result.error?.retryable) {
                    lastError = result;
                    continue;
                }
                return result;
            }
            catch (error) {
                this.logger.error(`${method} error from ${provider.getSlug()}: ${error.message}`);
                lastError = {
                    success: false,
                    error: {
                        code: 'PROVIDER_ERROR',
                        message: error.message,
                        retryable: true,
                    },
                    responseTimeMs: 0,
                    providerSlug: provider.getSlug(),
                };
            }
        }
        await this.updateModelStats(modelSlug, 0, false);
        return lastError || {
            success: false,
            error: {
                code: 'ALL_PROVIDERS_FAILED',
                message: `All providers failed for ${modelSlug}`,
                retryable: false,
            },
            responseTimeMs: 0,
            providerSlug: 'none',
        };
    }
    async updateModelStats(modelSlug, responseTimeMs, success) {
        const model = await this.modelModel.findOne({ slug: modelSlug });
        if (!model)
            return;
        const stats = model.stats || { totalRequests: 0, avgResponseTime: 0, successRate: 100 };
        const total = stats.totalRequests + 1;
        const successCount = Math.round((stats.successRate / 100) * stats.totalRequests);
        await this.modelModel.findOneAndUpdate({ slug: modelSlug }, {
            $set: {
                'stats.totalRequests': total,
                'stats.avgResponseTime': (stats.avgResponseTime * stats.totalRequests + responseTimeMs) / total,
                'stats.successRate': ((successCount + (success ? 1 : 0)) / total) * 100,
            },
        });
    }
};
exports.AiProvidersService = AiProvidersService;
exports.AiProvidersService = AiProvidersService = AiProvidersService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)(model_schema_1.AIModel.name)),
    __param(1, (0, mongoose_1.InjectModel)(provider_schema_1.Provider.name)),
    __metadata("design:paramtypes", [mongoose_2.Model,
        mongoose_2.Model,
        provider_registry_service_1.ProviderRegistryService])
], AiProvidersService);
//# sourceMappingURL=ai-providers.service.js.map