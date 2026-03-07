// src/modules/billing/providers/stars.provider.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  PaymentProviderInterface,
  CreatePaymentDto,
  PaymentResult,
  WebhookResult,
} from './payment-provider.interface';

@Injectable()
export class StarsProvider implements PaymentProviderInterface {
  private readonly logger = new Logger(StarsProvider.name);
  private botToken: string;

  constructor(private configService: ConfigService) {
    this.botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN') || '';
  }

  async createPayment(dto: CreatePaymentDto): Promise<PaymentResult> {
    try {
      const response = await axios.post(
        `https://api.telegram.org/bot${this.botToken}/createInvoiceLink`,
        {
          title: 'Пополнение баланса',
          description: `${dto.tokens} токенов для AI генерации`,
          payload: JSON.stringify({ userId: dto.userId, tokens: dto.tokens }),
          currency: 'XTR',
          prices: [{ label: `${dto.tokens} токенов`, amount: dto.amount }],
        },
      );

      if (response.data.ok) {
        return { success: true, paymentId: `stars_${Date.now()}`, paymentUrl: response.data.result };
      }

      return { success: false, paymentId: '', error: response.data.description || 'Failed' };
    } catch (error: any) {
      this.logger.error(`Stars create payment error: ${error.message}`);
      return { success: false, paymentId: '', error: error.message };
    }
  }

  async verifyWebhook(body: any, _headers: any): Promise<WebhookResult> {
    try {
      const payload = JSON.parse(body.invoice_payload || '{}');
      return {
        success: true,
        paymentId: body.telegram_payment_charge_id || '',
        status: 'completed',
        amount: body.total_amount,
        metadata: payload,
      };
    } catch {
      return { success: false, paymentId: '', status: 'failed' };
    }
  }

  async getPaymentStatus(paymentId: string): Promise<WebhookResult> {
    return { success: true, paymentId, status: 'completed' };
  }
}