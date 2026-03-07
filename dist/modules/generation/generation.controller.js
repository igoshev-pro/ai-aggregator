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
Object.defineProperty(exports, "__esModule", { value: true });
exports.GenerationController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const generation_service_1 = require("./generation.service");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const image_generation_dto_1 = require("./dto/image-generation.dto");
const interfaces_1 = require("../../common/interfaces");
const throttler_1 = require("@nestjs/throttler");
let GenerationController = class GenerationController {
    constructor(generationService) {
        this.generationService = generationService;
    }
    async generateImage(userId, dto) {
        const result = await this.generationService.generateImage(userId, dto);
        return { success: true, data: result };
    }
    async generateVideo(userId, dto) {
        const result = await this.generationService.generateVideo(userId, dto);
        return { success: true, data: result };
    }
    async generateAudio(userId, dto) {
        const result = await this.generationService.generateAudio(userId, dto);
        return { success: true, data: result };
    }
    async getStatus(userId, generationId) {
        const result = await this.generationService.getGenerationStatus(userId, generationId);
        return { success: true, data: result };
    }
    async getHistory(userId, type, page = 1, limit = 20) {
        const result = await this.generationService.getUserGenerations(userId, type, page, limit);
        return { success: true, data: result };
    }
    async getFavorites(userId, page = 1, limit = 20) {
        const result = await this.generationService.getFavorites(userId, page, limit);
        return { success: true, data: result };
    }
    async toggleFavorite(userId, generationId) {
        const result = await this.generationService.toggleFavorite(userId, generationId);
        return { success: true, data: result };
    }
};
exports.GenerationController = GenerationController;
__decorate([
    (0, common_1.Post)('image'),
    (0, swagger_1.ApiOperation)({ summary: 'Generate image' }),
    (0, throttler_1.Throttle)({ default: { limit: 5, ttl: 60000 } }),
    (0, common_1.HttpCode)(202),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, image_generation_dto_1.ImageGenerationDto]),
    __metadata("design:returntype", Promise)
], GenerationController.prototype, "generateImage", null);
__decorate([
    (0, common_1.Post)('video'),
    (0, swagger_1.ApiOperation)({ summary: 'Generate video' }),
    (0, throttler_1.Throttle)({ default: { limit: 3, ttl: 60000 } }),
    (0, common_1.HttpCode)(202),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, image_generation_dto_1.VideoGenerationDto]),
    __metadata("design:returntype", Promise)
], GenerationController.prototype, "generateVideo", null);
__decorate([
    (0, common_1.Post)('audio'),
    (0, swagger_1.ApiOperation)({ summary: 'Generate audio' }),
    (0, throttler_1.Throttle)({ default: { limit: 5, ttl: 60000 } }),
    (0, common_1.HttpCode)(202),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, image_generation_dto_1.AudioGenerationDto]),
    __metadata("design:returntype", Promise)
], GenerationController.prototype, "generateAudio", null);
__decorate([
    (0, common_1.Get)('status/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'Get generation status' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], GenerationController.prototype, "getStatus", null);
__decorate([
    (0, common_1.Get)('history'),
    (0, swagger_1.ApiOperation)({ summary: 'Get generation history' }),
    (0, swagger_1.ApiQuery)({ name: 'type', enum: interfaces_1.GenerationType, required: false }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'limit', required: false }),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __param(1, (0, common_1.Query)('type')),
    __param(2, (0, common_1.Query)('page')),
    __param(3, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object, Object]),
    __metadata("design:returntype", Promise)
], GenerationController.prototype, "getHistory", null);
__decorate([
    (0, common_1.Get)('favorites'),
    (0, swagger_1.ApiOperation)({ summary: 'Get favorite generations' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __param(1, (0, common_1.Query)('page')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], GenerationController.prototype, "getFavorites", null);
__decorate([
    (0, common_1.Put)(':id/favorite'),
    (0, swagger_1.ApiOperation)({ summary: 'Toggle favorite' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], GenerationController.prototype, "toggleFavorite", null);
exports.GenerationController = GenerationController = __decorate([
    (0, swagger_1.ApiTags)('Generation'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Controller)('generation'),
    __metadata("design:paramtypes", [generation_service_1.GenerationService])
], GenerationController);
//# sourceMappingURL=generation.controller.js.map