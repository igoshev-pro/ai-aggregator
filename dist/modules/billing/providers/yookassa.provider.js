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
var YookassaProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.YookassaProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const axios_1 = require("axios");
const uuid_1 = require("uuid");
let YookassaProvider = YookassaProvider_1 = class YookassaProvider {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(YookassaProvider_1.name);
        this.shopId = this.configService.get('YOOKASSA_SHOP_ID') || '';
        const secretKey = this.configService.get('YOOKASSA_SECRET_KEY') || '';
        this.client = axios_1.default.create({
            baseURL: 'https://api.yookassa.ru/v3',
            auth: { username: this.shopId, password: secretKey },
            headers: { 'Content-Type': 'application/json' },
        });
    }
    async createPayment(dto) {
        try {
            const idempotenceKey = (0, uuid_1.v4)();
            const response = await this.client.post('/payments', {
                amount: { value: dto.amount.toFixed(2), currency: 'RUB' },
                confirmation: {
                    type: 'redirect',
                    return_url: dto.returnUrl || 'https://t.me/your_bot',
                },
                capture: true,
                description: dto.description,
                metadata: { userId: dto.userId, tokens: dto.tokens },
            }, { headers: { 'Idempotence-Key': idempotenceKey } });
            return {
                success: true,
                paymentId: response.data.id,
                paymentUrl: response.data.confirmation?.confirmation_url,
            };
        }
        catch (error) {
            this.logger.error(`YooKassa create payment error: ${error.message}`);
            return { success: false, paymentId: '', error: error.message };
        }
    }
    async verifyWebhook(body, _headers) {
        try {
            const event = body;
            const payment = event.object;
            let status = 'pending';
            if (event.event === 'payment.succeeded')
                status = 'completed';
            else if (event.event === 'payment.canceled')
                status = 'failed';
            return {
                success: true,
                paymentId: payment.id,
                status,
                amount: parseFloat(payment.amount?.value || '0'),
                metadata: payment.metadata,
            };
        }
        catch (error) {
            this.logger.error(`YooKassa webhook error: ${error.message}`);
            return { success: false, paymentId: '', status: 'failed' };
        }
    }
    async getPaymentStatus(paymentId) {
        try {
            const response = await this.client.get(`/payments/${paymentId}`);
            const payment = response.data;
            let status = 'pending';
            if (payment.status === 'succeeded')
                status = 'completed';
            else if (payment.status === 'canceled')
                status = 'failed';
            return {
                success: true,
                paymentId: payment.id,
                status,
                amount: parseFloat(payment.amount?.value || '0'),
                metadata: payment.metadata,
            };
        }
        catch {
            return { success: false, paymentId, status: 'failed' };
        }
    }
};
exports.YookassaProvider = YookassaProvider;
exports.YookassaProvider = YookassaProvider = YookassaProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], YookassaProvider);
//# sourceMappingURL=yookassa.provider.js.map