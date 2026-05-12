// src/modules/billing/providers/freedompay/freedompay.types.ts
export interface FreedomPayInitResponse {
  pg_status: 'ok' | 'error';
  pg_payment_id?: string;
  pg_redirect_url?: string;
  pg_error_code?: string;
  pg_error_description?: string;
  pg_salt: string;
  pg_sig: string;
}

export interface FreedomPayWebhookBody {
  pg_order_id: string;
  pg_payment_id: string;
  pg_amount: string;
  pg_currency: string;
  pg_net_amount?: string;
  pg_ps_amount?: string;
  pg_ps_full_amount?: string;
  pg_ps_currency?: string;
  pg_description: string;
  pg_result: '0' | '1' | '2';
  pg_payment_date: string;
  pg_can_reject: '0' | '1';
  pg_testing_mode: '0' | '1';
  pg_salt: string;
  pg_sig: string;
  pg_card_pan?: string;
  pg_card_brand?: string;
  pg_payment_method?: string;
  pg_param1?: string;
  pg_param2?: string;
  pg_param3?: string;
  [k: string]: string | undefined;
}