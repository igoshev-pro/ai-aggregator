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
exports.BillingController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const billing_service_1 = require("./billing.service");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const interfaces_1 = require("../../common/interfaces");
let BillingController = class BillingController {
    constructor(billingService) {
        this.billingService = billingService;
    }
    getPackages() {
        return { success: true, data: this.billingService.getTokenPackages() };
    }
    getPlans() {
        return { success: true, data: this.billingService.getSubscriptionPlans() };
    }
    async getBalance(userId) {
        const result = await this.billingService.getBalance(userId);
        return { success: true, data: result };
    }
    async payTokens(userId, body) {
        const result = await this.billingService.createTokenPayment(userId, body.packageId, body.provider, body.returnUrl);
        return { success: true, data: result };
    }
    async paySubscription(userId, body) {
        const result = await this.billingService.createSubscription(userId, body.plan, body.provider, body.returnUrl);
        return { success: true, data: result };
    }
    async applyPromo(userId, body) {
        const result = await this.billingService.applyPromoCode(userId, body.code);
        return { success: true, data: result };
    }
    async getTransactions(userId, type, page = 1, limit = 20) {
        const result = await this.billingService.getTransactionHistory(userId, type, page, limit);
        return { success: true, data: result };
    }
    async yookassaWebhook(body, headers) {
        const result = await this.billingService.handlePaymentWebhook('yookassa', body, headers);
        return result;
    }
    async cryptomusWebhook(body, headers) {
        const result = await this.billingService.handlePaymentWebhook('cryptomus', body, headers);
        return result;
    }
};
exports.BillingController = BillingController;
__decorate([
    (0, common_1.Get)('packages'),
    (0, swagger_1.ApiOperation)({ summary: 'Get available token packages' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "getPackages", null);
__decorate([
    (0, common_1.Get)('plans'),
    (0, swagger_1.ApiOperation)({ summary: 'Get subscription plans' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "getPlans", null);
__decorate([
    (0, common_1.Get)('balance'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Get user balance and limits' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "getBalance", null);
__decorate([
    (0, common_1.Post)('pay/tokens'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Create payment for token package' }),
    (0, common_1.HttpCode)(200),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "payTokens", null);
__decorate([
    (0, common_1.Post)('pay/subscription'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Create payment for subscription' }),
    (0, common_1.HttpCode)(200),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "paySubscription", null);
__decorate([
    (0, common_1.Post)('promo'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Apply promo code' }),
    (0, common_1.HttpCode)(200),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "applyPromo", null);
__decorate([
    (0, common_1.Get)('transactions'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Get transaction history' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __param(1, (0, common_1.Query)('type')),
    __param(2, (0, common_1.Query)('page')),
    __param(3, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object, Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "getTransactions", null);
__decorate([
    (0, common_1.Post)('webhook/yookassa'),
    (0, swagger_1.ApiOperation)({ summary: 'YooKassa payment webhook' }),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Headers)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "yookassaWebhook", null);
__decorate([
    (0, common_1.Post)('webhook/cryptomus'),
    (0, swagger_1.ApiOperation)({ summary: 'Cryptomus payment webhook' }),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Headers)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "cryptomusWebhook", null);
exports.BillingController = BillingController = __decorate([
    (0, swagger_1.ApiTags)('Billing'),
    (0, common_1.Controller)('billing'),
    __metadata("design:paramtypes", [billing_service_1.BillingService])
], BillingController);
//# sourceMappingURL=billing.controller.js.map