import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import {
  TochkaCreatePaymentRequest,
  TochkaCreatePaymentResponse,
  TochkaCustomersResponse,
  TochkaErrorResponse,
  TochkaGetPaymentResponse,
  TochkaRetailersResponse,
  TochkaWebhookGetResponse,
  TochkaWebhookRegisterRequest,
} from './tochka.types';

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 300;
const RETRYABLE_STATUS = [502, 503, 504];
const RETRYABLE_CODES = ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Низкоуровневый HTTP-клиент Точки.
 * Отвечает только за HTTP: ретраи, логирование, маскирование секретов.
 * Бизнес-логика — в TochkaProvider.
 */
@Injectable()
export class TochkaClient {
  private readonly logger = new Logger(TochkaClient.name);
  private readonly http: AxiosInstance;

  private readonly jwt: string;
  private readonly customerCode: string;
  private readonly merchantId: string;
  private readonly clientId: string;

  constructor(private readonly configService: ConfigService) {
    this.jwt = this.configService.get<string>('TOCHKA_JWT') || '';
    this.customerCode =
      this.configService.get<string>('TOCHKA_CUSTOMER_CODE') || '';
    this.merchantId =
      this.configService.get<string>('TOCHKA_MERCHANT_ID') || '';
    this.clientId = this.configService.get<string>('TOCHKA_CLIENT_ID') || '';

    const baseURL =
      this.configService.get<string>('TOCHKA_API_URL') ||
      'https://enter.tochka.com/uapi';

    this.http = axios.create({
      baseURL,
      timeout: 20_000,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.jwt}`,
      },
    });

    if (!this.jwt) {
      this.logger.error(
        '⚠️ TOCHKA_JWT is empty — provider will not work',
      );
    }
  }

  // ─── Геттеры конфигов ──────────────────────────────────────────

  getCustomerCode(): string {
    return this.customerCode;
  }

  getMerchantId(): string {
    return this.merchantId;
  }

  getClientId(): string {
    return this.clientId;
  }

  // ─── Acquiring: платежи ────────────────────────────────────────

  async createPayment(
    payload: TochkaCreatePaymentRequest,
  ): Promise<TochkaCreatePaymentResponse> {
    return this.request<TochkaCreatePaymentResponse>({
      method: 'POST',
      url: '/acquiring/v1.0/payments',
      data: payload,
    });
  }

  async getPayment(operationId: string): Promise<TochkaGetPaymentResponse> {
    return this.request<TochkaGetPaymentResponse>({
      method: 'GET',
      url: `/acquiring/v1.0/payments/${encodeURIComponent(operationId)}`,
    });
  }

  // ─── Open Banking: клиенты ─────────────────────────────────────

  async getCustomers(): Promise<TochkaCustomersResponse> {
    return this.request<TochkaCustomersResponse>({
      method: 'GET',
      url: '/open-banking/v1.0/customers',
    });
  }

  // ─── Acquiring: ретейлеры ──────────────────────────────────────

  async getRetailers(customerCode: string): Promise<TochkaRetailersResponse> {
    return this.request<TochkaRetailersResponse>({
      method: 'GET',
      url: '/acquiring/v1.0/retailers',
      params: { customerCode },
    });
  }

  // ─── Webhooks ──────────────────────────────────────────────────

  async registerWebhook(
    clientId: string,
    payload: TochkaWebhookRegisterRequest,
  ): Promise<TochkaWebhookGetResponse> {
    return this.request<TochkaWebhookGetResponse>({
      method: 'PUT',
      url: `/webhook/v1.0/${encodeURIComponent(clientId)}`,
      data: payload,
    });
  }

  async getWebhooks(clientId: string): Promise<TochkaWebhookGetResponse> {
    return this.request<TochkaWebhookGetResponse>({
      method: 'GET',
      url: `/webhook/v1.0/${encodeURIComponent(clientId)}`,
    });
  }

  // ─── Core: запрос с ретраями и логированием ───────────────────

  private async request<T>(config: AxiosRequestConfig): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        this.logRequest(config, attempt);

        const response = await this.http.request<T>(config);

        this.logResponse(config, response.status);

        return response.data;
      } catch (err) {
        lastError = err;

        const ax = err as AxiosError<TochkaErrorResponse>;
        const status = ax.response?.status;
        const code = ax.code;

        const isRetryable =
          (status && RETRYABLE_STATUS.includes(status)) ||
          (code && RETRYABLE_CODES.includes(code));

        this.logger.warn(
          `[Tochka] attempt ${attempt + 1}/${MAX_RETRIES} failed: ` +
            `status=${status ?? 'n/a'} code=${code ?? 'n/a'} ` +
            `url=${config.method} ${config.url}`,
        );

        if (!isRetryable || attempt === MAX_RETRIES - 1) {
          this.logErrorBody(ax);
          break;
        }

        const delay = RETRY_BASE_DELAY_MS * Math.pow(3, attempt);
        await sleep(delay);
      }
    }

    throw lastError;
  }

  // ─── Логирование ───────────────────────────────────────────────

  private logRequest(config: AxiosRequestConfig, attempt: number): void {
    const safeBody = this.maskBody(config.data);
    this.logger.log(
      `[Tochka] → ${config.method} ${config.url}` +
        (attempt > 0 ? ` (retry ${attempt})` : '') +
        (safeBody ? ` body=${safeBody}` : ''),
    );
  }

  private logResponse(config: AxiosRequestConfig, status: number): void {
    this.logger.log(`[Tochka] ← ${status} ${config.method} ${config.url}`);
  }

  private logErrorBody(err: AxiosError<TochkaErrorResponse>): void {
    const data = err.response?.data;
    if (!data) return;
    const msg = data.errors?.map((e) => e.message).join('; ') || JSON.stringify(data);
    this.logger.error(`[Tochka] error body: ${msg}`);
  }

  /** Маскирует чувствительные поля при логировании тела запроса */
  private maskBody(data: unknown): string | null {
    if (!data) return null;
    try {
      const clone = JSON.parse(JSON.stringify(data));
      if (clone?.Data?.customerCode) clone.Data.customerCode = '***';
      return JSON.stringify(clone);
    } catch {
      return null;
    }
  }
}