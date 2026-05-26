📦 Контекст: Backend (NestJS) — Блок 3: Billing Module

🗂️ Структура модуля


src/modules/billing/
├── billing.module.ts
├── billing.controller.ts
├── billing.service.ts
├── pricing.service.ts
├── promo-code.service.ts
├── providers/
│   ├── payment-provider.interface.ts
│   ├── yookassa.provider.ts
│   ├── cryptomus.provider.ts
│   ├── stars.provider.ts
│   ├── heleket.provider.ts
│   └── freedompay/
│       ├── freedompay.provider.ts
│       ├── freedompay.types.ts
│       └── freedompay.utils.ts
│   └── tochka/
│       ├── tochka.provider.ts
│       ├── tochka.client.ts
│       ├── tochka-webhook.verifier.ts
│       └── tochka.types.ts
└── schemas/
    ├── transaction.schema.ts
    ├── subscription.schema.ts
    ├── promo-code.schema.ts
    ├── subscription-plan.schema.ts
    └── token-package.schema.ts
🔗 Зависимости модуля

Typescript

BillingModule imports:
  MongooseModule: [Transaction, Subscription, PromoCode, AIModel,
                   SubscriptionPlanEntity, TokenPackageEntity]
  forwardRef → UsersModule
  forwardRef → ReferralModule

exports:
  BillingService
  PricingService
  PromoCodeService
  MongooseModule   // ← для AdminModule
📡 API Эндпоинты


GET  /billing/packages              список пакетов токенов      [публичный]
GET  /billing/plans                 список планов подписки      [публичный]
GET  /billing/balance               баланс пользователя         [JWT]
POST /billing/pay/tokens            купить пакет токенов        [JWT]
POST /billing/pay/subscription      купить подписку             [JWT]
POST /billing/promo                 применить промокод          [JWT]
POST /billing/promo/preview         превью промокода            [JWT]
GET  /billing/transactions          история транзакций          [JWT]

POST /billing/webhook/yookassa      вебхук YooKassa             [без JWT]
POST /billing/webhook/cryptomus     вебхук Cryptomus            [без JWT]
POST /billing/webhook/freedompay    вебхук FreedomPay (XML)     [без JWT]
POST /billing/webhook/tochka        вебхук Точка (JWT text/plain)[без JWT]
POST /billing/webhook/heleket       вебхук Heleket              [без JWT]
💳 Платёжные провайдеры

Общий интерфейс

Typescript

interface PaymentProviderInterface {
  createPayment(dto: CreatePaymentDto): Promise<PaymentResult>
  verifyWebhook(body: any, headers: any): Promise<WebhookResult>
  getPaymentStatus(paymentId: string): Promise<WebhookResult>
}

CreatePaymentDto {
  amount: number          // в основной валюте
  currency: 'RUB' | 'USD'
  tokens: number          // сколько токенов начислить
  userId: string
  description: string
  returnUrl?: string
}
1. YooKassa


API: https://api.yookassa.ru/v3
Auth: Basic (shopId:secretKey)
Валюта: только RUB (hardcoded toFixed(2))
Идемпотентность: Idempotence-Key = uuidv4() при каждом createPayment
capture: true (автоматическое списание)

Webhook: JSON body
  event.event === 'payment.succeeded' → completed
  event.event === 'payment.canceled' → failed
  ⚠️ Нет проверки подписи вебхука — принимает любой запрос

getPaymentStatus: GET /payments/:id
  payment.status === 'succeeded' → completed
  payment.status === 'canceled' → failed
2. Cryptomus


API: https://api.cryptomus.com/v1
Auth: headers { merchant, sign }
Валюта: RUB (hardcoded в createPayment, независимо от dto.currency)

Подпись (sign):
  MD5(base64(JSON.stringify(body)) + apiKey)
  ⚠️ Нестандартный MD5 — безопасность ниже HMAC

Webhook: JSON body
  body.status in ['paid', 'paid_over'] → completed
  body.status in ['cancel', 'fail', 'system_fail', 'wrong_amount'] → failed
  Дополнительные данные: body.additional_data (JSON строка с userId, tokens)

getPaymentStatus: POST /payment/info { uuid }
3. Telegram Stars


API: Telegram Bot API /createInvoiceLink
Auth: botToken в URL
Валюта: XTR (Telegram Stars)
Особенности:
  - createPayment → создаёт invoice link через Bot API
  - paymentId = 'stars_' + Date.now() (не настоящий ID!)
  - verifyWebhook → всегда возвращает success: true, status: 'completed'
    ⚠️ Нет проверки подписи — вебхук доверяется полностью
  - getPaymentStatus → всегда completed

Payload: JSON.stringify({ userId, tokens })
4. FreedomPay


API: baseUrl из конфига (freedompay.baseUrl)
Auth: подпись в каждом запросе
Валюта: KZT по умолчанию, конвертация из RUB/USD через rubToKzt/usdToKzt

Особенности:
  - createPayment: POST /init_payment (JSON) → XML ответ
  - verifyWebhook: multipart/form-data (AnyFilesInterceptor)
    ⚠️ Контроллер возвращает XML строку, не JSON
    @Header('Content-Type', 'application/xml')
  - getPaymentStatus: POST /get_status3.php (FormData)
  - refund: POST /revoke (FormData) — вне интерфейса

Подпись (sign в freedompay.utils.ts):
  MD5(scriptName + ';' + sorted(values).join(';') + ';' + secret)
  Скрипт = имя эндпоинта ('init_payment', 'freedompay', 'get_status3.php')

Передача контекста через pg_param1/2/3:
  pg_param1 = tokens (количество)
  pg_param2 = originalAmount
  pg_param3 = originalCurrency

orderId: если dto.orderId не передан → generateSalt(24) (hex строка)
⚠️ orderId не сохраняется в Transaction как externalPaymentId,
   сохраняется pg_payment_id из ответа init_payment

Конфиг загружается из:
  freedompay.merchantId, .secretKey, .baseUrl, .testingMode,
  .currency, .rubToKzt, .usdToKzt
  API_PUBLIC_URL, TG_BOT_USERNAME
5. Tochka (Точка Банк)


Архитектура: TochkaClient + TochkaProvider + TochkaWebhookVerifier

TochkaClient — HTTP уровень:
  baseURL: TOCHKA_API_URL || 'https://enter.tochka.com/uapi'
  Auth: Bearer JWT (TOCHKA_JWT — долгосрочный токен от банка)
  Ретраи: 3 попытки, exponential backoff (300ms * 3^attempt)
  Retryable: HTTP 502/503/504 + ECONNRESET/ETIMEDOUT/ECONNABORTED/EAI_AGAIN
  Маскирование: Data.customerCode → '***' в логах

TochkaWebhookVerifier:
  Вебхук = text/plain JWT, подписан RS256 приватным ключом Точки
  Режимы:
    TOCHKA_VERIFY_SIGNATURE !== 'false' → jwt.verify(token, publicKey, {algorithms: ['RS256']})
    TOCHKA_VERIFY_SIGNATURE === 'false' → jwt.decode() без проверки (DEV)
  TOCHKA_PUBLIC_KEY — RSA публичный ключ банка (с \n → \n декодированием)

TochkaProvider:
  Поддерживает только RUB
  createPayment:
    paymentMode: ['card', 'sbp']
    paymentLinkId = tx_<userId8>_<timestamp36>_<rand> (≤ 45 символов)
    ⚠️ formatAmount возвращает number, комментарий говорит "строку" — несоответствие
    ttl: TOCHKA_PAYMENT_TTL_MIN минут (дефолт 60)

  verifyWebhook: принимает УЖЕ распарсенный payload (верификация сделана в контроллере)
    webhookType !== 'acquiringInternetPayment' → success: false, status: 'pending' (игнорируем)
    operationId — используется как paymentId

  mapStatus:
    APPROVED → completed
    EXPIRED, REFUNDED, REFUNDED_PARTIALLY, ON-REFUND → failed
    CREATED, AUTHORIZED, WAIT_FULL_PAYMENT → pending

Webhook flow в BillingService.handleTochkaWebhook:
  1. verifier.verify(rawJwt)
  2. Найти Transaction по operationId + paymentProvider='tochka'
  3. Проверить status=PENDING (idempotency)
  4. handlePaymentWebhook('tochka', payload, {})

Конфиг:
  TOCHKA_JWT, TOCHKA_CUSTOMER_CODE, TOCHKA_MERCHANT_ID, TOCHKA_CLIENT_ID
  TOCHKA_API_URL, TOCHKA_PUBLIC_KEY, TOCHKA_VERIFY_SIGNATURE
  TOCHKA_REDIRECT_URL, TOCHKA_FAIL_REDIRECT_URL, TOCHKA_PAYMENT_TTL_MIN
6. Heleket


API: HELEKET_BASE_URL || 'https://api.heleket.com'
Auth: headers { merchant, sign }
Валюта: из dto.currency (передаётся как есть)

Подпись:
  PHP-совместимая сериализация: phpJsonEncode() — экранирует / и non-ASCII
  sign = MD5(base64(phpJsonEncode(body)) + apiKey)
  ⚠️ Отправляется именно та же строка что подписана (data: bodyJson, не body)

Диагностика при старте: логирует длину и первые/последние 4 символа ключей

verifyWebhook:
  Пробует 2 варианта сериализации: phpJsonEncode + JSON.stringify
  timingSafeEqual для сравнения хешей (защита от timing attack)

Статусы:
  'paid' | 'paid_over' → completed
  'fail' | 'cancel' | 'wrong_amount' | 'system_fail' → failed

additional_data: JSON строка с { userId, tokens, description }

Конфиг (два возможных имени для каждого):
  HELEKET_MERCHANT_ID или HELEKET_MERCHANT_UUID
  HELEKET_API_KEY или HELEKET_PAYMENT_API_KEY
  HELEKET_BASE_URL, HELEKET_WEBHOOK_URL, HELEKET_RETURN_URL
  API_PUBLIC_URL (для построения дефолтных URL)
🏦 BillingService

Кэш планов и пакетов

Typescript

// In-memory кэш с TTL 60 секунд
plansCache:    { data: SubscriptionPlanDocument[]; ts: number } | null
packagesCache: { data: TokenPackageDocument[]; ts: number } | null

invalidateBillingCache() — ручной сброс (вызывается из AdminService)
Fallback данные

Typescript

// Если БД пуста — используются хардкоденные константы
FALLBACK_TOKEN_PACKAGES: 5 пакетов (100, 300, 700, 1500, 5000 токенов)

FALLBACK_SUBSCRIPTION_PLANS: 4 плана
  BASIC:    450₽, 150 токенов/мес
  PLUS:     990₽, 330 токенов/мес, 3 бесплатные модели (10/час, 60/сутки)
  MAX:     2490₽, 830 токенов/мес, 3 безлимитные модели
  ULTIMATE:5990₽, 1997 токенов/мес, 6 бесплатных моделей (mix лимитированных и безлимитных)
Миграция deprecated планов

Typescript

PLAN_MIGRATION: {
  PRO → PLUS
  UNLIMITED → ULTIMATE
}
// Запускается: onApplicationBootstrap + @Cron(EVERY_DAY_AT_3AM)
// Находит активные подписки со старыми планами → переименовывает
Бесплатный доступ к моделям (checkFreeModelAccess)

Typescript

// Алгоритм:
// 1. Найти user → получить subscriptionPlan → загрузить planConfig
// 2. Найти modelSlug в planConfig.freeModels
// 3. Если hourlyLimit=null && dailyLimit=null → безлимит
// 4. Иначе → countDocuments транзакций за час/день с metadata.freeAccess=true
// 5. Вернуть { isFree, reason? }

// Используется в: chargeForGeneration, preChargeMediaGeneration
// ⚠️ 2 запроса к БД на каждую генерацию (hourly + daily count)
Расчёт стоимости генерации (calculateGenerationCost)

Typescript

// TEXT модели:
//   Новая система: pricePerMillionInputTokens/OutputTokens → costInTokens (в 🔥)
//                  providerCostPerMillionInput/Output → costInDollars (справочно)
//   Fallback (если новые поля = 0): costPerMillionInputTokens * tokensPerDollar
//
// MEDIA модели:
//   pricingMatrix + params → matchPricingTier() (нестрогое сравнение == )
//   Fallback: fixedCostPerGeneration * tokensPerDollar

// matchPricingTier:
//   Перебирает тиры по порядку (НЕ сортирует по специфичности!)
//   Пустые conditions → совпадает всегда (catch-all)
//   Нестрогое сравнение: '5' == 5 → true
⚠️ В отличие от PricingService.findMatchingRule(), BillingService.matchPricingTier() НЕ сортирует по специфичности — берёт первое совпадение по порядку в массиве. Два разных алгоритма для одной задачи.

Webhook обработка (handlePaymentWebhook)

Typescript

// Общий поток для yookassa/cryptomus/heleket/(freedompay через обёртку):
// 1. provider.verifyWebhook(body, headers) → WebhookResult
// 2. Найти Transaction по externalPaymentId (без проверки provider!)
// 3. Проверить status=PENDING (idempotency guard)
// 4. completed → addTokens + markPromo + activateSubscription + processReferralBonus
// 5. failed → установить FAILED
⚠️ Поиск транзакции без провайдера — findOne({ externalPaymentId, paymentStatus: PENDING }) без фильтра по paymentProvider. Если два провайдера случайно сгенерируют одинаковый paymentId — возникнет коллизия.

⚠️ Двойное списание подписки — при webhook для SUBSCRIPTION транзакции вызывается addTokens(amount) ДО activateSubscription(). Внутри activateSubscription также вызывается addTokens(tokensPerMonth). Итого токены начисляются дважды.

preChargeMediaGeneration vs recordMediaGeneration

Typescript

// Паттерн для async media генерации:
// 1. preChargeMediaGeneration(userId, modelSlug, params)
//    → deductTokens (атомарно) + возвращает costInTokens
//    → НЕ создаёт транзакцию
// 2. ... запуск генерации у провайдера ...
// 3. recordMediaGeneration(userId, params)
//    → createTransaction (балансы вычисляются ПОСЛЕ списания)
//    ⚠️ balanceBefore = balanceAfter + cost — реконструируется обратно,
//       а не реальный снимок ДО списания

// chargeForGeneration — для text (синхронный):
//    → calculateCost + deductTokens + createTransaction
//    → balanceBefore корректно снимается ДО deductTokens
Реферальный кэшбек (processReferralBonus)

Typescript

// 10% от paymentAmountRub
// Начисляется в cashbackBalance реферера
// Только если paymentAmountRub > 0 (бесплатные промокоды не дают кэшбек)
// Параллельно: referralService.markReferralPurchase()
// Создаёт Transaction(REFERRAL_BONUS) для реферера
Промокоды — флоу применения


Standalone (POST /billing/promo):
  validate(standalone) → только BONUS_TOKENS → addBonusTokens → markUsed

При оплате токенов:
  validate → если SUBSCRIPTION_DAYS → ошибка
  finalPriceRub = validation.finalAmountRub
  Если finalPriceRub === 0 → начислить сразу без платежа
  Иначе → сохранить promoCodeApplied в metadata транзакции
  → при webhook → markUsed + addBonusTokens

При оплате подписки:
  validate → если SUBSCRIPTION_DAYS → activateSubscriptionForDays + markUsed (без платежа)
  Если finalPriceRub === 0 → activateSubscription + markUsed
  Иначе → сохранить в metadata → при webhook → activateSubscription
🎟️ PromoCodeService

Типы промокодов


BONUS_TOKENS      → начисляет bonusTokens (standalone или при оплате)
DISCOUNT_PERCENT  → discountPercent% от суммы (Math.floor)
DISCOUNT_RUB      → фиксированная скидка (min(discountRub, amountRub))
SUBSCRIPTION_DAYS → N дней бесплатной подписки (без оплаты)
Контексты применения (applyTo)


ANY          → любая покупка
SUBSCRIPTION → только подписки
TOKEN_PACKAGE→ только пакеты
STANDALONE   → только без покупки
validate() — порядок проверок


1. Промокод найден + isActive
2. startsAt <= now <= expiresAt
3. currentUses < maxUses (если maxUses !== null)
4. userUsage.usesCount < maxUsesPerUser
5. validateApplyContext (applyTo vs purchaseType)
6. applicablePlans (lowercase сравнение)
7. applicablePackages (exact match)
8. minPurchaseRub <= amountRub
9. computeEffect → PromoValidationResult
markUsed() — НЕ атомарная операция

Typescript

// findById → мутация в памяти → save()
// ⚠️ Race condition при concurrent применениях одного промокода:
//    два пользователя могут применить промокод с currentUses = maxUses - 1
//    оба пройдут validate (оба видят currentUses < maxUses)
//    оба вызовут markUsed → currentUses станет maxUses + 1
subscriptionPlan в схеме

Typescript

@Prop({ type: String, enum: ['pro', 'premium'], default: null })
subscriptionPlan?: 'pro' | 'premium' | null;
// ⚠️ Enum содержит 'pro' и 'premium', но реальные планы: basic/plus/max/ultimate
// 'premium' не существует как SubscriptionPlan
💰 PricingService

calculatePrice() — для preview

Typescript

// TEXT: возвращает model.minTokenCost как preview (реальная цена после стрима)
// MEDIA: findMatchingRule → если нет → fallback к fixedCostPerGeneration

// findMatchingRule (в отличие от BillingService.matchPricingTier):
//   Сортирует по специфичности (больше conditions → раньше)
//   Поддерживает Array в conditions: ['fast', 'turbo'] → params[key] must be included
//   Строгое сравнение ===

// Минимум: Math.max(matched.costInTokens, model.minTokenCost || 1)
🗄️ Схемы MongoDB

Transaction


Индексы:
  { userId: 1, createdAt: -1 }
  { userId: 1, type: 1, createdAt: -1 }
  { paymentStatus: 1, createdAt: -1 }
  { externalPaymentId: 1, paymentProvider: 1 } sparse  ← webhook lookup
  { userId, type, modelSlug, 'metadata.freeAccess', createdAt } ← free model counts
  { type: 1, paymentStatus: 1, createdAt: -1 } ← revenue stats

Поля: amount (отрицательное при списании), balanceBefore/After,
      costInDollars, costInTokens, inputTokens, outputTokens
      referralUserId → ref: User
Subscription


Индексы:
  { isActive: 1, endDate: 1 }           ← checkExpiredSubscriptions
  { userId: 1, isActive: 1, endDate: -1 }
  { isActive: 1, plan: 1 }              ← migration
PromoCode


usages: embedded array [{userId, usesCount, lastUsedAt}]
⚠️ При большом количестве использований — документ растёт,
   MongoDB имеет лимит 16MB на документ

Индексы:
  { code: 1, isActive: 1 }
  { isActive: 1, expiresAt: 1 }
SubscriptionPlanEntity


Хранится в коллекции 'subscription_plans'
planKey: unique, lowercase — 'basic'/'plus'/'max'/'ultimate'
freeModels: [{modelSlug, displayName, hourlyLimit, dailyLimit}]
features: {maxDailyGenerations, priorityQueue, exclusiveModels, noWatermark, maxContextMessages}
TokenPackageEntity


Хранится в коллекции 'token_packages'
packageId: unique — 'pack_100', 'pack_300' и т.д.
bonusPercent: бонус % сверху
💵 Финансовые константы

Typescript

RUB_TO_USD_RATE = 75          // хардкоденный курс (не обновляется)
REFERRAL_CASHBACK_RATE = 0.1  // 10% кэшбек
MIN_CHARGE_TOKENS = 0.01      // минимальное списание
TOKEN_PRECISION = 2           // 2 знака после запятой
FLOAT_EPSILON = 1e-9          // защита от float сравнений
⚠️ Замеченные проблемы

🔴 Критичные

Двойное начисление токенов при webhook подписки — handlePaymentWebhook вызывает addTokens(transaction.amount), затем activateSubscription() снова вызывает addTokens(tokensPerMonth). Одна покупка подписки = двойные токены.

Race condition в PromoCode.markUsed — findById → mutate → save не атомарно. Concurrent запросы могут превысить maxUses. Нужен findOneAndUpdate с $inc.

Webhook поиск без провайдера — findOne({ externalPaymentId, status: PENDING }) без paymentProvider. Коллизия ID у разных провайдеров приведёт к зачислению не той суммы.

recordMediaGeneration — неправильный balanceBefore — вычисляется как balanceAfter + cost, что предполагает что между deduct и record ничего не произошло. При concurrent операциях балансы не сойдутся.

🟡 Средние

Курс RUB/USD хардкоден — RUB_TO_USD_RATE = 75. При реальных курсах пользователи платят неверную сумму в USD.

PromoCode.subscriptionPlan enum устарел — ['pro', 'premium'], реальные планы basic/plus/max/ultimate. Нельзя создать промокод на PLUS/MAX/ULTIMATE дни.

Stars webhook без верификации — verifyWebhook всегда возвращает success: true. Любой POST на /webhook/stars начислит токены (если найдёт транзакцию).

YooKassa webhook без верификации — нет проверки IP или HMAC-подписи. Любой может вызвать вебхук с известным paymentId.

Дублирование логики matchPricingTier — два разных алгоритма: BillingService.matchPricingTier (порядок, ==) и PricingService.findMatchingRule (специфичность, ===, массивы). Preview и реальное списание могут дать разный результат.

usages embedded array — при >1000 использований промокода документ растёт без ограничений. Нужна отдельная коллекция или TTL.

getRevenueStats.newSubscriptions — считает createdAt >= since && isActive: true. Не считает подписки, созданные за период но уже истёкшие.

🟢 Минорные

getTokenPackages/getSubscriptionPlans — async, возвращаются из контроллера без await — getPackages в контроллере делает return { data: this.billingService.getTokenPackages() } без await. Вернёт Promise объект. На деле работает потому что NestJS сериализует Promise, но это неявное поведение.

TochkaProvider.formatAmount — комментарий "Точка требует строку", но метод возвращает number. Если API действительно требует строку — будет ошибка валидации.

FreedomPay orderId — если dto.orderId не передан, генерится случайный generateSalt(24). В createTokenPayment orderId никогда не передаётся → каждый раз новый случайный ID, который нигде не сохраняется как связь.

Cryptomus игнорирует dto.currency — всегда отправляет currency: 'RUB' независимо от переданной валюты.

activateSubscriptionForDays не начисляет токены — tokensPerMonth: 0 при создании через промокод. Пользователь получает доступ к плану но без токенов.