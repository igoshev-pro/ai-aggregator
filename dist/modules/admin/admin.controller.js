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
exports.AdminController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const admin_service_1 = require("./admin.service");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../../common/guards/roles.guard");
const roles_decorator_1 = require("../../common/decorators/roles.decorator");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const interfaces_1 = require("../../common/interfaces");
let AdminController = class AdminController {
    constructor(adminService) {
        this.adminService = adminService;
    }
    async getDashboard() {
        const data = await this.adminService.getDashboardStats();
        return { success: true, data };
    }
    async getUsers(page = 1, limit = 50, search, role) {
        const data = await this.adminService.getUsers(page, limit, search, role);
        return { success: true, data };
    }
    async changeRole(userId, role) {
        const data = await this.adminService.changeUserRole(userId, role);
        return { success: true, data };
    }
    async toggleBan(userId, body) {
        const data = await this.adminService.toggleBan(userId, body.ban, body.reason);
        return { success: true, data };
    }
    async adjustBalance(adminId, userId, body) {
        const data = await this.adminService.adjustBalance(adminId, userId, body.amount, body.reason);
        return { success: true, data };
    }
    async getProviders() {
        const data = await this.adminService.getProviders();
        return { success: true, data };
    }
    async updateProvider(slug, body) {
        const data = await this.adminService.updateProvider(slug, body);
        return { success: true, data };
    }
    async getModels() {
        const data = await this.adminService.getModels();
        return { success: true, data };
    }
    async updateModel(slug, body) {
        const data = await this.adminService.updateModel(slug, body);
        return { success: true, data };
    }
    async getPromoCodes() {
        const data = await this.adminService.getPromoCodes();
        return { success: true, data };
    }
    async createPromoCode(adminId, body) {
        const data = await this.adminService.createPromoCode(adminId, body);
        return { success: true, data };
    }
    async deactivatePromo(code) {
        const data = await this.adminService.deactivatePromo(code);
        return { success: true, data };
    }
    async getRevenue(days = 30) {
        const data = await this.adminService.getRevenueAnalytics(days);
        return { success: true, data };
    }
    async getGenerationAnalytics(days = 30) {
        const data = await this.adminService.getGenerationAnalytics(days);
        return { success: true, data };
    }
    async getModelAnalytics() {
        const data = await this.adminService.getModelUsageAnalytics();
        return { success: true, data };
    }
};
exports.AdminController = AdminController;
__decorate([
    (0, common_1.Get)('dashboard'),
    (0, swagger_1.ApiOperation)({ summary: 'Get admin dashboard stats' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getDashboard", null);
__decorate([
    (0, common_1.Get)('users'),
    (0, swagger_1.ApiOperation)({ summary: 'List all users' }),
    __param(0, (0, common_1.Query)('page')),
    __param(1, (0, common_1.Query)('limit')),
    __param(2, (0, common_1.Query)('search')),
    __param(3, (0, common_1.Query)('role')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getUsers", null);
__decorate([
    (0, common_1.Put)('users/:id/role'),
    (0, roles_decorator_1.Roles)(interfaces_1.UserRole.SUPER_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Change user role' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)('role')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "changeRole", null);
__decorate([
    (0, common_1.Put)('users/:id/ban'),
    (0, swagger_1.ApiOperation)({ summary: 'Ban/unban user' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "toggleBan", null);
__decorate([
    (0, common_1.Post)('users/:id/adjust-balance'),
    (0, swagger_1.ApiOperation)({ summary: 'Adjust user balance' }),
    (0, common_1.HttpCode)(200),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "adjustBalance", null);
__decorate([
    (0, common_1.Get)('providers'),
    (0, swagger_1.ApiOperation)({ summary: 'List all AI providers' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getProviders", null);
__decorate([
    (0, common_1.Put)('providers/:slug'),
    (0, swagger_1.ApiOperation)({ summary: 'Update provider settings' }),
    __param(0, (0, common_1.Param)('slug')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "updateProvider", null);
__decorate([
    (0, common_1.Get)('models'),
    (0, swagger_1.ApiOperation)({ summary: 'List all AI models' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getModels", null);
__decorate([
    (0, common_1.Put)('models/:slug'),
    (0, swagger_1.ApiOperation)({ summary: 'Update model settings' }),
    __param(0, (0, common_1.Param)('slug')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "updateModel", null);
__decorate([
    (0, common_1.Get)('promo-codes'),
    (0, swagger_1.ApiOperation)({ summary: 'List all promo codes' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getPromoCodes", null);
__decorate([
    (0, common_1.Post)('promo-codes'),
    (0, swagger_1.ApiOperation)({ summary: 'Create promo code' }),
    (0, common_1.HttpCode)(201),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "createPromoCode", null);
__decorate([
    (0, common_1.Delete)('promo-codes/:code'),
    (0, swagger_1.ApiOperation)({ summary: 'Deactivate promo code' }),
    __param(0, (0, common_1.Param)('code')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "deactivatePromo", null);
__decorate([
    (0, common_1.Get)('analytics/revenue'),
    (0, swagger_1.ApiOperation)({ summary: 'Revenue analytics' }),
    __param(0, (0, common_1.Query)('days')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getRevenue", null);
__decorate([
    (0, common_1.Get)('analytics/generations'),
    (0, swagger_1.ApiOperation)({ summary: 'Generation analytics' }),
    __param(0, (0, common_1.Query)('days')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getGenerationAnalytics", null);
__decorate([
    (0, common_1.Get)('analytics/models'),
    (0, swagger_1.ApiOperation)({ summary: 'Model usage analytics' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "getModelAnalytics", null);
exports.AdminController = AdminController = __decorate([
    (0, swagger_1.ApiTags)('Admin'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)(interfaces_1.UserRole.ADMIN, interfaces_1.UserRole.SUPER_ADMIN),
    (0, common_1.Controller)('admin'),
    __metadata("design:paramtypes", [admin_service_1.AdminService])
], AdminController);
//# sourceMappingURL=admin.controller.js.map