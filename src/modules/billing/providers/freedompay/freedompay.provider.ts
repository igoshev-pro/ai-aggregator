// src/modules/billing/providers/freedompay/freedompay.provider.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import FormData from 'form-data';
import {
  PaymentProviderInterface,
  CreatePaymentDto,
  PaymentResult,
  WebhookResult,
} from '../payment-provider.interface';
import {
  buildResponseXml,
  generateSalt,
  parseXmlResponse,
  sign,
  verifySignature,
} from './freedompay.utils';
import { FreedomPayInitResponse, FreedomPayWebhookBody } from './freedompay.types';

@Injectable()
export class FreedomPayProvider implements PaymentProviderInterface {
  private readonly logger = new Logger(FreedomPayProvider.name);

  readonly name = 'freedompay';

  private readonly merchantId: number;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly testingMode: 0 | 1;
  private readonly currency: string;
  private readonly rubToKzt: number;
  private readonly usdToKzt: number;
  private readonly publicUrl: string;
  private readonly botUsername: string;

  constructor(private readonly config: ConfigService) {
    this.merchantId = this.config.get<number>('freedompay.merchantId')!;
    this.secretKey = this.config.get<string>('freedompay.secretKey')!;
    this.baseUrl = this.config.get<string>('freedompay.baseUrl')!;
    this.testingMode = this.config.get<0 | 1>('freedompay.testingMode')!;
    this.currency = this.config.get<string>('freedompay.currency')!;
    this.rubToKzt = this.config.get<number>('freedompay.rubToKzt')!;
    this.usdToKzt = this.config.get<number>('freedompay.usdToKzt')!;
    this.publicUrl = this.config.get<string>('API_PUBLIC_URL')!;
    this.botUsername = this.config.get<string>('TG_BOT_USERNAME')!;

    if (!this.merchantId || !this.secretKey) {
      this.logger.warn('⚠️ FreedomPay не сконфигурирован');
    }
  }

  /** Конверсия в валюту провайдера (KZT по умолчанию) */
  private convertAmount(amount: number, from: 'RUB' | 'USD'): number {
    if (this.currency === from) return amount;
    if (this.currency === 'KZT') {
      const rate = from === 'RUB' ? this.rubToKzt : this.usdToKzt;
      return Math.round(amount * rate * 100) / 100;
    }
    return amount;
  }

  /** ============ createPayment ============ */
  async createPayment(dto: CreatePaymentDto): Promise<PaymentResult> {
    const script = 'init_payment';
    const salt = generateSalt();

    // orderId = uuid (приходит из BillingService — либо id транзакции)
    // У тебя в dto его нет, но returnUrl есть. Используем как orderId сам uuid из вне.
    // Если у тебя orderId не пробрасывается — генерим тут:
    const orderId = (dto as any).orderId ?? generateSalt(24);

    const amount = this.convertAmount(dto.amount, dto.currency);

    const body: Record<string, string | number> = {
      pg_merchant_id: this.merchantId,
      pg_order_id: orderId,
      pg_amount: amount,
      pg_currency: this.currency,
      pg_description: dto.description,
      pg_user_id: String(dto.userId),
      pg_auto_clearing: 1,
      pg_testing_mode: this.testingMode,
      pg_request_method: 'POST',
      pg_language: 'ru',
      pg_lifetime: 1800,
      pg_result_url: `${this.publicUrl}/billing/webhook/freedompay`,
      pg_success_url:
        dto.returnUrl || `https://t.me/${this.botUsername}/app?startapp=pay_success`,
      pg_failure_url: `https://t.me/${this.botUsername}/app?startapp=pay_failure`,
      pg_success_url_method: 'GET',
      pg_failure_url_method: 'GET',
      pg_salt: salt,
      // ВАЖНО: пробрасываем в callback всё, что нужно для начисления
      pg_param1: String(dto.tokens),
      pg_param2: String(dto.amount),      // оригинальная сумма
      pg_param3: dto.currency,            // оригинальная валюта
    };

    const pg_sig = sign(script, body, this.secretKey);
    const payload = { ...body, pg_sig };

    this.logger.debug(`[FP] init: order=${orderId} amount=${amount} ${this.currency}`);

    try {
      const { data } = await axios.post(`${this.baseUrl}/init_payment`, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15_000,
        responseType: 'text',
        transformResponse: [(d) => d],
      });

      const resp = await parseXmlResponse<FreedomPayInitResponse>(data);

      if (resp.pg_status !== 'ok' || !resp.pg_redirect_url || !resp.pg_payment_id) {
        this.logger.error(`[FP] init failed: ${JSON.stringify(resp)}`);
        return {
          success: false,
          paymentId: orderId,
          error: resp.pg_error_description || 'FreedomPay init failed',
        };
      }

      return {
        success: true,
        paymentId: resp.pg_payment_id, // pg_payment_id — внешний ID
        paymentUrl: resp.pg_redirect_url,
      };
    } catch (e: any) {
      this.logger.error(`[FP] init error: ${e.message}`);
      return {
        success: false,
        paymentId: orderId,
        error: 'Provider unreachable',
      };
    }
  }

  /** ============ verifyWebhook ============
   * body = распарсенный multipart/form-data
   * headers — не используем, FP подписывает в теле
   */
  async verifyWebhook(body: any, _headers: any): Promise<WebhookResult> {
    const scriptName = 'freedompay'; // последний сегмент: /billing/webhook/freedompay
    const wh = body as FreedomPayWebhookBody;

    const valid = verifySignature(scriptName, wh as any, this.secretKey);
    if (!valid) {
      this.logger.warn(`[FP] invalid signature: order=${wh?.pg_order_id}`);
      return {
        success: false,
        paymentId: String(wh?.pg_payment_id || ''),
        status: 'failed',
        metadata: { reason: 'invalid_signature' },
      };
    }

    const statusMap = {
      '1': 'completed' as const,
      '0': 'failed' as const,
      '2': 'pending' as const,
    };

    const tokens = parseInt(wh.pg_param1 || '0', 10);
    const originalAmount = parseFloat(wh.pg_param2 || '0');
    const originalCurrency = wh.pg_param3;

    return {
      success: wh.pg_result === '1',
      paymentId: String(wh.pg_payment_id),
      status: statusMap[wh.pg_result] ?? 'failed',
      amount: parseFloat(wh.pg_amount),
      metadata: {
        orderId: wh.pg_order_id,
        tokens,
        originalAmount,
        originalCurrency,
        currency: wh.pg_currency,
        paymentMethod: wh.pg_payment_method,
        cardPan: wh.pg_card_pan,
        cardBrand: wh.pg_card_brand,
        testingMode: wh.pg_testing_mode === '1',
      },
    };
  }

  /** ============ getPaymentStatus ============ */
  async getPaymentStatus(paymentId: string): Promise<WebhookResult> {
    const script = 'get_status3.php';
    const salt = generateSalt();
    const body = {
      pg_merchant_id: this.merchantId,
      pg_payment_id: paymentId,
      pg_salt: salt,
    };
    const pg_sig = sign(script, body, this.secretKey);

    const form = new FormData();
    Object.entries({ ...body, pg_sig }).forEach(([k, v]) => form.append(k, String(v)));

    try {
      const { data } = await axios.post(`${this.baseUrl}/get_status3.php`, form, {
        headers: form.getHeaders(),
        timeout: 15_000,
        responseType: 'text',
        transformResponse: [(d) => d],
      });

      const resp: any = await parseXmlResponse(data);

      const fpStatus = resp.pg_payment_status;
      let status: 'completed' | 'failed' | 'pending' = 'pending';
      if (fpStatus === 'success' || fpStatus === 'ok') status = 'completed';
      else if (fpStatus === 'error' || fpStatus === 'failed') status = 'failed';

      return {
        success: status === 'completed',
        paymentId,
        status,
        amount: resp.pg_amount ? parseFloat(resp.pg_amount) : undefined,
        metadata: {
          currency: resp.pg_currency,
          captured: resp.pg_captured === '1',
          failureCode: resp.pg_failure_code,
          failureDescription: resp.pg_failure_description,
          reference: resp.pg_reference,
        },
      };
    } catch (e: any) {
      this.logger.error(`[FP] status error: ${e.message}`);
      return { success: false, paymentId, status: 'failed' };
    }
  }

  /** ============ Спец-методы (не из интерфейса) ============ */

  /** Сформировать XML-ответ на webhook (FP ждёт XML, не JSON) */
  buildWebhookResponseXml(
    status: 'ok' | 'rejected' | 'error',
    description: string,
  ): string {
    return buildResponseXml(
      'freedompay',
      {
        pg_status: status,
        pg_description: description,
        pg_salt: generateSalt(),
      },
      this.secretKey,
    );
  }

  /** Возврат */
  async refund(externalPaymentId: string, amount?: number) {
    const script = 'revoke';
    const salt = generateSalt();
    const body: Record<string, string | number> = {
      pg_merchant_id: this.merchantId,
      pg_payment_id: externalPaymentId,
      pg_salt: salt,
    };
    if (amount) body.pg_refund_amount = amount;
    const pg_sig = sign(script, body, this.secretKey);

    const form = new FormData();
    Object.entries({ ...body, pg_sig }).forEach(([k, v]) => form.append(k, String(v)));

    const { data } = await axios.post(`${this.baseUrl}/revoke`, form, {
      headers: form.getHeaders(),
      timeout: 15_000,
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    return parseXmlResponse(data);
  }
}