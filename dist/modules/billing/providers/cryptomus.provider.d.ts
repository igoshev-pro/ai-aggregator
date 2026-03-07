import { ConfigService } from '@nestjs/config';
import { PaymentProviderInterface, CreatePaymentDto, PaymentResult, WebhookResult } from './payment-provider.interface';
export declare class CryptomusProvider implements PaymentProviderInterface {
    private configService;
    private readonly logger;
    private merchantId;
    private apiKey;
    constructor(configService: ConfigService);
    createPayment(dto: CreatePaymentDto): Promise<PaymentResult>;
    verifyWebhook(body: any, _headers: any): Promise<WebhookResult>;
    getPaymentStatus(paymentId: string): Promise<WebhookResult>;
    private createSign;
}
