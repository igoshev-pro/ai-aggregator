// src/config/payment-urls.ts
//
// Куда платёжные провайдеры возвращают пользователя после оплаты.
// Фронт (SPA) читает query-параметр `payment=success|fail` на главной.
// Отдельных роутов /topup/success|fail во фронте НЕТ — не использовать.
import { ConfigService } from '@nestjs/config';

const DEFAULT_FRONTEND_URL = 'https://spichki-ai.net';

export function getFrontendBaseUrl(config?: ConfigService): string {
  const raw =
    config?.get<string>('FRONTEND_URL') ||
    process.env.FRONTEND_URL ||
    DEFAULT_FRONTEND_URL;
  return raw.trim().replace(/\/+$/, '');
}

/**
 * PAYMENT_SUCCESS_URL / PAYMENT_FAIL_URL — общие переопределения;
 * по умолчанию `${FRONTEND_URL}/?payment=success|fail`.
 * Провайдер-специфичные env (TOCHKA_REDIRECT_URL и т.п.) имеют приоритет
 * и проверяются в самих провайдерах.
 */
export function getPaymentReturnUrls(config?: ConfigService): {
  successUrl: string;
  failUrl: string;
} {
  const base = getFrontendBaseUrl(config);
  return {
    successUrl:
      config?.get<string>('PAYMENT_SUCCESS_URL') ||
      process.env.PAYMENT_SUCCESS_URL ||
      `${base}/?payment=success`,
    failUrl:
      config?.get<string>('PAYMENT_FAIL_URL') ||
      process.env.PAYMENT_FAIL_URL ||
      `${base}/?payment=fail`,
  };
}

/** Старые адреса /topup/* не существуют во фронте — предупреждаем, если они пришли из env */
export function isLegacyTopupUrl(url?: string | null): boolean {
  return !!url && /\/topup\/(success|fail)/.test(url);
}
