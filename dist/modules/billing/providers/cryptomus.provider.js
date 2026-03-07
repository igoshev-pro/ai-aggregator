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
var CryptomusProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CryptomusProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const axios_1 = require("axios");
const crypto = require("crypto");
let CryptomusProvider = CryptomusProvider_1 = class CryptomusProvider {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(CryptomusProvider_1.name);
        this.merchantId = this.configService.get('CRYPTOMUS_MERCHANT_ID') || '';
        this.apiKey = this.configService.get('CRYPTOMUS_API_KEY') || '';
    }
    async createPayment(dto) {
        try {
            const body = {
                amount: dto.amount.toString(),
                currency: 'RUB',
                order_id: `order_${Date.now()}_${dto.userId}`,
                url_return: dto.returnUrl || 'https://t.me/your_bot',
                is_payment_multiple: false,
                additional_data: JSON.stringify({ userId: dto.userId, tokens: dto.tokens }),
            };
            const sign = this.createSign(body);
            const response = await axios_1.default.post('https://api.cryptomus.com/v1/payment', body, {
                headers: { merchant: this.merchantId, sign, 'Content-Type': 'application/json' },
            });
            return {
                success: true,
                paymentId: response.data.result.uuid,
                paymentUrl: response.data.result.url,
            };
        }
        catch (error) {
            this.logger.error(`Cryptomus create payment error: ${error.message}`);
            return { success: false, paymentId: '', error: error.message };
        }
    }
    async verifyWebhook(body, _headers) {
        try {
            const receivedSign = body.sign;
            const bodyWithoutSign = { ...body };
            delete bodyWithoutSign.sign;
            const expectedSign = this.createSign(bodyWithoutSign);
            if (receivedSign !== expectedSign) {
                return { success: false, paymentId: '', status: 'failed' };
            }
            let status = 'pending';
            if (['paid', 'paid_over'].includes(body.status))
                status = 'completed';
            else if (['cancel', 'fail', 'system_fail', 'wrong_amount'].includes(body.status))
                status = 'failed';
            const additionalData = body.additional_data ? JSON.parse(body.additional_data) : {};
            return {
                success: true,
                paymentId: body.uuid || body.order_id,
                status,
                amount: parseFloat(body.amount || '0'),
                metadata: additionalData,
            };
        }
        catch (error) {
            this.logger.error(`Cryptomus webhook error: ${error.message}`);
            return { success: false, paymentId: '', status: 'failed' };
        }
    }
    async getPaymentStatus(paymentId) {
        try {
            const body = { uuid: paymentId };
            const sign = this.createSign(body);
            const response = await axios_1.default.post('https://api.cryptomus.com/v1/payment/info', body, {
                headers: { merchant: this.merchantId, sign, 'Content-Type': 'application/json' },
            });
            const payment = response.data.result;
            let status = 'pending';
            if (['paid', 'paid_over'].includes(payment.payment_status))
                status = 'completed';
            else if (['cancel', 'fail'].includes(payment.payment_status))
                status = 'failed';
            return { success: true, paymentId: payment.uuid, status, amount: parseFloat(payment.amount || '0') };
        }
        catch {
            return { success: false, paymentId, status: 'failed' };
        }
    }
    createSign(data) {
        const jsonBase64 = Buffer.from(JSON.stringify(data)).toString('base64');
        return crypto.createHash('md5').update(jsonBase64 + this.apiKey).digest('hex');
    }
};
exports.CryptomusProvider = CryptomusProvider;
exports.CryptomusProvider = CryptomusProvider = CryptomusProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], CryptomusProvider);
//# sourceMappingURL=cryptomus.provider.js.map