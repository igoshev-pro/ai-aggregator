# 💳 Billing Module — Детальный контекст

## Назначение
Финансовая система: пакеты токенов, подписки, платёжные провайдеры, промокоды, транзакции.

## Файлы модуля
src/modules/billing/
├── billing.module.ts
├── billing.controller.ts
├── billing.service.ts
├── schemas/
│   ├── transaction.schema.ts
│   ├── subscription.schema.ts
│   └── promo-code.schema.ts
└── providers/
├── payment-provider.interface.ts
├── yookassa.provider.ts
├── cryptomus.provider.ts
└── stars.provider.ts



## Пакеты токенов
| ID | Токены | Цена | Метка |
|----|--------|------|-------|
| pack_100 | 100 | 99₽ | |
| pack_300 | 300 | 249₽ | Popular |
| pack_700 | 700 | 499₽ | |
| pack_1500 | 1500 | 899₽ | |
| pack_5000 | 5000 | 2499₽ | Best value |

## Подписки
| План | Цена | Токены/мес | Лимит генераций | Priority | Premium модели |
|------|------|-----------|-----------------|----------|---------------|
| Free | 0₽ | 0 | По балансу | ❌ | ❌ |
| Basic | 299₽ | 500 | 50/день | ❌ | ❌ |
| Pro | 699₽ | 1500 | 200/день | ✅ | ✅ |
| Unlimited | 1999₽ | 5000 | ∞ | ✅ | ✅ |

## Платёжные провайдеры

### YooKassa
- RUB payments
- Redirect flow: createPayment → redirect → webhook
- Webhook events: `payment.succeeded`, `payment.canceled`
- Idempotence key для дедупликации

### Cryptomus
- Crypto payments
- Sign: MD5(base64(json) + apiKey)
- Webhook с проверкой sign
- Statuses: paid, paid_over, cancel, fail

### Telegram Stars (XTR)
- In-app payments через Bot API
- createInvoiceLink → пользователь оплачивает в TG
- Обработка через successful_payment от бота

## Transaction Schema
```typescript
{
  userId: ObjectId;
  type: 'deposit' | 'withdrawal' | 'generation' | 'refund' | 
        'referral_bonus' | 'promo_code' | 'subscription' | 'admin_adjustment';
  amount: number;              // + приход, - расход
  balanceBefore: number;
  balanceAfter: number;
  description: string;
  paymentStatus: 'pending' | 'completed' | 'failed' | 'refunded';
  externalPaymentId: string;
  paymentProvider: string;
  paymentAmountRub: number;
  generationId: string;
  generationType: string;
  modelSlug: string;
  promoCode: string;
  referralUserId: ObjectId;
  metadata: {};
}
Поток оплаты пакета


1. POST /billing/pay/tokens { packageId, provider, returnUrl }
2. Find package by ID
3. Create payment at provider → get paymentUrl
4. Create PENDING transaction in DB
5. Return { paymentUrl } → frontend redirects user
6. User pays → provider sends webhook
7. POST /billing/webhook/yookassa (body)
8. Verify webhook (HMAC for YooKassa, sign for Cryptomus)
9. Find PENDING transaction by externalPaymentId
10. If completed:
    - addTokens to user
    - Update transaction → COMPLETED
    - Process referral bonus (10% of tokens)
11. If subscription payment → activateSubscription
PromoCode Schema

Typescript

{
  code: string;                // unique, uppercase
  description: string;
  bonusTokens: number;
  discountPercent: number;
  maxUses: number | null;      // null = unlimited
  currentUses: number;
  maxUsesPerUser: number;
  expiresAt: Date;
  isActive: boolean;
  usedByUsers: string[];
  createdBy: string;
}
Cron Jobs

checkExpiredSubscriptions — каждый час проверяет и деактивирует истёкшие подписки
API Endpoints

Method	Path	Auth	Description
GET	/billing/packages	❌	Пакеты токенов
GET	/billing/plans	❌	Планы подписок
GET	/billing/balance	✅	Баланс + лимиты + подписка
POST	/billing/pay/tokens	✅	Оплата пакета
POST	/billing/pay/subscription	✅	Оплата подписки
POST	/billing/promo	✅	Применить промокод
GET	/billing/transactions	✅	История транзакций
POST	/billing/webhook/yookassa	❌	Webhook
POST	/billing/webhook/cryptomus	❌	Webhook
Важно

Webhook endpoints БЕЗ JWT авторизации (вызываются платёжками)
Все финансовые операции атомарны (save → save)
Полное логирование каждой транзакции
Refund автоматический при failed генерации