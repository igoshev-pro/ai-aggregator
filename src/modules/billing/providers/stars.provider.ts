import { telegramAxiosConfig } from '../../../common/net/outbound-proxy';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  PaymentProviderInterface,
  CreatePaymentDto,
  PaymentResult,
  WebhookResult,
} from './payment-provider.interface';

/** Сколько рублей стоит 1 ⭐ (переопределяется env STARS_RUB_PER_STAR) */
export const DEFAULT_STARS_RUB_PER_STAR = 1.5;

/** Префикс payload инвойса: `tx:<Transaction._id>` (лимит Telegram — 128 байт) */
const PAYLOAD_PREFIX = 'tx:';

/**
 * Telegram Stars (XTR).
 *
 * Поток:
 *  1. BillingService создаёт Transaction(PENDING, externalPaymentId = `stars_<txId>`)
 *     и вызывает createPayment({ orderId: txId, amountRub }).
 *  2. createInvoiceLink c payload = `tx:<txId>` и ценой в ⭐ = ceil(RUB / курс).
 *     Ссылку создаёт ТОТ ЖЕ бот (TELEGRAM_BOT_TOKEN), что принимает апдейты
 *     в TelegramBotUpdate — иначе pre_checkout_query уйдёт другому боту.
 *  3. Бот получает pre_checkout_query → BillingService.handleStarsPreCheckout.
 *  4. Бот получает message.successful_payment → BillingService.handleStarsSuccessfulPayment
 *     → handlePaymentWebhook('stars', …) (общий путь начисления).
 *
 * HTTP-вебхука для Stars нет: verifyWebhook вызывается только из бота
 * с уже проверенным Telegram'ом successful_payment.
 */
@Injectable()
export class StarsProvider implements PaymentProviderInterface {
  private readonly logger = new Logger(StarsProvider.name);
  private botToken: string;
  private readonly rubPerStar: number;

  constructor(private configService: ConfigService) {
    this.botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN') || '';
    const rate = parseFloat(
      this.configService.get<string>('STARS_RUB_PER_STAR') || '',
    );
    this.rubPerStar =
      Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_STARS_RUB_PER_STAR;
  }

  getRubPerStar(): number {
    return this.rubPerStar;
  }

  /** Рубли → целое число звёзд (вверх, минимум 1) */
  rubToStars(amountRub: number): number {
    return Math.max(1, Math.ceil((Number(amountRub) || 0) / this.rubPerStar));
  }

  static buildExternalId(txId: string): string {
    return `stars_${txId}`;
  }

  static buildPayload(txId: string): string {
    return `${PAYLOAD_PREFIX}${txId}`;
  }

  /** Достаёт txId из invoice_payload (поддерживает и старый JSON-формат) */
  static parsePayload(payload: string | undefined | null): string | null {
    if (!payload) return null;
    if (payload.startsWith(PAYLOAD_PREFIX)) {
      const id = payload.slice(PAYLOAD_PREFIX.length).trim();
      return /^[a-f0-9]{24}$/i.test(id) ? id : null;
    }
    try {
      const parsed = JSON.parse(payload);
      const id = parsed?.txId || parsed?.t;
      return typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id) ? id : null;
    } catch {
      return null;
    }
  }

  async createPayment(dto: CreatePaymentDto): Promise<PaymentResult> {
    if (!dto.orderId) {
      return {
        success: false,
        paymentId: '',
        error: 'Stars: orderId (transaction id) is required',
      };
    }
    if (!this.botToken) {
      return { success: false, paymentId: '', error: 'Stars: TELEGRAM_BOT_TOKEN not set' };
    }

    const amountRub =
      dto.amountRub ?? (dto.currency === 'RUB' ? dto.amount : undefined);
    if (!amountRub || amountRub <= 0) {
      return { success: false, paymentId: '', error: 'Stars: amountRub is required' };
    }
    const stars = this.rubToStars(amountRub);

    try {
      const response = await axios.post(
        `https://api.telegram.org/bot${this.botToken}/createInvoiceLink`,
        {
          title: 'SPICHKI AI — Пополнение',
          description: (dto.description || `${dto.tokens} спичек для генерации в SPICHKI AI`).slice(0, 255),
          payload: StarsProvider.buildPayload(dto.orderId),
          currency: 'XTR',
          prices: [{ label: `${dto.tokens} спичек`, amount: stars }],
        },
        { ...telegramAxiosConfig(), timeout: 15_000 },
      );

      if (response.data?.ok) {
        this.logger.log(
          `[Stars] invoice created: tx=${dto.orderId} ${amountRub}₽ → ${stars}⭐ (rate ${this.rubPerStar}₽/⭐)`,
        );
        return {
          success: true,
          paymentId: StarsProvider.buildExternalId(dto.orderId),
          paymentUrl: response.data.result,
        };
      }

      return {
        success: false,
        paymentId: '',
        error: response.data?.description || 'createInvoiceLink failed',
      };
    } catch (error: any) {
      const msg = error?.response?.data?.description || error.message;
      this.logger.error(`[Stars] createInvoiceLink error: ${msg}`);
      return { success: false, paymentId: '', error: msg };
    }
  }

  /**
   * body = message.successful_payment от Telegram (вызывается только из бота).
   * paymentId = `stars_<txId>` — им же помечена транзакция при создании.
   */
  async verifyWebhook(body: any, _headers: any): Promise<WebhookResult> {
    const txId = StarsProvider.parsePayload(body?.invoice_payload);
    if (!txId || body?.currency !== 'XTR' || !body?.telegram_payment_charge_id) {
      return { success: false, paymentId: '', status: 'failed' };
    }
    return {
      success: true,
      paymentId: StarsProvider.buildExternalId(txId),
      status: 'completed',
      amount: body.total_amount,
      metadata: {
        telegramPaymentChargeId: body.telegram_payment_charge_id,
        providerPaymentChargeId: body.provider_payment_charge_id,
      },
    };
  }

  async getPaymentStatus(paymentId: string): Promise<WebhookResult> {
    // У Telegram нет API статуса инвойса — статус знает только наша БД
    return { success: true, paymentId, status: 'pending' };
  }
}
