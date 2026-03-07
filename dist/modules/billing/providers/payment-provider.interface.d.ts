export interface CreatePaymentDto {
    amount: number;
    tokens: number;
    userId: string;
    description: string;
    returnUrl?: string;
}
export interface PaymentResult {
    success: boolean;
    paymentId: string;
    paymentUrl?: string;
    error?: string;
}
export interface WebhookResult {
    success: boolean;
    paymentId: string;
    status: 'completed' | 'failed' | 'pending';
    amount?: number;
    metadata?: Record<string, any>;
}
export interface PaymentProviderInterface {
    createPayment(dto: CreatePaymentDto): Promise<PaymentResult>;
    verifyWebhook(body: any, headers: any): Promise<WebhookResult>;
    getPaymentStatus(paymentId: string): Promise<WebhookResult>;
}
