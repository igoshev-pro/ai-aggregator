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
var StarsProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarsProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const axios_1 = require("axios");
let StarsProvider = StarsProvider_1 = class StarsProvider {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(StarsProvider_1.name);
        this.botToken = this.configService.get('TELEGRAM_BOT_TOKEN') || '';
    }
    async createPayment(dto) {
        try {
            const response = await axios_1.default.post(`https://api.telegram.org/bot${this.botToken}/createInvoiceLink`, {
                title: 'Пополнение баланса',
                description: `${dto.tokens} токенов для AI генерации`,
                payload: JSON.stringify({ userId: dto.userId, tokens: dto.tokens }),
                currency: 'XTR',
                prices: [{ label: `${dto.tokens} токенов`, amount: dto.amount }],
            });
            if (response.data.ok) {
                return { success: true, paymentId: `stars_${Date.now()}`, paymentUrl: response.data.result };
            }
            return { success: false, paymentId: '', error: response.data.description || 'Failed' };
        }
        catch (error) {
            this.logger.error(`Stars create payment error: ${error.message}`);
            return { success: false, paymentId: '', error: error.message };
        }
    }
    async verifyWebhook(body, _headers) {
        try {
            const payload = JSON.parse(body.invoice_payload || '{}');
            return {
                success: true,
                paymentId: body.telegram_payment_charge_id || '',
                status: 'completed',
                amount: body.total_amount,
                metadata: payload,
            };
        }
        catch {
            return { success: false, paymentId: '', status: 'failed' };
        }
    }
    async getPaymentStatus(paymentId) {
        return { success: true, paymentId, status: 'completed' };
    }
};
exports.StarsProvider = StarsProvider;
exports.StarsProvider = StarsProvider = StarsProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], StarsProvider);
//# sourceMappingURL=stars.provider.js.map