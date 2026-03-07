// src/modules/billing/providers/cryptomus.provider.ts
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
export class CryptomusProvider implements PaymentProviderInterface {
  private readonly logger = new Logger(CryptomusProvider.name);
  private merchantId: string;
  private apiKey: string;

  constructor(private configService: ConfigService) {
    this.merchantId = this.configService.get<string>('CRYPTOMUS_MERCHANT_ID') || '';
    this.apiKey = this.configService.get<string>('CRYPTOMUS_API_KEY') || '';
  }

  async createPayment(dto: CreatePaymentDto): Promise<PaymentResult> {
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

      const response = await axios.post('https://api.cryptomus.com/v1/payment', body, {
        headers: { merchant: this.merchantId, sign, 'Content-Type': 'application/json' },
      });

      return {
        success: true,
        paymentId: response.data.result.uuid,
        paymentUrl: response.data.result.url,
      };
    } catch (error: any) {
      this.logger.error(`Cryptomus create payment error: ${error.message}`);
      return { success: false, paymentId: '', error: error.message };
    }
  }

  async verifyWebhook(body: any, _headers: any): Promise<WebhookResult> {
    try {
      const receivedSign = body.sign;
      const bodyWithoutSign = { ...body };
      delete bodyWithoutSign.sign;

      const expectedSign = this.createSign(bodyWithoutSign);
      if (receivedSign !== expectedSign) {
        return { success: false, paymentId: '', status: 'failed' };
      }

      let status: 'completed' | 'failed' | 'pending' = 'pending';
      if (['paid', 'paid_over'].includes(body.status)) status = 'completed';
      else if (['cancel', 'fail', 'system_fail', 'wrong_amount'].includes(body.status)) status = 'failed';

      const additionalData = body.additional_data ? JSON.parse(body.additional_data) : {};

      return {
        success: true,
        paymentId: body.uuid || body.order_id,
        status,
        amount: parseFloat(body.amount || '0'),
        metadata: additionalData,
      };
    } catch (error: any) {
      this.logger.error(`Cryptomus webhook error: ${error.message}`);
      return { success: false, paymentId: '', status: 'failed' };
    }
  }

  async getPaymentStatus(paymentId: string): Promise<WebhookResult> {
    try {
      const body = { uuid: paymentId };
      const sign = this.createSign(body);

      const response = await axios.post('https://api.cryptomus.com/v1/payment/info', body, {
        headers: { merchant: this.merchantId, sign, 'Content-Type': 'application/json' },
      });

      const payment = response.data.result;
      let status: 'completed' | 'failed' | 'pending' = 'pending';
      if (['paid', 'paid_over'].includes(payment.payment_status)) status = 'completed';
      else if (['cancel', 'fail'].includes(payment.payment_status)) status = 'failed';

      return { success: true, paymentId: payment.uuid, status, amount: parseFloat(payment.amount || '0') };
    } catch {
      return { success: false, paymentId, status: 'failed' };
    }
  }

  private createSign(data: any): string {
    const jsonBase64 = Buffer.from(JSON.stringify(data)).toString('base64');
    return crypto.createHash('md5').update(jsonBase64 + this.apiKey).digest('hex');
  }
}