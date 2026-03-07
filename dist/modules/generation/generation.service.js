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
var GenerationService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GenerationService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const bull_1 = require("@nestjs/bull");
const mongoose_2 = require("mongoose");
const generation_schema_1 = require("./schemas/generation.schema");
const ai_providers_service_1 = require("../ai-providers/ai-providers.service");
const users_service_1 = require("../users/users.service");
const billing_service_1 = require("../billing/billing.service");
const interfaces_1 = require("../../common/interfaces");
let GenerationService = GenerationService_1 = class GenerationService {
    constructor(generationModel, generationQueue, aiProvidersService, usersService, billingService) {
        this.generationModel = generationModel;
        this.generationQueue = generationQueue;
        this.aiProvidersService = aiProvidersService;
        this.usersService = usersService;
        this.billingService = billingService;
        this.logger = new common_1.Logger(GenerationService_1.name);
    }
    async generateImage(userId, dto) {
        const model = await this.aiProvidersService.getModelBySlug(dto.modelSlug);
        await this.validateBalance(userId, model.tokenCost);
        const generation = new this.generationModel({
            userId: new mongoose_2.Types.ObjectId(userId),
            type: interfaces_1.GenerationType.IMAGE,
            modelSlug: dto.modelSlug,
            status: interfaces_1.GenerationStatus.PENDING,
            prompt: dto.prompt,
            negativePrompt: dto.negativePrompt,
            params: {
                width: dto.width || model.defaultParams?.width || 1024,
                height: dto.height || model.defaultParams?.height || 1024,
                steps: dto.steps || model.defaultParams?.steps,
                seed: dto.seed,
                numImages: dto.numImages || 1,
                style: dto.style,
            },
            tokensCost: model.tokenCost,
        });
        await generation.save();
        await this.usersService.deductTokens(userId, model.tokenCost, 'generation_reserve');
        await this.generationQueue.add('process-generation', {
            generationId: generation._id.toString(),
            userId,
            type: interfaces_1.GenerationType.IMAGE,
            modelSlug: dto.modelSlug,
            request: {
                prompt: dto.prompt,
                negativePrompt: dto.negativePrompt,
                width: generation.params.width,
                height: generation.params.height,
                steps: generation.params.steps,
                seed: generation.params.seed,
                numImages: generation.params.numImages,
                style: generation.params.style,
            },
        }, {
            priority: 2,
            attempts: 3,
            backoff: { type: 'exponential', delay: 3000 },
            timeout: 300000,
        });
        return {
            generationId: generation._id.toString(),
            status: generation.status,
            tokensCost: model.tokenCost,
        };
    }
    async generateVideo(userId, dto) {
        const model = await this.aiProvidersService.getModelBySlug(dto.modelSlug);
        await this.validateBalance(userId, model.tokenCost);
        const generation = new this.generationModel({
            userId: new mongoose_2.Types.ObjectId(userId),
            type: interfaces_1.GenerationType.VIDEO,
            modelSlug: dto.modelSlug,
            status: interfaces_1.GenerationStatus.PENDING,
            prompt: dto.prompt,
            negativePrompt: dto.negativePrompt,
            params: {
                imageUrl: dto.imageUrl,
                duration: dto.duration || model.defaultParams?.duration || 5,
                aspectRatio: dto.aspectRatio || '16:9',
                resolution: dto.resolution || '720p',
                style: dto.style,
            },
            tokensCost: model.tokenCost,
        });
        await generation.save();
        await this.usersService.deductTokens(userId, model.tokenCost, 'generation_reserve');
        await this.generationQueue.add('process-generation', {
            generationId: generation._id.toString(),
            userId,
            type: interfaces_1.GenerationType.VIDEO,
            modelSlug: dto.modelSlug,
            request: {
                prompt: dto.prompt,
                negativePrompt: dto.negativePrompt,
                imageUrl: dto.imageUrl,
                duration: generation.params.duration,
                aspectRatio: generation.params.aspectRatio,
                resolution: generation.params.resolution,
                style: generation.params.style,
            },
        }, {
            priority: 3,
            attempts: 2,
            backoff: { type: 'exponential', delay: 5000 },
            timeout: 600000,
        });
        return {
            generationId: generation._id.toString(),
            status: generation.status,
            tokensCost: model.tokenCost,
        };
    }
    async generateAudio(userId, dto) {
        const model = await this.aiProvidersService.getModelBySlug(dto.modelSlug);
        await this.validateBalance(userId, model.tokenCost);
        const generation = new this.generationModel({
            userId: new mongoose_2.Types.ObjectId(userId),
            type: interfaces_1.GenerationType.AUDIO,
            modelSlug: dto.modelSlug,
            status: interfaces_1.GenerationStatus.PENDING,
            prompt: dto.prompt,
            params: {
                style: dto.style,
                duration: dto.duration,
                instrumental: dto.instrumental,
                voiceId: dto.voiceId,
                language: dto.language,
            },
            tokensCost: model.tokenCost,
        });
        await generation.save();
        await this.usersService.deductTokens(userId, model.tokenCost, 'generation_reserve');
        await this.generationQueue.add('process-generation', {
            generationId: generation._id.toString(),
            userId,
            type: interfaces_1.GenerationType.AUDIO,
            modelSlug: dto.modelSlug,
            request: {
                prompt: dto.prompt,
                style: dto.style,
                duration: generation.params.duration,
                instrumental: generation.params.instrumental,
                voiceId: generation.params.voiceId,
                language: generation.params.language,
            },
        }, {
            priority: 2,
            attempts: 3,
            backoff: { type: 'exponential', delay: 3000 },
            timeout: 600000,
        });
        return {
            generationId: generation._id.toString(),
            status: generation.status,
            tokensCost: model.tokenCost,
        };
    }
    async getGenerationStatus(userId, generationId) {
        const generation = await this.generationModel.findById(generationId);
        if (!generation)
            throw new common_1.NotFoundException('Generation not found');
        if (generation.userId.toString() !== userId) {
            throw new common_1.ForbiddenException('Access denied');
        }
        return {
            id: generation._id,
            type: generation.type,
            modelSlug: generation.modelSlug,
            status: generation.status,
            progress: generation.progress,
            eta: generation.eta,
            resultUrls: generation.resultUrls,
            resultContent: generation.resultContent,
            tokensCost: generation.tokensCost,
            errorMessage: generation.errorMessage,
            prompt: generation.prompt,
            params: generation.params,
            createdAt: generation['createdAt'],
            completedAt: generation.completedAt,
            responseTimeMs: generation.responseTimeMs,
        };
    }
    async getUserGenerations(userId, type, page = 1, limit = 20) {
        const filter = { userId: new mongoose_2.Types.ObjectId(userId) };
        if (type)
            filter.type = type;
        const skip = (page - 1) * limit;
        const [generations, total] = await Promise.all([
            this.generationModel
                .find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .exec(),
            this.generationModel.countDocuments(filter),
        ]);
        return {
            generations: generations.map((g) => ({
                id: g._id,
                type: g.type,
                modelSlug: g.modelSlug,
                status: g.status,
                prompt: g.prompt,
                resultUrls: g.resultUrls,
                tokensCost: g.tokensCost,
                isFavorite: g.isFavorite,
                createdAt: g['createdAt'],
                completedAt: g.completedAt,
            })),
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        };
    }
    async updateGeneration(generationId, updates) {
        return this.generationModel.findByIdAndUpdate(generationId, { $set: updates }, { new: true });
    }
    async refundGeneration(generationId) {
        const generation = await this.generationModel.findById(generationId);
        if (!generation || generation.isRefunded)
            return;
        await this.usersService.refundTokens(generation.userId.toString(), generation.tokensCost);
        await this.billingService.recordRefund(generation.userId.toString(), generation.tokensCost, `Refund for failed ${generation.type} generation`, generationId);
        generation.isRefunded = true;
        await generation.save();
    }
    async toggleFavorite(userId, generationId) {
        const generation = await this.generationModel.findById(generationId);
        if (!generation)
            throw new common_1.NotFoundException('Generation not found');
        if (generation.userId.toString() !== userId) {
            throw new common_1.ForbiddenException('Access denied');
        }
        generation.isFavorite = !generation.isFavorite;
        await generation.save();
        return { isFavorite: generation.isFavorite };
    }
    async getFavorites(userId, page = 1, limit = 20) {
        const skip = (page - 1) * limit;
        const filter = {
            userId: new mongoose_2.Types.ObjectId(userId),
            isFavorite: true,
            status: interfaces_1.GenerationStatus.COMPLETED,
        };
        const [generations, total] = await Promise.all([
            this.generationModel
                .find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .exec(),
            this.generationModel.countDocuments(filter),
        ]);
        return {
            generations,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        };
    }
    async validateBalance(userId, cost) {
        const user = await this.usersService.findById(userId);
        const totalBalance = user.tokenBalance + user.bonusTokens;
        if (totalBalance < cost) {
            throw new common_1.BadRequestException(`Insufficient tokens. Need ${cost}, have ${totalBalance}`);
        }
    }
};
exports.GenerationService = GenerationService;
exports.GenerationService = GenerationService = GenerationService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)(generation_schema_1.Generation.name)),
    __param(1, (0, bull_1.InjectQueue)('generation')),
    __param(2, (0, common_1.Inject)((0, common_1.forwardRef)(() => ai_providers_service_1.AiProvidersService))),
    __param(3, (0, common_1.Inject)((0, common_1.forwardRef)(() => users_service_1.UsersService))),
    __param(4, (0, common_1.Inject)((0, common_1.forwardRef)(() => billing_service_1.BillingService))),
    __metadata("design:paramtypes", [mongoose_2.Model, Object, ai_providers_service_1.AiProvidersService,
        users_service_1.UsersService,
        billing_service_1.BillingService])
], GenerationService);
//# sourceMappingURL=generation.service.js.map