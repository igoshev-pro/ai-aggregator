// src/modules/billing/providers/heleket.provider.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import {
    PaymentProviderInterface,
    CreatePaymentDto,
    PaymentResult,
    WebhookResult,
} from './payment-provider.interface';

@Injectable()
export class HeleketProvider implements PaymentProviderInterface {
    private readonly logger = new Logger(HeleketProvider.name);
    private readonly merchantId: string;
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly webhookUrl: string;
    private readonly publicReturnUrl: string;

    constructor(private readonly configService: ConfigService) {
        const rawMerchant =
            this.configService.get<string>('HELEKET_MERCHANT_ID') ||
            this.configService.get<string>('HELEKET_MERCHANT_UUID') ||
            '';
        const rawApiKey =
            this.configService.get<string>('HELEKET_API_KEY') ||
            this.configService.get<string>('HELEKET_PAYMENT_API_KEY') ||
            '';

        this.merchantId = rawMerchant.trim();
        this.apiKey = rawApiKey.trim();

        this.baseUrl =
            this.configService.get<string>('HELEKET_BASE_URL') ||
            'https://api.heleket.com';

        const apiPublicUrl =
            this.configService.get<string>('API_PUBLIC_URL') ||
            'https://spichki-ai.net';
        this.webhookUrl =
            this.configService.get<string>('HELEKET_WEBHOOK_URL') ||
            `${apiPublicUrl}/api/v1/billing/webhook/heleket`;
        this.publicReturnUrl =
            this.configService.get<string>('HELEKET_RETURN_URL') ||
            `${apiPublicUrl}/topup/success`;

        // 🔍 ДИАГНОСТИКА — особенно важно: сравниваем длину ДО и ПОСЛЕ trim
        this.logger.log(
            `[Heleket] merchantId raw_len=${rawMerchant.length}, trimmed_len=${this.merchantId.length}, value="${this.merchantId}"`,
        );
        this.logger.log(
            `[Heleket] apiKey raw_len=${rawApiKey.length}, trimmed_len=${this.apiKey.length}, ` +
            `first4="${this.apiKey.slice(0, 4)}", last4="${this.apiKey.slice(-4)}", ` +
            `hex_first=${Buffer.from(this.apiKey.slice(0, 4)).toString('hex')}, ` +
            `hex_last=${Buffer.from(this.apiKey.slice(-4)).toString('hex')}`,
        );
    }

    // ───────────────────────────────────────────────────────────────
    // Создание платежа
    // ───────────────────────────────────────────────────────────────
    async createPayment(dto: CreatePaymentDto): Promise<PaymentResult> {
        try {
            const amount = dto.amount.toFixed(2);
            const currency = dto.currency;
            const orderId = `order_${Date.now()}_${dto.userId}`;

            const body: Record<string, any> = {
                amount,
                currency,
                order_id: orderId,
                url_callback: this.webhookUrl,
                url_return: dto.returnUrl || this.publicReturnUrl,
                url_success: dto.returnUrl || this.publicReturnUrl,
                lifetime: 3600,
                additional_data: JSON.stringify({
                    userId: dto.userId,
                    tokens: dto.tokens,
                    description: dto.description,
                }),
            };

            // ⚠️ ВАЖНО: подпись считается от той же строки, которая уйдёт в body.
            // Используем PHP-совместимую сериализацию.
            const bodyJson = this.phpJsonEncode(body);
            const sign = this.md5(
                Buffer.from(bodyJson).toString('base64') + this.apiKey,
            );

            this.logger.debug(`[Heleket] payload: ${bodyJson}`);
            this.logger.debug(`[Heleket] sign: ${sign}`);

            // 🔑 Отправляем именно ту же строку, что подписали — через `data: bodyJson`
            const response = await axios.post(
                `${this.baseUrl}/v1/payment`,
                bodyJson,
                {
                    headers: {
                        merchant: this.merchantId,
                        sign,
                        'Content-Type': 'application/json',
                    },
                    timeout: 15000,
                },
            );

            const data = response.data;

            if (data.state !== 0 || !data.result) {
                const msg =
                    data.message ||
                    (data.errors ? JSON.stringify(data.errors) : 'Unknown Heleket error');
                this.logger.error(`Heleket create payment error: ${msg}`);
                return { success: false, paymentId: '', error: msg };
            }

            return {
                success: true,
                paymentId: data.result.uuid,
                paymentUrl: data.result.url,
            };
        } catch (error: any) {
            const respData = error?.response?.data;
            const msg =
                respData?.message ||
                (respData?.errors && JSON.stringify(respData.errors)) ||
                error.message;
            this.logger.error(`Heleket create payment exception: ${msg}`);
            if (respData) {
                this.logger.error(`[Heleket] response body: ${JSON.stringify(respData)}`);
            }
            return { success: false, paymentId: '', error: msg };
        }
    }

    // ───────────────────────────────────────────────────────────────
    // Проверка webhook'а
    // ───────────────────────────────────────────────────────────────
    async verifyWebhook(body: any, _headers: any): Promise<WebhookResult> {
        try {
            if (!body || typeof body !== 'object') {
                return { success: false, paymentId: '', status: 'failed' };
            }

            const receivedSign: string = body.sign;
            if (!receivedSign) {
                this.logger.warn('[Heleket] webhook without sign');
                return { success: false, paymentId: '', status: 'failed' };
            }

            const { sign: _omit, ...dataWithoutSign } = body;

            if (!this.verifySign(dataWithoutSign, receivedSign)) {
                this.logger.warn('[Heleket] webhook sign mismatch');
                return { success: false, paymentId: '', status: 'failed' };
            }

            const heleketStatus: string = body.status || body.payment_status || '';
            let status: 'completed' | 'failed' | 'pending' = 'pending';

            if (['paid', 'paid_over'].includes(heleketStatus)) {
                status = 'completed';
            } else if (
                ['fail', 'cancel', 'wrong_amount', 'system_fail'].includes(heleketStatus)
            ) {
                status = 'failed';
            }

            let additionalData: Record<string, any> = {};
            if (body.additional_data) {
                try {
                    additionalData =
                        typeof body.additional_data === 'string'
                            ? JSON.parse(body.additional_data)
                            : body.additional_data;
                } catch {
                    additionalData = { raw: body.additional_data };
                }
            }

            return {
                success: true,
                paymentId: body.uuid || body.order_id,
                status,
                amount: parseFloat(body.amount || '0'),
                metadata: {
                    ...additionalData,
                    heleketStatus,
                    txid: body.txid,
                    payerCurrency: body.payer_currency,
                    network: body.network,
                    isFinal: body.is_final,
                },
            };
        } catch (error: any) {
            this.logger.error(`[Heleket] webhook error: ${error.message}`);
            return { success: false, paymentId: '', status: 'failed' };
        }
    }

    // ───────────────────────────────────────────────────────────────
    // Запрос статуса платежа
    // ───────────────────────────────────────────────────────────────
    async getPaymentStatus(paymentId: string): Promise<WebhookResult> {
        try {
            const body = { uuid: paymentId };
            const bodyJson = this.phpJsonEncode(body);
            const sign = this.md5(
                Buffer.from(bodyJson).toString('base64') + this.apiKey,
            );

            const response = await axios.post(
                `${this.baseUrl}/v1/payment/info`,
                bodyJson,
                {
                    headers: {
                        merchant: this.merchantId,
                        sign,
                        'Content-Type': 'application/json',
                    },
                    timeout: 15000,
                },
            );

            const data = response.data;
            if (data.state !== 0 || !data.result) {
                return { success: false, paymentId, status: 'failed' };
            }

            const payment = data.result;
            const heleketStatus: string =
                payment.payment_status || payment.status || '';

            let status: 'completed' | 'failed' | 'pending' = 'pending';
            if (['paid', 'paid_over'].includes(heleketStatus)) status = 'completed';
            else if (
                ['fail', 'cancel', 'wrong_amount', 'system_fail'].includes(heleketStatus)
            )
                status = 'failed';

            return {
                success: true,
                paymentId: payment.uuid,
                status,
                amount: parseFloat(payment.amount || '0'),
                metadata: { heleketStatus, isFinal: payment.is_final },
            };
        } catch (error: any) {
            this.logger.error(`[Heleket] getPaymentStatus error: ${error.message}`);
            return { success: false, paymentId, status: 'failed' };
        }
    }

    // ───────────────────────────────────────────────────────────────
    // Внутреннее
    // ───────────────────────────────────────────────────────────────

    /**
     * PHP-совместимая сериализация JSON.
     * PHP json_encode() по умолчанию:
     *  - экранирует `/` → `\/`
     *  - экранирует не-ASCII → `\uXXXX`
     *
     * Heleket — PHP-сервер, проверяет подпись от такого формата.
     */
    private phpJsonEncode(data: any): string {
        return JSON.stringify(data)
            .replace(/\//g, '\\/')
            .replace(/[\u0080-\uffff]/g, (ch) =>
                '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4),
            );
    }

    /**
     * Проверка подписи входящего webhook'а.
     * Пробуем все варианты сериализации — PHP-style и JS-style.
     */
    private verifySign(data: Record<string, any>, receivedSign: string): boolean {
        const candidates = [
            this.phpJsonEncode(data),       // PHP-style (основной)
            JSON.stringify(data),           // JS-style (fallback)
        ];

        for (const json of candidates) {
            const hash = this.md5(
                Buffer.from(json).toString('base64') + this.apiKey,
            );
            if (this.safeEqual(hash, receivedSign)) return true;
        }

        return false;
    }

    private md5(input: string): string {
        return crypto.createHash('md5').update(input).digest('hex');
    }

    private safeEqual(a: string, b: string): boolean {
        if (!a || !b || a.length !== b.length) return false;
        try {
            return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
        } catch {
            return false;
        }
    }
}