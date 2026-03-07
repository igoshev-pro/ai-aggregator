import { ConfigService } from '@nestjs/config';
import { PaymentProviderInterface, CreatePaymentDto, PaymentResult, WebhookResult } from './payment-provider.interface';
export declare class YookassaProvider implements PaymentProviderInterface {
    private configService;
    private readonly logger;
    private client;
    private shopId;
    constructor(configService: ConfigService);
    createPayment(dto: CreatePaymentDto): Promise<PaymentResult>;
    verifyWebhook(body: any, _headers: any): Promise<WebhookResult>;
    getPaymentStatus(paymentId: string): Promise<WebhookResult>;
}
