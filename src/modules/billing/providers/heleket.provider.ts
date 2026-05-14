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

/**
 * Heleket — крипто-платёжный провайдер (USDT/BTC/TRX/...).
 * Документация: https://heleket.com (раздел Платежи)
 *
 * Особенности:
 *  - Запросы подписываются: sign = md5(base64(JSON.stringify(body)) + apiKey)
 *  - Webhook содержит поле sign в теле — проверяется тем же алгоритмом
 *    БЕЗ поля sign в payload. Внимание: возможна разница в экранировании
 *    слэшей (PHP экранирует `/` → `\/`, JS — нет). Поэтому при проверке
 *    мы пробуем обе версии хэша.
 *  - В webhook'е status: paid|paid_over → completed, fail|cancel|wrong_amount|system_fail → failed
 *  - Webhook IP (whitelist): 31.133.220.8
 */
@Injectable()
export class HeleketProvider implements PaymentProviderInterface {
  private readonly logger = new Logger(HeleketProvider.name);
  private readonly merchantId: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly webhookUrl: string;
  private readonly publicReturnUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.merchantId = this.configService.get<string>('HELEKET_MERCHANT_ID') || '';
    this.apiKey = this.configService.get<string>('HELEKET_API_KEY') || '';
    this.baseUrl =
      this.configService.get<string>('HELEKET_BASE_URL') ||
      'https://api.heleket.com';

    // Базовые URL для callback/return — берём из общих ENV
    const apiPublicUrl =
      this.configService.get<string>('API_PUBLIC_URL') ||
      'https://spichki-ai.net';
    this.webhookUrl =
      this.configService.get<string>('HELEKET_WEBHOOK_URL') ||
      `${apiPublicUrl}/api/v1/billing/webhook/heleket`;
    this.publicReturnUrl =
      this.configService.get<string>('HELEKET_RETURN_URL') ||
      `${apiPublicUrl}/topup/success`;
  }

  // ───────────────────────────────────────────────────────────────
  // Создание платежа
  // ───────────────────────────────────────────────────────────────
  async createPayment(dto: CreatePaymentDto): Promise<PaymentResult> {
    try {
      // Heleket принимает amount как строку с точкой ("10.28")
      const amount = dto.amount.toFixed(2);

      // Heleket поддерживает USD/USDT/BTC/RUB и т.д.
      // Для RUB провайдер сконвертирует в крипту автоматически.
      const currency = dto.currency; // 'RUB' | 'USD'

      const orderId = `order_${Date.now()}_${dto.userId}`;

      const body: Record<string, any> = {
        amount,
        currency,
        order_id: orderId,
        url_callback: this.webhookUrl,
        url_return: dto.returnUrl || this.publicReturnUrl,
        url_success: dto.returnUrl || this.publicReturnUrl,
        lifetime: 3600, // 1 час
        // additional_data ОБЯЗАТЕЛЬНО строка (не объект)!
        additional_data: JSON.stringify({
          userId: dto.userId,
          tokens: dto.tokens,
          description: dto.description,
        }),
      };

      const sign = this.createSign(body);

      const response = await axios.post(
        `${this.baseUrl}/v1/payment`,
        body,
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
        paymentId: data.result.uuid, // uuid счёта
        paymentUrl: data.result.url, // https://pay.heleket.com/pay/...
      };
    } catch (error: any) {
      const respData = error?.response?.data;
      const msg =
        respData?.message ||
        (respData?.errors && JSON.stringify(respData.errors)) ||
        error.message;
      this.logger.error(`Heleket create payment exception: ${msg}`);
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

      // Маппинг статусов Heleket → внутренние
      const heleketStatus: string = body.status || body.payment_status || '';
      let status: 'completed' | 'failed' | 'pending' = 'pending';

      if (['paid', 'paid_over'].includes(heleketStatus)) {
        status = 'completed';
      } else if (
        ['fail', 'cancel', 'wrong_amount', 'system_fail'].includes(heleketStatus)
      ) {
        status = 'failed';
      }

      // additional_data приходит строкой
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
  // Запрос статуса платежа (fallback / админ-проверка)
  // ───────────────────────────────────────────────────────────────
  async getPaymentStatus(paymentId: string): Promise<WebhookResult> {
    try {
      const body = { uuid: paymentId };
      const sign = this.createSign(body);

      const response = await axios.post(
        `${this.baseUrl}/v1/payment/info`,
        body,
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
  // Внутреннее: подпись
  // ───────────────────────────────────────────────────────────────

  /**
   * Генерация подписи исходящего запроса.
   * sign = md5( base64( JSON.stringify(body) ) + apiKey )
   */
  private createSign(data: Record<string, any>): string {
    const json = JSON.stringify(data);
    return this.md5(Buffer.from(json).toString('base64') + this.apiKey);
  }

  /**
   * Проверка подписи входящего webhook'а.
   * Пробуем 2 варианта сериализации — с экранированием слэшей (PHP-style)
   * и без (JS-style). Подпись Heleket генерирует на PHP, поэтому слэши
   * в txid и других полях могут быть как `/` так и `\/`.
   */
  private verifySign(data: Record<string, any>, receivedSign: string): boolean {
    const jsonPlain = JSON.stringify(data);
    const jsonEscaped = jsonPlain.replace(/\//g, '\\/');

    const hashPlain = this.md5(
      Buffer.from(jsonPlain).toString('base64') + this.apiKey,
    );
    const hashEscaped = this.md5(
      Buffer.from(jsonEscaped).toString('base64') + this.apiKey,
    );

    return (
      this.safeEqual(hashPlain, receivedSign) ||
      this.safeEqual(hashEscaped, receivedSign)
    );
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