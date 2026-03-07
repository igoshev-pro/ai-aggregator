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
var GenerationConsumer_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GenerationConsumer = void 0;
const bull_1 = require("@nestjs/bull");
const common_1 = require("@nestjs/common");
const generation_service_1 = require("../generation.service");
const ai_providers_service_1 = require("../../ai-providers/ai-providers.service");
const interfaces_1 = require("../../../common/interfaces");
const generation_gateway_1 = require("../generation.gateway");
let GenerationConsumer = GenerationConsumer_1 = class GenerationConsumer {
    constructor(generationService, aiProvidersService, generationGateway) {
        this.generationService = generationService;
        this.aiProvidersService = aiProvidersService;
        this.generationGateway = generationGateway;
        this.logger = new common_1.Logger(GenerationConsumer_1.name);
    }
    async handleGeneration(job) {
        const { generationId, userId, type, modelSlug, request } = job.data;
        this.logger.log(`Processing ${type} generation ${generationId} with model ${modelSlug}`);
        await this.generationService.updateGeneration(generationId, {
            status: interfaces_1.GenerationStatus.PROCESSING,
            startedAt: new Date(),
        });
        this.generationGateway.sendToUser(userId, 'generation:status', {
            generationId,
            status: interfaces_1.GenerationStatus.PROCESSING,
        });
        try {
            let result;
            switch (type) {
                case interfaces_1.GenerationType.IMAGE:
                    result = await this.aiProvidersService.generateImage(modelSlug, request);
                    break;
                case interfaces_1.GenerationType.VIDEO:
                    result = await this.aiProvidersService.generateVideo(modelSlug, request);
                    break;
                case interfaces_1.GenerationType.AUDIO:
                    result = await this.aiProvidersService.generateAudio(modelSlug, request);
                    break;
                default:
                    throw new Error(`Unsupported generation type: ${type}`);
            }
            if (!result.success) {
                throw new Error(result.error?.message || 'Generation failed');
            }
            if (result.data?.taskId && (!result.data?.urls || result.data.urls.length === 0)) {
                await this.pollTaskUntilComplete(generationId, userId, result.providerSlug, result.data.taskId, type);
                return;
            }
            const now = new Date();
            await this.generationService.updateGeneration(generationId, {
                status: interfaces_1.GenerationStatus.COMPLETED,
                resultUrls: result.data?.urls || [],
                resultContent: result.data?.content,
                providerSlug: result.providerSlug,
                responseTimeMs: result.responseTimeMs,
                completedAt: now,
                progress: 100,
                metadata: result.data?.metadata || {},
            });
            this.generationGateway.sendToUser(userId, 'generation:completed', {
                generationId,
                status: interfaces_1.GenerationStatus.COMPLETED,
                resultUrls: result.data?.urls || [],
                resultContent: result.data?.content,
                responseTimeMs: result.responseTimeMs,
            });
            this.logger.log(`✅ Generation ${generationId} completed in ${result.responseTimeMs}ms`);
        }
        catch (error) {
            this.logger.error(`❌ Generation ${generationId} failed: ${error.message}`);
            await this.generationService.updateGeneration(generationId, {
                status: interfaces_1.GenerationStatus.FAILED,
                errorMessage: error.message,
                completedAt: new Date(),
            });
            await this.generationService.refundGeneration(generationId);
            this.generationGateway.sendToUser(userId, 'generation:failed', {
                generationId,
                status: interfaces_1.GenerationStatus.FAILED,
                errorMessage: error.message,
                refunded: true,
            });
            throw error;
        }
    }
    async pollTaskUntilComplete(generationId, userId, providerSlug, taskId, type) {
        const maxAttempts = 120;
        const pollInterval = 5000;
        let attempts = 0;
        await this.generationService.updateGeneration(generationId, {
            taskId,
            providerSlug,
        });
        while (attempts < maxAttempts) {
            attempts++;
            await this.sleep(pollInterval);
            try {
                const taskResult = await this.aiProvidersService.checkTaskStatus(providerSlug, taskId);
                this.logger.debug(`Poll ${generationId}: attempt ${attempts}, status: ${taskResult.status}, progress: ${taskResult.progress}`);
                if (taskResult.progress !== undefined || taskResult.eta !== undefined) {
                    await this.generationService.updateGeneration(generationId, {
                        progress: taskResult.progress || 0,
                        eta: taskResult.eta,
                    });
                    this.generationGateway.sendToUser(userId, 'generation:progress', {
                        generationId,
                        progress: taskResult.progress || 0,
                        eta: taskResult.eta,
                        status: interfaces_1.GenerationStatus.PROCESSING,
                    });
                }
                if (taskResult.status === 'completed') {
                    const now = new Date();
                    await this.generationService.updateGeneration(generationId, {
                        status: interfaces_1.GenerationStatus.COMPLETED,
                        resultUrls: taskResult.resultUrls || [],
                        completedAt: now,
                        progress: 100,
                    });
                    this.generationGateway.sendToUser(userId, 'generation:completed', {
                        generationId,
                        status: interfaces_1.GenerationStatus.COMPLETED,
                        resultUrls: taskResult.resultUrls || [],
                    });
                    this.logger.log(`✅ Async generation ${generationId} completed`);
                    return;
                }
                if (taskResult.status === 'failed') {
                    throw new Error(taskResult.error || 'Task failed at provider');
                }
            }
            catch (error) {
                if (error.message.includes('Task failed')) {
                    throw error;
                }
                this.logger.warn(`Poll error for ${generationId}: ${error.message}, retrying...`);
            }
        }
        throw new Error(`Generation timeout: task ${taskId} did not complete in ${(maxAttempts * pollInterval) / 1000} seconds`);
    }
    async onFailed(job, error) {
        this.logger.error(`Job ${job.id} for generation ${job.data.generationId} failed after ${job.attemptsMade} attempts: ${error.message}`);
        if (job.attemptsMade >= (job.opts.attempts || 3)) {
            this.logger.error(`Generation ${job.data.generationId} permanently failed`);
        }
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
};
exports.GenerationConsumer = GenerationConsumer;
__decorate([
    (0, bull_1.Process)('process-generation'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GenerationConsumer.prototype, "handleGeneration", null);
__decorate([
    (0, bull_1.OnQueueFailed)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Error]),
    __metadata("design:returntype", Promise)
], GenerationConsumer.prototype, "onFailed", null);
exports.GenerationConsumer = GenerationConsumer = GenerationConsumer_1 = __decorate([
    (0, bull_1.Processor)('generation'),
    __param(0, (0, common_1.Inject)((0, common_1.forwardRef)(() => generation_service_1.GenerationService))),
    __param(1, (0, common_1.Inject)((0, common_1.forwardRef)(() => ai_providers_service_1.AiProvidersService))),
    __metadata("design:paramtypes", [generation_service_1.GenerationService,
        ai_providers_service_1.AiProvidersService,
        generation_gateway_1.GenerationGateway])
], GenerationConsumer);
//# sourceMappingURL=generation.consumer.js.map