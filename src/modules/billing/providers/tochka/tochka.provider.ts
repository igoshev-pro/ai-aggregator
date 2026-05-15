import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    CreatePaymentDto,
    PaymentProviderInterface,
    PaymentResult,
    WebhookResult,
} from '../payment-provider.interface';
import { TochkaClient } from './tochka.client';
import { TochkaWebhookVerifier } from './tochka-webhook.verifier';
import {
    TochkaAcquiringWebhookPayload,
    TochkaCreatePaymentRequest,
    TochkaPaymentStatus,
} from './tochka.types';

/**
 * Платёжный провайдер Точка Банк.
 *
 * Особенности:
 * - Поддерживает только RUB.
 * - Принимает карты и СБП в одной платёжной ссылке.
 * - Вебхук = JWT в text/plain, проверка подписи через RS256.
 *   Контроллер обязан верифицировать подпись ДО вызова verifyWebhook(),
 *   через TochkaWebhookVerifier, и передать сюда уже распарсенный payload.
 */
@Injectable()
export class TochkaProvider implements PaymentProviderInterface {
    private readonly logger = new Logger(TochkaProvider.name);

    private readonly redirectUrl: string;
    private readonly failRedirectUrl: string;
    private readonly ttlMinutes: number;

    constructor(
        private readonly client: TochkaClient,
        private readonly verifier: TochkaWebhookVerifier,
        private readonly configService: ConfigService,
    ) {
        this.redirectUrl =
            this.configService.get<string>('TOCHKA_REDIRECT_URL') ||
            'https://spichki-ai.net/topup/success';
        this.failRedirectUrl =
            this.configService.get<string>('TOCHKA_FAIL_REDIRECT_URL') ||
            'https://spichki-ai.net/topup/fail';
        this.ttlMinutes = Number(
            this.configService.get<string>('TOCHKA_PAYMENT_TTL_MIN') || '60',
        );
    }

    // ─── PaymentProviderInterface ──────────────────────────────────

    async createPayment(dto: CreatePaymentDto): Promise<PaymentResult> {
        if (dto.currency !== 'RUB') {
            return {
                success: false,
                paymentId: '',
                error: 'Tochka supports only RUB',
            };
        }

        const customerCode = this.client.getCustomerCode();
        const merchantId = this.client.getMerchantId(); // может быть пустым

        if (!customerCode) {
            return {
                success: false,
                paymentId: '',
                error: 'Tochka not configured (customerCode missing)',
            };
        }

        // paymentLinkId должен быть уникален. Используем userId+timestamp,
        // потому что в BillingService Transaction создаётся ПОСЛЕ createPayment.
        // Точка позволяет до 45 символов.
        const paymentLinkId = this.buildPaymentLinkId(dto.userId);

        const amountStr = this.formatAmount(dto.amount);

        try {
            const data: TochkaCreatePaymentRequest['Data'] = {
                customerCode,
                amount: this.formatAmount(dto.amount),
                purpose: this.truncate(dto.description, 210),
                paymentMode: ['card', 'sbp'],
                paymentLinkId,
                redirectUrl: dto.returnUrl || this.redirectUrl,
                failRedirectUrl: this.failRedirectUrl,
                ttl: this.ttlMinutes,
                preAuthorization: false,
                saveCard: false,
            };
            if (merchantId) data.merchantId = merchantId;

            const response = await this.client.createPayment({ Data: data });

            const operationId = response.Data.operationId;
            const paymentLink = response.Data.paymentLink;

            this.logger.log(
                `[Tochka] payment created: op=${operationId} link=${paymentLink}`,
            );

            return {
                success: true,
                paymentId: operationId,
                paymentUrl: paymentLink,
            };
        } catch (err: any) {
            const message =
                err?.response?.data?.errors?.[0]?.message ||
                err?.message ||
                'Unknown error';
            this.logger.error(`[Tochka] createPayment failed: ${message}`);
            return { success: false, paymentId: '', error: message };
        }
    }

    /**
     * Верифицирует вебхук Точки.
     *
     * ВАЖНО: в `body` сюда должен прийти результат `TochkaWebhookVerifier.verify()`,
     * т.е. УЖЕ распарсенный и проверенный payload. Это потому что
     * Точка присылает text/plain JWT, и проверка делается на уровне контроллера.
     */
    async verifyWebhook(body: any, _headers: any): Promise<WebhookResult> {
        try {
            const payload = body as TochkaAcquiringWebhookPayload;

            if (!payload || !payload.operationId) {
                return {
                    success: false,
                    paymentId: '',
                    status: 'failed',
                    metadata: { reason: 'no_operation_id' },
                };
            }

            if (payload.webhookType !== 'acquiringInternetPayment') {
                // Не наш тип события — игнорируем без ошибки
                return {
                    success: false,
                    paymentId: payload.operationId,
                    status: 'pending',
                    metadata: { reason: 'ignored_event', type: payload.webhookType },
                };
            }

            return {
                success: true,
                paymentId: payload.operationId,
                status: this.mapStatus(payload.status),
                amount: payload.amount ? parseFloat(payload.amount) : undefined,
                metadata: {
                    paymentMode: payload.paymentMode,
                    paidAt: payload.paidAt,
                    paymentLinkId: payload.paymentLinkId,
                    tochkaStatus: payload.status,
                },
            };
        } catch (err: any) {
            this.logger.error(`[Tochka] verifyWebhook error: ${err.message}`);
            return { success: false, paymentId: '', status: 'failed' };
        }
    }

    async getPaymentStatus(paymentId: string): Promise<WebhookResult> {
        try {
            const response = await this.client.getPayment(paymentId);
            const op = response.Data.Operation?.[0];

            if (!op) {
                return { success: false, paymentId, status: 'failed' };
            }

            return {
                success: true,
                paymentId: op.operationId,
                status: this.mapStatus(op.status),
                amount: op.amount ? parseFloat(op.amount) : undefined,
                metadata: {
                    paymentType: op.paymentType,
                    paidAt: op.paidAt,
                    tochkaStatus: op.status,
                },
            };
        } catch (err: any) {
            this.logger.error(`[Tochka] getPaymentStatus failed: ${err.message}`);
            return { success: false, paymentId, status: 'failed' };
        }
    }

    // ─── Доступ к verifier для контроллера ─────────────────────────

    getVerifier(): TochkaWebhookVerifier {
        return this.verifier;
    }

    // ─── Helpers ───────────────────────────────────────────────────

    private mapStatus(
        status: TochkaPaymentStatus,
    ): 'completed' | 'failed' | 'pending' {
        switch (status) {
            case 'APPROVED':
                return 'completed';

            case 'EXPIRED':
                return 'failed';

            case 'REFUNDED':
            case 'REFUNDED_PARTIALLY':
            case 'ON-REFUND':
                // Рефанд = деньги ушли назад, для нашего флоу пополнения
                // это означает "не удалось зачислить" → failed.
                // Сам рефанд обрабатывается отдельно (отдельная задача).
                return 'failed';

            case 'CREATED':
            case 'AUTHORIZED':
            case 'WAIT_FULL_PAYMENT':
                return 'pending';

            default:
                this.logger.warn(`[Tochka] unknown status: ${status}`);
                return 'pending';
        }
    }

    /**
     * Точка требует amount строкой с РОВНО двумя знаками после точки.
     * Если передать число — получим ошибку валидации.
     */
    private formatAmount(amount: number): number {
        // Округляем до 2 знаков, возвращаем number
        return Math.round(amount * 100) / 100;
    }

    /**
     * Уникальный paymentLinkId до 45 символов.
     * Формат: tx_<userId8>_<timestamp36>_<rand>
     * Пример: tx_507f1f77_lq8w3a1_x9k2 — ~32 символа
     */
    private buildPaymentLinkId(userId: string): string {
        const userPart = userId.slice(-8);
        const ts = Date.now().toString(36);
        const rand = Math.random().toString(36).slice(2, 6);
        return `tx_${userPart}_${ts}_${rand}`;
    }

    private truncate(str: string, max: number): string {
        if (!str) return '';
        return str.length <= max ? str : str.slice(0, max - 1) + '…';
    }
}