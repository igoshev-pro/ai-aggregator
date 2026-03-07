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
exports.AiProvidersController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const ai_providers_service_1 = require("./ai-providers.service");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const interfaces_1 = require("../../common/interfaces");
let AiProvidersController = class AiProvidersController {
    constructor(aiProvidersService) {
        this.aiProvidersService = aiProvidersService;
    }
    async getModels(type) {
        const models = type
            ? await this.aiProvidersService.getModelsByType(type)
            : await this.aiProvidersService.getAllModels();
        return {
            success: true,
            data: models.map((m) => ({
                slug: m.slug,
                name: m.name,
                displayName: m.displayName,
                description: m.description,
                icon: m.icon,
                type: m.type,
                tokenCost: m.tokenCost,
                isPremium: m.isPremium,
                capabilities: m.capabilities,
                defaultParams: m.defaultParams,
                limits: m.limits,
            })),
        };
    }
    async getModel(slug) {
        const model = await this.aiProvidersService.getModelBySlug(slug);
        return {
            success: true,
            data: {
                slug: model.slug,
                name: model.name,
                displayName: model.displayName,
                description: model.description,
                icon: model.icon,
                type: model.type,
                tokenCost: model.tokenCost,
                isPremium: model.isPremium,
                capabilities: model.capabilities,
                defaultParams: model.defaultParams,
                limits: model.limits,
                stats: model.stats,
            },
        };
    }
};
exports.AiProvidersController = AiProvidersController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Get all available AI models' }),
    (0, swagger_1.ApiQuery)({ name: 'type', enum: interfaces_1.GenerationType, required: false }),
    __param(0, (0, common_1.Query)('type')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AiProvidersController.prototype, "getModels", null);
__decorate([
    (0, common_1.Get)(':slug'),
    (0, swagger_1.ApiOperation)({ summary: 'Get model details by slug' }),
    __param(0, (0, common_1.Param)('slug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AiProvidersController.prototype, "getModel", null);
exports.AiProvidersController = AiProvidersController = __decorate([
    (0, swagger_1.ApiTags)('AI Models'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Controller)('models'),
    __metadata("design:paramtypes", [ai_providers_service_1.AiProvidersService])
], AiProvidersController);
//# sourceMappingURL=ai-providers.controller.js.map