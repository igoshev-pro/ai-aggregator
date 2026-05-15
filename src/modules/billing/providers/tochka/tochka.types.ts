/**
 * Типы для интеграции с Точка Банк (Acquiring API v1.0)
 * Документация: https://enter.tochka.com/doc/v2/redoc
 */

// ─── Общие ───────────────────────────────────────────────────────

export type TochkaCurrency = 'RUB';

export type TochkaPaymentMode = 'card' | 'sbp' | 'tinkoff' | 'dolyame';

export type TochkaPaymentStatus =
  | 'CREATED'
  | 'AUTHORIZED'
  | 'WAIT_FULL_PAYMENT'
  | 'APPROVED'
  | 'ON-REFUND'
  | 'REFUNDED'
  | 'REFUNDED_PARTIALLY'
  | 'EXPIRED';

export type TochkaPaymentType = 'card' | 'sbp' | 'tinkoff' | 'dolyame';

export type TochkaTaxSystemCode =
  | 'osn'
  | 'usn_income'
  | 'usn_income_outcome'
  | 'esn'
  | 'patent'
  | 'envd';

// ─── Запросы ─────────────────────────────────────────────────────

export interface TochkaCreatePaymentRequest {
  Data: {
    customerCode: string;
    merchantId?: string;     // ✅ необязательный (1 торговая точка)
    amount: number;          // ✅ number, как требует API
    purpose: string;
    paymentMode: TochkaPaymentMode[];
    paymentLinkId?: string;  // тоже сделать необязательным — Точка сама генерирует
    redirectUrl?: string;
    failRedirectUrl?: string;
    ttl?: number;
    preAuthorization?: boolean;
    saveCard?: boolean;
  };
}

// ─── Ответы ──────────────────────────────────────────────────────

export interface TochkaCreatePaymentResponse {
  Data: {
    operationId: string;
    paymentLink: string;
    status: TochkaPaymentStatus;
    amount: string;
    paymentLinkId?: string;
  };
  Links: { self: string };
  Meta: { totalPages: number };
}

export interface TochkaGetPaymentResponse {
  Data: {
    Operation: Array<{
      operationId: string;
      status: TochkaPaymentStatus;
      amount: string;
      paymentLinkId?: string;
      paymentType?: TochkaPaymentType;
      paymentId?: string;
      transactionId?: string;
      createdAt: string;
      paidAt?: string;
      customerCode: string;
      merchantId?: string;
      purpose?: string;
    }>;
  };
  Links: { self: string };
  Meta: { totalPages: number };
}

export interface TochkaCustomersResponse {
  Data: {
    Customer: Array<{
      customerCode: string;
      customerType: 'Business' | 'Personal';
      fullName?: string;
    }>;
  };
}

export interface TochkaRetailersResponse {
  Data: {
    Retailer: Array<{
      status: string;
      isActive: boolean;
      mcc: string;
      rate: number;
      name: string;
      merchantId?: string;
      terminalId?: string;
      paymentModes: TochkaPaymentMode[];
      cashbox?: string;
    }>;
  };
}

export interface TochkaWebhookRegisterRequest {
  webhooksList: TochkaWebhookEvent[];
  url: string;
}

export interface TochkaWebhookGetResponse {
  Data: {
    webhooksList: TochkaWebhookEvent[];
    url: string;
  };
}

// ─── Вебхуки ─────────────────────────────────────────────────────

export type TochkaWebhookEvent =
  | 'acquiringInternetPayment'
  | 'incomingPayment'
  | 'outgoingPayment'
  | 'incomingSbpPayment'
  | 'incomingSbpB2BPayment';

/**
 * Расшифрованный payload JWT-вебхука acquiringInternetPayment.
 * Поля могут варьироваться, набор ниже — то, что реально приходит.
 */
export interface TochkaAcquiringWebhookPayload {
  webhookType: 'acquiringInternetPayment';
  operationId: string;
  paymentLinkId?: string;
  status: TochkaPaymentStatus;
  amount: string;
  customerCode: string;
  merchantId?: string;
  paymentMode?: TochkaPaymentMode;
  paidAt?: string;
}

// ─── Ошибки API ──────────────────────────────────────────────────

export interface TochkaErrorResponse {
  errors?: Array<{
    code?: string;
    message: string;
    detail?: string;
  }>;
  Meta?: { totalPages: number };
}