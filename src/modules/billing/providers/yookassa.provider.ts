// src/modules/billing/providers/yookassa.provider.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import {
  PaymentProviderInterface,
  CreatePaymentDto,
  PaymentResult,
  WebhookResult,
} from './payment-provider.interface';

@Injectable()
export class YookassaProvider implements PaymentProviderInterface {
  private readonly logger = new Logger(YookassaProvider.name);
  private client: AxiosInstance;
  private shopId: string;

  constructor(private configService: ConfigService) {
    this.shopId = this.configService.get<string>('YOOKASSA_SHOP_ID') || '';
    const secretKey = this.configService.get<string>('YOOKASSA_SECRET_KEY') || '';

    this.client = axios.create({
      baseURL: 'https://api.yookassa.ru/v3',
      auth: { username: this.shopId, password: secretKey },
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async createPayment(dto: CreatePaymentDto): Promise<PaymentResult> {
    try {
      const idempotenceKey = uuidv4();

      const response = await this.client.post(
        '/payments',
        {
          amount: { value: dto.amount.toFixed(2), currency: 'RUB' },
          confirmation: {
            type: 'redirect',
            return_url: dto.returnUrl || 'https://t.me/your_bot',
          },
          capture: true,
          description: dto.description,
          metadata: { userId: dto.userId, tokens: dto.tokens },
        },
        { headers: { 'Idempotence-Key': idempotenceKey } },
      );

      return {
        success: true,
        paymentId: response.data.id,
        paymentUrl: response.data.confirmation?.confirmation_url,
      };
    } catch (error: any) {
      this.logger.error(`YooKassa create payment error: ${error.message}`);
      return { success: false, paymentId: '', error: error.message };
    }
  }

  async verifyWebhook(body: any, _headers: any): Promise<WebhookResult> {
    try {
      const event = body;
      const payment = event.object;

      let status: 'completed' | 'failed' | 'pending' = 'pending';
      if (event.event === 'payment.succeeded') status = 'completed';
      else if (event.event === 'payment.canceled') status = 'failed';

      return {
        success: true,
        paymentId: payment.id,
        status,
        amount: parseFloat(payment.amount?.value || '0'),
        metadata: payment.metadata,
      };
    } catch (error: any) {
      this.logger.error(`YooKassa webhook error: ${error.message}`);
      return { success: false, paymentId: '', status: 'failed' };
    }
  }

  async getPaymentStatus(paymentId: string): Promise<WebhookResult> {
    try {
      const response = await this.client.get(`/payments/${paymentId}`);
      const payment = response.data;

      let status: 'completed' | 'failed' | 'pending' = 'pending';
      if (payment.status === 'succeeded') status = 'completed';
      else if (payment.status === 'canceled') status = 'failed';

      return {
        success: true,
        paymentId: payment.id,
        status,
        amount: parseFloat(payment.amount?.value || '0'),
        metadata: payment.metadata,
      };
    } catch {
      return { success: false, paymentId, status: 'failed' };
    }
  }
}