🏗️ Общий контекст: Backend (NestJS) — SPICHKI AI

📁 Структура проекта


src/
├── app.module.ts
├── main.ts
├── config/
│   └── configuration.ts
├── common/
│   ├── decorators/        current-user, roles
│   ├── filters/           global-exception
│   ├── guards/            jwt-auth, roles, telegram-auth
│   ├── interceptors/      logging (global), timeout (local)
│   └── interfaces/        enums + interfaces
├── modules/
│   ├── admin/             AdminModule (+ sub-controllers)
│   ├── ai-providers/      AiProvidersModule
│   ├── analytics/         AnalyticsModule (@Global)
│   ├── auth/              AuthModule
│   ├── billing/           BillingModule
│   ├── chat/              ChatModule
│   ├── favorites/         FavoritesModule
│   ├── generation/        GenerationModule (Bull queue)
│   ├── health/            HealthModule
│   ├── models/            ModelsModule
│   ├── referral/          ReferralModule
│   ├── storage/           StorageModule + UploadController (Блок 11)
│   ├── support/           SupportModule
│   ├── telegram-bot/      TelegramBotModule (Telegraf)
│   ├── upload/            UploadModule + UploadController (Блок 14)
│   ├── users/             UsersModule
│   └── webhooks/          WebhooksModule
└── scripts/
    ├── migrate-token-system.ts
    ├── seed-billing.ts
    └── seed-midjourney-pricing.js  (mongosh)
⚙️ Конфигурация (src/config/configuration.ts)

Typescript

// Загружается через ConfigModule.forRoot({ load: [configuration] })

config.get('port')              // 3001
config.get('nodeEnv')           // 'development'
config.get('mongo.uri')
config.get('redis.host/port/password')
config.get('jwt.secret')
config.get('jwt.expiration')    // '7d'
config.get('telegram.botToken')
config.get('telegram.botUsername')

// AI провайдеры:
config.get('providers.openrouter.apiKey/baseUrl')
config.get('providers.evolink.apiKey/baseUrl')  // baseUrl уже с /v1
config.get('providers.kie.apiKey/baseUrl')       // ⚠️ БЕЗ /v1 → 'https://api.kie.ai'
config.get('providers.replicate.apiKey')

// Платёжные провайдеры:
config.get('payment.yookassa.*')
config.get('payment.cryptomus.*')
config.get('payment.freedompay.*')   // merchantId: number, testingMode: 0|1, rubToKzt: 5.7
config.get('payment.heleket.*')
// ⚠️ Tochka НЕ в configuration.ts — читает process.env.TOCHKA_* напрямую

// S3:
config.get('s3.endpoint/bucket/accessKey/secretKey/region')
// S3_PUBLIC_URL: default '' → невалидные URL при незаданной переменной

// defaultPricing (fallback, актуальные цены в MongoDB):
// TEXT: gpt-4o:3, gpt-4o-mini:1, claude:1-3, deepseek:1-2, grok:3 etc.
// IMAGE: midjourney:10, dall-e-3:5, flux:5, stable-diffusion:3
// VIDEO: sora:30, runway:25, veo:25, kling:20, luma:20, hailuo:15
// AUDIO: suno-v4:10, elevenlabs:5
// Курс: RUB_TO_USD_RATE = 75 (хардкод)
🔑 Общие механизмы

Аутентификация

Typescript

// JWT payload (sub = MongoDB _id):
{ sub, telegramId?, email?, authProvider, role, iat, exp }

// JwtStrategy.validate():
//   → findById из БД (актуальная роль)
//   → проверяет isActive && !isBanned
//   → устанавливает req.user

// @CurrentUser('sub') userId — стандартный способ получить ID
// ⚠️ req.user?.id || req.user?._id — НЕВЕРНО (нужен .sub)
//    Используется в StorageModule и UploadModule

// TelegramAuthGuard:
//   → устанавливает req.telegramUser (НЕ req.user!)
//   → валидность initData: 1 час (prod), 30 дней (dev)
Роли и доступ

Typescript

UserRole: USER | PREMIUM | ADMIN | SUPER_ADMIN

// RolesGuard: requiredRoles.some(role => user.role === role)
// ⚠️ Иерархии нет: SUPER_ADMIN не проходит @Roles(ADMIN) автоматически
// ⚠️ PREMIUM роль есть в enum но нигде не используется в guards

// AdminBootstrapService: синхронизирует роль через ADMIN_TG_IDS при каждом логине
// ⚠️ Только для telegramId пользователей (email/OAuth не синхронизируются)
Подписки

Typescript

SubscriptionPlan: FREE | BASIC | PLUS | MAX | ULTIMATE
// Deprecated (в БД могут быть старые записи):
//   PRO → PLUS  (миграция в BillingService: onBootstrap + cron 3AM)
//   UNLIMITED → ULTIMATE

// Ценовая модель:
// Подписки: ~3 ₽/токен (basic 450₽/150, plus 990₽/330, max 2490₽/830, ultimate 5990₽/1997)
// Пакеты:   0.5-0.99 ₽/токен (pack_100: 99₽, pack_5000: 2499₽)
// ⚠️ Подписки в 3-6 раз дороже пакетов — намеренно или ошибка?
Баланс пользователя

Typescript

// Три типа токенов (все в "спичках" 🔥):
tokenBalance:      купленные (через платёж)
bonusTokens:       промо (нельзя вывести)
cashbackBalance:   кэшбек рефералов (можно тратить И выводить)

// Приоритет списания в deductTokens:
//   bonusTokens → cashbackBalance → tokenBalance

// ⚠️ КРИТИЧНО: cashbackBalance НЕ включён в totalBalance в AuthResponseDto и UsersController
//    totalBalance = tokenBalance + bonusTokens (везде: Auth, Users, Chat, Generation)
//    Пользователь видит заниженный баланс + может получить отказ из-за несчитанного кэшбека

// Точность: TOKEN_PRECISION = 2, FLOAT_EPSILON = 1e-9
// Нормализация: normalizeBalances() после каждой операции

// Стартовый бонус: bonusTokens: 9 (хардкод в UsersService И в TelegramBotUpdate)
// ⚠️ Константа INITIAL_BONUS_TOKENS = 9 отсутствует
📊 MongoDB — коллекции и схемы

Typescript

// Коллекции:
users                   // User — основная схема
ai_models               // AIModel — каталог моделей + ценовые поля
providers               // Provider — провайдеры AI
generations             // Generation — задачи генерации
conversations           // Conversation — чаты
messages                // Message — сообщения чатов
transactions            // Transaction — финансовый журнал
subscriptions           // Subscription — активные подписки
promo_codes             // PromoCode — промокоды
subscription_plans      // SubscriptionPlanEntity — конфиги планов
token_packages          // TokenPackageEntity — пакеты токенов
referrals               // Referral — реферальные связи
withdrawals             // Withdrawal — заявки на вывод
tickets                 // Ticket (support) — тикеты поддержки
favorites               // Favorite — избранное пользователей
analytics_events        // AnalyticsEvent — события (TTL 90 дней)
tokenomics_settings     // TokenomicsSettings — singleton настроек
🤖 AI Провайдеры

Карта провайдеров

Typescript

// Провайдеры (Map ключ → класс):
'openrouter'       → OpenRouterProvider    // text + /images/generations
'openrouter-image' → OpenRouterImageProvider  // /chat/completions + modalities
'evolink'          → EvolinkProvider       // GPT/Claude/image/video/audio (async)
'kie'              → KieProvider           // MJ/Flux/Suno/EL/Kling/Runway/Hailuo
'replicate'        → ReplicateProvider     // image/video/audio polling

// ⚠️ openrouter и openrouter-image имеют один slug='openrouter' в БД
//    → второй перезаписывает первого в syncProvidersToDB()
Каталог моделей (40+ моделей)


Текст (14): gpt-oss-120b, claude-haiku-4.5, deepseek-v3.2, grok-4.1-fast,
            grok-4, perplexity-sonar, gpt-5.4*, claude-opus-4.6*, claude-sonnet-4.6*,
            deepseek-v4(inactive!), gemini-3.1-pro, gemini-3-flash, gpt-4o, gpt-4o-mini
            (* = evolink)

Изображения (10): gpt-5-image, gpt-image-1.5-lite, midjourney, midjourney-img2img,
                  seedream-5-lite, imagen-4, flux-2, flux-2-img2img,
                  nano-banana-2(max 14 img), nano-banana-pro(max 8 img)

Видео (11): veo-3.1-fast/pro, sora-2/sora-2-pro/sora-2-img2vid,
            kling-3.0/kling-3.0-img2vid/kling-3.0-motion,
            runway, hailuo-2.3-standard/pro

Аудио (7): suno-v4, elevenlabs-tts-turbo, elevenlabs-tts-multilingual,
           elevenlabs-dialogue, elevenlabs-isolation, elevenlabs-stt, elevenlabs-sfx
Ценовые поля AIModel (две системы)

Typescript

// Новая система (активная):
pricePerMillionInputTokens   // 🔥 за 1M входных токенов
pricePerMillionOutputTokens  // 🔥 за 1M выходных токенов
avgTokensPerRequest          // default: 1500

// Справочно (не влияет на списание):
providerCostPerMillionInput  // $ у провайдера
providerCostPerMillionOutput

// Deprecated (используются как fallback в BillingService):
costPerMillionInputTokens, costPerMillionOutputTokens
tokensPerDollar, minTokenCost, tokenCost

// Media модели:
fixedCostPerGeneration  // $ (fallback)
pricingMatrix[]         // { conditions, costInTokens, costInDollars, label? }
uiParameters[]          // { key, label, type, options, default, affectsPrice }
inputCapabilities        // { acceptsImages, maxInputImages, ... }
Расчёт стоимости генерации

Typescript

// ⚠️ ДВА разных алгоритма для одной задачи:

// PricingService.findMatchingRule():
//   - Сортирует по специфичности (больше conditions → раньше)
//   - Строгое сравнение ===
//   - Поддерживает Array в conditions
//   - Используется для preview цены

// BillingService.matchPricingTier():
//   - Берёт первое совпадение по порядку в массиве (НЕ сортирует!)
//   - Нестрогое сравнение ==
//   - Используется для реального списания
// ⚠️ Preview и реальное списание могут дать разный результат
checkFreeModelAccess

Typescript

// Алгоритм (2 запроса к БД на каждую генерацию):
// 1. user → subscriptionPlan → planConfig.freeModels
// 2. если hourlyLimit=null && dailyLimit=null → безлимит
// 3. иначе → countDocuments транзакций за час/день

// freeModels в планах:
// plus:     gpt-oss-120b, deepseek-v3.2, grok-4.1-fast (10/час, 60/сут)
// max:      те же 3 (безлимит)
// ultimate: те же 3 + gpt-image-1.5-lite, imagen-4, midjourney (10/час, 60/сут)
💳 Биллинг и платежи

Платёжные провайдеры

Typescript

// YooKassa:     RUB, Basic auth, ⚠️ НЕТ верификации webhook
// Cryptomus:    RUB (игнорирует dto.currency), MD5 подпись
// Telegram Stars: XTR, ⚠️ verifyWebhook всегда success:true
// FreedomPay:   KZT (конвертация из RUB), MD5+script, XML webhook ответ
// Tochka:       RUB, RS256 JWT webhook, retry 3x backoff, только Telegram-users
// Heleket:      любая валюта, phpJsonEncode+MD5, timingSafeEqual

// ⚠️ webhook lookup БЕЗ фильтра paymentProvider:
//    findOne({ externalPaymentId, paymentStatus: PENDING })
//    → коллизия ID у разных провайдеров → неверное зачисление
Транзакции

Typescript

TransactionType: DEPOSIT | WITHDRAWAL | GENERATION | REFUND |
                 REFERRAL_BONUS | PROMO_CODE | SUBSCRIPTION | ADMIN_ADJUSTMENT

// ⚠️ Двойное начисление при webhook подписки:
//    handlePaymentWebhook → addTokens(amount)
//    activateSubscription → addTokens(tokensPerMonth)  ← второй раз!

// balanceBefore в recordMediaGeneration:
//    вычисляется как balanceAfter + cost (не реальный снимок до операции)
Промокоды

Typescript

PromoCodeType: BONUS_TOKENS | DISCOUNT_PERCENT | DISCOUNT_RUB | SUBSCRIPTION_DAYS
ApplyTo:       ANY | SUBSCRIPTION | TOKEN_PACKAGE | STANDALONE

// ⚠️ markUsed() НЕ атомарен → race condition при concurrent применении
// ⚠️ subscriptionPlan в схеме: enum ['pro', 'premium'] — оба устарели
//    Нельзя создать промокод на PLUS/MAX/ULTIMATE дни через Admin
// ⚠️ usages: embedded array → документ растёт (лимит MongoDB 16MB)
🔄 Генерация (Generation Module)

Флоу создания

Typescript

// ⚠️ НЕАТОМАРНЫЙ флоу — 3 шага без транзакции:
// 1. generation.save()           → PENDING в БД
// 2. deductTokens()              → списание с баланса  ← если упадёт: зависший PENDING
// 3. generationQueue.add()       → Bull queue          ← если упадёт: токены списаны, задача не создана

// validateBalance: tokenBalance + bonusTokens (⚠️ cashbackBalance не считается)
// pricingService.calculatePrice() → costInTokens + breakdown
Bull Consumer

Typescript

// Queue: 'generation'
// attempts: 3 (image/audio), 2 (video)
// backoff: exponential 3s (image/audio), 5s (video)
// timeout: 300s (image/audio), 600s (video)

// Polling async tasks:
// maxAttempts: 120 × pollInterval: 5000ms = 10 минут максимум
// maxConsecutiveFailures: 3

// ⚠️ recordSuccessfulGeneration: findById → check billingRecorded → update
//    НЕ атомарно → при Bull retry оба запроса пишут транзакцию
//    Нужен findOneAndUpdate({ billingRecorded: false }, { $set: { billingRecorded: true } })

// ⚠️ При retry saveToStorage вызывается повторно → дублирование файлов в S3
// ⚠️ Нет cron для PENDING генераций без задачи в queue → вечный PENDING
WebSocket Gateway

Typescript

// namespace: '/generation', transports: ['websocket', 'polling']
// cors: { origin: '*' }  ⚠️

// Auth: JWT из handshake.auth.token || Authorization header
// Rooms: 'user:{userId}', 'generation:{id}'
// userSockets: Map<userId, Set<socketId>>  ⚠️ не шарится между инстансами

// Events → клиенту:
// generation:status, generation:progress, generation:completed, generation:failed
💬 Chat Module

Флоу sendMessage

Typescript

// ⚠️ КРИТИЧНО: дублирование последнего user сообщения:
//    userMessage.save() → buildContext() читает историю (включая только что сохранённое)
//    И явно добавляет dto.content в конец
//    → модель видит [..., user: "вопрос", user: "вопрос"]

// ⚠️ checkSufficientBalance: tokenBalance + bonusTokens (без cashbackBalance)
// maxContextMessages: 20 (хардкоден)
// Throttle: 10 req/60s

// SSE stream events: conversation → message_start → text_delta × N → message_end → done
// ⚠️ При ошибке стрима: placeholder удаляется, но message_end отправляется
//    с ID удалённого документа
👤 Users Module

Схема User — ключевые поля

Typescript

// Auth:
authProvider: TELEGRAM | EMAIL | GOOGLE (⚠️ GOOGLE не реализован)
telegramId: number | null   // sparse unique
email: string | null        // sparse unique
passwordHash: string | null // select: false
googleId: string | null     // sparse unique

// Balance:
tokenBalance, bonusTokens, cashbackBalance  // no min (намеренно)
cashbackEarnedTotal: min: 0  // ⚠️ несоответствие с остальными
totalTokensSpent, totalDeposited

// Status:
isActive, isBanned, banReason
isDeleted (soft delete), deletedAt, deletedBy
lastActiveAt

// Subscription:
subscriptionPlan: SubscriptionPlan
subscriptionExpiresAt: Date | null  // ⚠️ бессрочные подписки не поддерживаются

// Daily limits:
dailyGenerations, dailyGenerationsResetAt
// ⚠️ сброс по локальному времени сервера (UTC+0 если сервер в UTC)
Критичные методы

Typescript

// findOrCreateByTelegram: findOne + new + save = НЕ АТОМАРНО
//   → duplicate key error при параллельных /start → необработанный 500
//   Нужен upsert: findOneAndUpdate({ telegramId }, ..., { upsert: true })

// deductTokens: оптимистичная блокировка (3 retry)
//   Условие: все 3 баланса = прочитанным значениям
//   ⚠️ Высокая вероятность retry при любом параллельном изменении баланса

// checkDailyLimit: findById + findByIdAndUpdate = НЕ АТОМАРНО
//   ⚠️ Overshoot лимита при параллельных запросах
//   Нужен: findOneAndUpdate({ dailyGenerations: { $lt: maxDaily } }, $inc)

// updateSettings: $set заменяет весь объект settings
//   { theme: 'dark' } → стирает defaultTextModel, language, notifications
Индексы User (недостающие)

Typescript

// Есть:
{ telegramId: 1 } unique sparse partialFilter
{ email: 1 }      unique sparse partialFilter
{ googleId: 1 }   unique sparse partialFilter
{ username: 1 }, { role: 1 }, { createdAt: -1 }, { isDeleted: 1 }

// ⚠️ Отсутствуют но нужны:
{ lastActiveAt: 1 }               // getStats() full scan
{ isActive: 1, referralCount: -1 } // getLeaderboard() без индекса
{ isBanned: 1 }, { isActive: 1 }  // admin фильтрация
// referralCode: есть unique sparse через @Prop, но стоит проверить
📨 GET /users/me и AuthResponseDto

Typescript

// ⚠️ totalBalance = tokenBalance + bonusTokens (BEZ cashbackBalance)
// ⚠️ cashbackBalance отсутствует в ответе
// ⚠️ isBanned отсутствует в ответе
// ⚠️ subscriptionActive: plan !== 'free' (литерал, не enum) && expiresAt !== null && > now
// ⚠️ Бессрочные подписки (expiresAt: null) → isActive: false
📱 Telegram Bot

Typescript

// Команды: /start, /help, /balance, /ref
// Telegraf через TelegrafModule.forRootAsync

// /start флоу:
//   1. findByTelegramId → wasNew (⚠️ race condition)
//   2. findOrCreateByTelegram → user
//   3. если wasNew && referredBy → recordReferral (идемпотентен)
//   4. Приветствие с хардкодом '9 спичек'

// ⚠️ catch {} в /balance и /ref — нет логирования ошибок
// ⚠️ resolveBotUsername() в /ref → HTTP к Telegram API при TTL miss (до 5 сек latency)
// ⚠️ 'https://t.me/spichki_support' — хардкод ссылки поддержки
🗄️ Storage

Typescript

// S3 (Timeweb): forcePathStyle: true
// ⚠️ UploadController (Блок 11) создаёт СВОЙ S3Client, игнорирует StorageService
// ⚠️ КОНФЛИКТ: два контроллера @Controller('upload') регистрируют POST /upload/image

// StorageService.downloadAndSave():
//   При ошибке: { s3Url: originalUrl, key: '', size: 0 }
//   ⚠️ провайдерские URL протухают через 24-72ч

// GET /upload/download (SSRF):
//   allowlist через hostname.includes('suno') → 'evil-suno.com' проходит
//   Нужна точная проверка: hostname === d || hostname.endsWith('.' + d)
//   ⚠️ Публичный эндпоинт (нет JWT guard) → abuse как proxy

// scheduleDelete: setTimeout → не переживает рестарт приложения
//   Нужен Bull job или S3 Lifecycle Policy
🔗 Граф зависимостей модулей

Typescript

// forwardRef используется везде — признак циклических зависимостей:
AuthModule      → UsersModule, ReferralModule
BillingModule   → UsersModule, ReferralModule, AiProvidersModule (через forwardRef)
AiProvidersModule → BillingModule
ChatModule      → AiProvidersModule, UsersModule, BillingModule
GenerationModule → AiProvidersModule, UsersModule, BillingModule
AdminModule     → UsersModule, AiProvidersModule, BillingModule, ReferralModule
TelegramBotModule → UsersModule, ReferralModule

// AnalyticsModule: @Global() → доступен везде без imports
// StorageModule: экспортирует StorageService
// UploadModule: импортирует StorageModule (правильно)
// WebhooksModule: нет зависимостей
// HealthModule: нет зависимостей
// FavoritesModule: нет зависимостей
// SupportModule: нет зависимостей
🔴 Критичные проблемы (сводная таблица)

#	Проблема	Модуль	Описание
1	Race condition регистрации	Users/Auth/TgBot	findOne+save не атомарны → duplicate key 500
2	Двойное начисление токенов при подписке	Billing	handlePaymentWebhook + activateSubscription оба вызывают addTokens
3	Неатомарный флоу генерации	Generation	save→deduct→queue без транзакции → вечный PENDING
4	Race condition dailyLimit	Users	findById+update не атомарно → overshoot
5	Race condition recordSuccessfulGeneration	Generation	billingRecorded не atomic check → дубль транзакции
6	cashbackBalance не в totalBalance	Auth/Users/Chat/Gen	Пользователь не видит кэшбек, получает отказ
7	SSRF в /upload/download	Storage	allowlist via .includes() → hostname bypass
8	Race condition PromoCode.markUsed	Billing	findById→save не атомарно → превышение maxUses
9	Webhook поиск без провайдера	Billing	externalPaymentId без paymentProvider → коллизия
10	Конфликт POST /upload/image	Storage/Upload	Два контроллера на один route
11	Дублирование user message в контексте	Chat	buildContext добавляет уже сохранённое сообщение
12	Stars webhook без верификации	Billing	verifyWebhook всегда success:true
13	YooKassa webhook без верификации	Billing	Нет проверки IP или HMAC
14	Race condition createWithdrawal	Referral	Двойное резервирование cashback
15	SBP валидация	Referral	'+7 (999) 123-45-67' не проходит regex
16	WS Gateway не масштабируется	Generation	In-memory Map не шарится между инстансами
17	PENDING генерации без recovery	Generation	Нет cron для застрявших задач
18	openrouter-image slug коллизия	AiProviders	Перезапись в БД при syncProvidersToDB
🟡 Системные проблемы (сквозные)

Typescript

// 1. cashbackBalance нигде не включён в totalBalance (Auth, Users, Chat, Generation)
//    Везде: tokenBalance + bonusTokens  (нужно + cashbackBalance)

// 2. maxDailyGenerations: 999999 вместо null/-1 (seed, checkDailyLimit)

// 3. Нет константы INITIAL_BONUS_TOKENS = 9
//    Хардкод в UsersService И в TelegramBotUpdate

// 4. SubscriptionPlan в PromoCode схеме: ['pro', 'premium'] — оба устарели
//    Нельзя создать промокод на PLUS/MAX/ULTIMATE

// 5. Два алгоритма matchPricingTier (PricingService ≠ BillingService)
//    Preview и реальное списание могут расходиться

// 6. userId через req.user?.id || req.user?._id (UploadModule, StorageModule)
//    JWT payload содержит sub, не id → userId = 'anonymous'
//    Везде нужен @CurrentUser('sub')

// 7. page/limit без ParseIntPipe во многих контроллерах
//    (Favorites, Support, Referral) → NaN при невалидном вводе

// 8. Нет проверки NODE_ENV в scripts → prod может быть изменён случайно

// 9. getHealth(): всегда HTTP 200 даже при mongo: 'disconnected'
//    k8s liveness probe не сработает при падении БД

// 10. Support sort по priority как строка: 'high' < 'low' < 'medium'
//     → высокие тикеты в конце списка
📡 Полная карта API эндпоинтов


AUTH:
POST /auth/telegram                                    [public]
POST /auth/telegram-widget                             [public]
POST /auth/dev                                         [public, dev only]
GET  /auth/refresh                                     [JWT]

USERS:
GET  /users/me                                         [JWT]
PUT  /users/me/settings                                [JWT]

BILLING:
GET  /billing/packages                                 [public]
GET  /billing/plans                                    [public]
GET  /billing/balance                                  [JWT]
POST /billing/pay/tokens                               [JWT]
POST /billing/pay/subscription                         [JWT]
POST /billing/promo                                    [JWT]
POST /billing/promo/preview                            [JWT]
GET  /billing/transactions                             [JWT]
POST /billing/webhook/yookassa                         [no auth]
POST /billing/webhook/cryptomus                        [no auth]
POST /billing/webhook/freedompay                       [no auth, XML response]
POST /billing/webhook/tochka                           [no auth, text/plain JWT]
POST /billing/webhook/heleket                          [no auth]

CHAT:
GET  /chat/conversations                               [JWT]
GET  /chat/conversations/:id/messages                  [JWT]
DELETE /chat/conversations/:id                         [JWT]
PUT  /chat/conversations/:id/rename                    [JWT]
PUT  /chat/conversations/:id/pin                       [JWT]
POST /chat/send                                        [JWT, throttle 10/60s]
POST /chat/stream                                      [JWT, throttle 10/60s, SSE]

GENERATION:
POST /generation/image                                 [JWT, throttle 5/60s]
POST /generation/video                                 [JWT, throttle 3/60s]
POST /generation/audio                                 [JWT, throttle 5/60s]
POST /generation/calculate-price                       [JWT, no throttle]
GET  /generation/models/:slug/ui-config                [JWT]
GET  /generation/status/:id                            [JWT]
GET  /generation/history                               [JWT]
GET  /generation/favorites                             [JWT]
PUT  /generation/:id/favorite                          [JWT]

MODELS:
GET  /models                                           [JWT]
GET  /models/:slug                                     [JWT]
GET  /models/:slug/pricing                             [JWT]
GET  /models/:slug/preview-cost                        [JWT]
GET  /models/:slug/estimate?params=JSON                [JWT]

FAVORITES:
POST /favorites/toggle                                 [JWT]
GET  /favorites                                        [JWT]

REFERRAL:
GET  /referral/stats                                   [JWT]
GET  /referral/info                                    [JWT]
POST /referral/withdraw                                [JWT]
GET  /referral/withdrawals                             [JWT]

SUPPORT:
POST /support/tickets                                  [JWT]
GET  /support/tickets                                  [JWT]
POST /support/tickets/:id/message                      [JWT]

ANALYTICS:
POST /analytics/track                                  [JWT]
POST /analytics/track/batch                            [JWT]
GET  /analytics/stats                                  [JWT, ADMIN+]
GET  /analytics/platforms                              [JWT, ADMIN+]

UPLOAD (Блок 14 — UploadModule):
POST /upload/audio                                     [JWT, multipart, 10MB, auto-delete 1h]
POST /upload/image                                     [JWT, multipart, 10MB, auto-delete 1h]

UPLOAD (Блок 11 — StorageModule):
POST /upload/image                                     [JWT, multipart, 10MB]  ⚠️ КОНФЛИКТ
GET  /upload/download?url=&filename=                   [no auth, proxy]

WEBHOOKS:
POST /webhooks/kie-callback                            [no auth, заглушка]

HEALTH:
GET  /health                                           [no auth]

ADMIN — основной:
GET  /admin/check                                      [JWT, ADMIN+]
GET  /admin/dashboard                                  [JWT, ADMIN+]
GET  /admin/users                                      [JWT, ADMIN+]
GET  /admin/users/:id                                  [JWT, ADMIN+]
PUT  /admin/users/:id/role                             [JWT, SUPER_ADMIN]
PUT  /admin/users/:id/ban                              [JWT, ADMIN+]
POST /admin/users/:id/adjust-balance                   [JWT, ADMIN+]
DELETE /admin/users/:id                                [JWT, ADMIN+]
GET  /admin/providers                                  [JWT, ADMIN+]
PUT  /admin/providers/:slug                            [JWT, ADMIN+]
GET  /admin/models                                     [JWT, ADMIN+]
GET  /admin/models/:slug                               [JWT, ADMIN+]
POST /admin/models                                     [JWT, SUPER_ADMIN]
PUT  /admin/models/:slug                               [JWT, ADMIN+]
POST /admin/models/:slug/toggle                        [JWT, ADMIN+]
DELETE /admin/models/:slug                             [JWT, SUPER_ADMIN]
GET  /admin/analytics/revenue                          [JWT, ADMIN+]
GET  /admin/analytics/generations                      [JWT, ADMIN+]
GET  /admin/analytics/models                           [JWT, ADMIN+]
GET  /admin/settings/tokenomics                        [JWT, ADMIN+]
PUT  /admin/settings/tokenomics                        [JWT, SUPER_ADMIN]

ADMIN — биллинг:
GET  /admin/plans                                      [JWT, ADMIN+]
GET  /admin/plans/:id                                  [JWT, ADMIN+]
POST /admin/plans                                      [JWT, SUPER_ADMIN]
PUT  /admin/plans/:id                                  [JWT, ADMIN+]
POST /admin/plans/:id/toggle                           [JWT, ADMIN+]
DELETE /admin/plans/:id                                [JWT, SUPER_ADMIN]
GET  /admin/token-packages                             [JWT, ADMIN+]
GET  /admin/token-packages/:id                         [JWT, ADMIN+]
POST /admin/token-packages                             [JWT, SUPER_ADMIN]
PUT  /admin/token-packages/:id                         [JWT, ADMIN+]
POST /admin/token-packages/:id/toggle                  [JWT, ADMIN+]
DELETE /admin/token-packages/:id                       [JWT, SUPER_ADMIN]

ADMIN — промокоды:
GET  /admin/promo-codes                                [JWT, ADMIN+]
GET  /admin/promo-codes/:id                            [JWT, ADMIN+]
GET  /admin/promo-codes/:id/stats                      [JWT, ADMIN+]
POST /admin/promo-codes                                [JWT, ADMIN+]
PUT  /admin/promo-codes/:id                            [JWT, ADMIN+]
POST /admin/promo-codes/:id/toggle                     [JWT, ADMIN+]
DELETE /admin/promo-codes/:id                          [JWT, SUPER_ADMIN]

ADMIN — транзакции:
GET  /admin/transactions                               [JWT, ADMIN+]
GET  /admin/transactions/stats                         [JWT, ADMIN+]
GET  /admin/transactions/:id                           [JWT, ADMIN+]

ADMIN — рефералы:
GET  /admin/referral/withdrawals                       [JWT, ADMIN+]
GET  /admin/referral/withdrawals/summary               [JWT, ADMIN+]
PATCH /admin/referral/withdrawals/:id/approve          [JWT, ADMIN+]
PATCH /admin/referral/withdrawals/:id/paid             [JWT, ADMIN+]
PATCH /admin/referral/withdrawals/:id/reject           [JWT, ADMIN+]
GET  /admin/referral/top-referrers                     [JWT, ADMIN+]

// ─── ИТОГО ────────────────────────────────────────────────────
// Всего эндпоинтов: ~85
// Публичных (no auth): 5  (/auth/telegram, /auth/telegram-widget,
//                          /billing/packages, /billing/plans, /health)
// Без auth (webhooks/proxy): 7
// JWT (user): ~35
// JWT (ADMIN+): ~30
// JWT (SUPER_ADMIN): ~10
//
// ⚠️ КОНФЛИКТ: POST /upload/image зарегистрирован дважды
//    (StorageModule и UploadModule)
// ⚠️ /models/* требует JWT — нет публичного каталога моделей
// ⚠️ /generation/calculate-price без throttle — price discovery abuse
// ⚠️ /upload/download без JWT — proxy abuse
// ⚠️ /auth/dev без NODE_ENV guard — если не задан, эндпоинт открыт

🌍 Переменные окружения (полный список)

Bash

# Core
NODE_ENV=development|production
PORT=3001

# MongoDB
MONGODB_URI=mongodb://...

# Redis (Bull queue)
REDIS_HOST=
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT
JWT_SECRET=                    # обязательный
JWT_EXPIRATION=7d              # опциональный

# Telegram
TELEGRAM_BOT_TOKEN=            # обязательный для prod auth
TELEGRAM_BOT_USERNAME=
TG_BOT_TOKEN=                  # алиас (читается в telegram-bot модуле)
TG_BOT_USERNAME=               # алиас
BOT_TOKEN=                     # алиас
BOT_USERNAME=                  # алиас
MINI_APP_URL=                  # URL фронтенда Mini App
FRONTEND_URL=                  # алиас

# Admin
ADMIN_TG_IDS=123,456           # через запятую
SUPER_ADMIN_TG_IDS=789

# AI Providers
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

EVOLINK_API_KEY=
EVOLINK_BASE_URL=https://api.evolink.ai/v1   # ⚠️ уже с /v1

KIE_API_KEY=
KIE_BASE_URL=https://api.kie.ai              # ⚠️ без /v1

REPLICATE_API_KEY=

# Payment — YooKassa
YOOKASSA_SHOP_ID=
YOOKASSA_SECRET_KEY=

# Payment — Cryptomus
CRYPTOMUS_MERCHANT_ID=
CRYPTOMUS_API_KEY=

# Payment — Telegram Stars (через Bot API)
# использует TELEGRAM_BOT_TOKEN

# Payment — FreedomPay
FREEDOMPAY_MERCHANT_ID=        # number
FREEDOMPAY_SECRET_KEY=
FREEDOMPAY_BASE_URL=
FREEDOMPAY_CURRENCY=KZT
FREEDOMPAY_TESTING_MODE=0|1    # number
FREEDOMPAY_RUB_TO_KZT=5.7
FREEDOMPAY_USD_TO_KZT=
API_PUBLIC_URL=                # для webhook URL
TG_BOT_USERNAME=               # для redirect URL

# Payment — Heleket
HELEKET_MERCHANT_ID=           # или HELEKET_MERCHANT_UUID
HELEKET_API_KEY=               # или HELEKET_PAYMENT_API_KEY
HELEKET_BASE_URL=https://api.heleket.com
HELEKET_WEBHOOK_URL=
HELEKET_RETURN_URL=

# Payment — Tochka (⚠️ не в configuration.ts — читается напрямую)
TOCHKA_JWT=                    # долгосрочный токен от банка
TOCHKA_CUSTOMER_CODE=
TOCHKA_MERCHANT_ID=
TOCHKA_CLIENT_ID=
TOCHKA_API_URL=https://enter.tochka.com/uapi
TOCHKA_PUBLIC_KEY=             # RSA публичный ключ (с \n)
TOCHKA_VERIFY_SIGNATURE=true   # 'false' для dev
TOCHKA_REDIRECT_URL=
TOCHKA_FAIL_REDIRECT_URL=
TOCHKA_PAYMENT_TTL_MIN=60

# S3 (Timeweb)
S3_ENDPOINT=https://s3.timeweb.cloud
S3_BUCKET=ai-generations
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_REGION=ru-1
S3_PUBLIC_URL=                 # ⚠️ если пусто — невалидные URL файлов

# Support
SUPPORT_URL=                   # ⚠️ НЕ используется, хардкод в TelegramBotUpdate
📐 Константы и магические числа

Typescript

// ─── Токены и баланс ───────────────────────────────────────────
INITIAL_BONUS_TOKENS     = 9        // ⚠️ нет константы — хардкод в 2 местах
TOKEN_PRECISION          = 2        // знаков после запятой
FLOAT_EPSILON            = 1e-9
MIN_CHARGE_TOKENS        = 0.01
MAX_DEDUCT_RETRIES       = 3        // оптимистичная блокировка

// ─── Генерации ─────────────────────────────────────────────────
MAX_POLL_ATTEMPTS        = 120
POLL_INTERVAL_MS         = 5000     // 5 сек → максимум 10 минут polling
MAX_CONSECUTIVE_FAILURES = 3
QUEUE_ATTEMPTS_IMAGE     = 3
QUEUE_ATTEMPTS_VIDEO     = 2
QUEUE_BACKOFF_IMAGE_MS   = 3000     // exponential
QUEUE_BACKOFF_VIDEO_MS   = 5000
JOB_TIMEOUT_IMAGE_MS     = 300000   // 5 минут
JOB_TIMEOUT_VIDEO_MS     = 600000   // 10 минут
QUEUE_REMOVE_ON_COMPLETE = 50
QUEUE_REMOVE_ON_FAIL     = 20

// ─── Чат ───────────────────────────────────────────────────────
MAX_CONTEXT_MESSAGES     = 20       // хардкод в buildContext
CHAT_THROTTLE_LIMIT      = 10       // запросов
CHAT_THROTTLE_TTL        = 60       // секунд

// ─── Биллинг ───────────────────────────────────────────────────
RUB_TO_USD_RATE          = 75       // хардкод, не обновляется
REFERRAL_CASHBACK_RATE   = 0.10     // 10%
TOKEN_TO_DOLLAR_RATE     = 0.01     // 1 спичка = $0.01 (TokenomicsSettings)
FREE_TOKENS_ON_SIGNUP    = 50       // TokenomicsSettings default
                                    // ⚠️ расходится с хардкодом 9 в коде

// ─── Рефералы ──────────────────────────────────────────────────
REFERRAL_SIGNUP_BONUS    = 10       // бонус инвайтеру при регистрации реферала
MIN_WITHDRAWAL           = 100      // минимум на вывод (спичек)
MAX_WITHDRAWAL           = 100000
REFERRAL_CODE_LENGTH     = 8        // символов hex из uuid

// ─── Storage ───────────────────────────────────────────────────
UPLOAD_MAX_FILE_SIZE     = 10MB     // для image и audio upload
UPLOAD_AUTO_DELETE_TTL   = 3600000  // 1 час в мс
S3_DOWNLOAD_TIMEOUT      = 120000   // 2 минуты
AXIOS_DOWNLOAD_TIMEOUT   = 60000    // 1 минута

// ─── Analytics ─────────────────────────────────────────────────
ANALYTICS_TTL_DAYS       = 90       // TTL индекс — данные старше 3 мес. удаляются

// ─── Подписки ──────────────────────────────────────────────────
MAX_DAILY_GENERATIONS_UNLIMITED = 999999  // семантический "безлимит"
SUBSCRIPTION_MIGRATION_CRON = '0 3 * * *' // каждый день в 3:00
HEALTHCHECK_CRON         = '0 */5 * * * *' // каждые 5 минут

// ─── Auth ──────────────────────────────────────────────────────
INIT_DATA_MAX_AGE_PROD   = 86400    // 24 часа (initData)
INIT_DATA_MAX_AGE_DEV    = 2592000  // 30 дней
BOT_USERNAME_CACHE_TTL   = 3600000  // 1 час (ReferralService)
TOCHKA_RETRY_ATTEMPTS    = 3
TOCHKA_RETRY_BASE_MS     = 300
🏷️ Перечисления (Enums)

Typescript

// ─── Пользователи ──────────────────────────────────────────────
AuthProvider   { TELEGRAM='telegram', EMAIL='email', GOOGLE='google' }
               // ⚠️ GOOGLE есть в enum, реализации нет
UserRole       { USER='user', PREMIUM='premium', ADMIN='admin', SUPER_ADMIN='super_admin' }
               // ⚠️ PREMIUM есть в enum, нигде не применяется

// ─── Подписки ──────────────────────────────────────────────────
SubscriptionPlan {
  FREE='free', BASIC='basic', PLUS='plus', MAX='max', ULTIMATE='ultimate',
  PRO='pro',          // @deprecated → PLUS
  UNLIMITED='unlimited' // @deprecated → MAX/ULTIMATE
}

// ─── Генерации ─────────────────────────────────────────────────
GenerationType   { TEXT='text', IMAGE='image', VIDEO='video', AUDIO='audio' }
GenerationStatus { PENDING, PROCESSING, COMPLETED, FAILED, CANCELLED }

// ─── Транзакции ────────────────────────────────────────────────
TransactionType {
  DEPOSIT, WITHDRAWAL, GENERATION, REFUND,
  REFERRAL_BONUS, PROMO_CODE, SUBSCRIPTION, ADMIN_ADJUSTMENT
}
PaymentStatus { PENDING, COMPLETED, FAILED, REFUNDED }

// ─── Промокоды ─────────────────────────────────────────────────
PromoCodeType { BONUS_TOKENS, DISCOUNT_PERCENT, DISCOUNT_RUB, SUBSCRIPTION_DAYS }
PromoApplyTo  { ANY, SUBSCRIPTION, TOKEN_PACKAGE, STANDALONE }

// ─── Рефералы ──────────────────────────────────────────────────
WithdrawalMethod { CARD='card', SBP='sbp', CRYPTO='crypto' }
WithdrawalStatus { PENDING, APPROVED, REJECTED, PAID }

// ─── Поддержка ─────────────────────────────────────────────────
TicketStatus   { OPEN, IN_PROGRESS, RESOLVED, CLOSED }  // строки, не enum!
TicketPriority { LOW, MEDIUM, HIGH }                     // строки, не enum!
               // ⚠️ sort({ priority: -1 }) → 'medium' > 'low' > 'high'
               //    HIGH тикеты оказываются последними в списке
🔄 Фоновые задачи (Cron + Bull)

Typescript

// ─── Cron задачи ───────────────────────────────────────────────

// BillingService:
@Cron('0 3 * * *')  // каждый день в 3:00
migratePlanNames()  // PRO→PLUS, UNLIMITED→ULTIMATE

// AiProvidersModule/ProviderRegistryService:
@Cron('0 */5 * * * *')  // каждые 5 минут
healthCheckAll()    // проверка всех AI провайдеров → обновление в БД

// ─── Bull Queue: 'generation' ──────────────────────────────────
Process: 'process-generation'
  → GenerationConsumer.handleGeneration()
  → sync result → saveToStorage → recordBilling → WS:completed
  → async result → pollTaskUntilComplete (120 попыток × 5с)
  → @OnQueueFailed → refundGeneration (идемпотентно через isRefunded)

// ─── Отсутствующие фоновые задачи (нужны но не реализованы) ───
// Нет cron для PENDING генераций без Bull job (recovery)
// Нет cron для истёкших подписок (только при логине проверяется)
// Нет обновления курса RUB/USD (хардкод 75)
// Нет прогрева кэша botUsername при старте (делается при первом запросе)
🗺️ Паттерны кода (используемые в проекте)

Typescript

// ─── Идемпотентность ───────────────────────────────────────────
// Правильно реализовано:
generation.billingRecorded   // защита от дубля транзакции
generation.isRefunded        // защита от двойного рефанда
$setOnInsert в seed-billing  // не перезаписывает существующие планы
$exists: false в миграции    // не трогает уже мигрированные поля

// ⚠️ НЕ реализована идемпотентность:
PromoCode.markUsed()         // findById→save, не атомарно
createWithdrawal()           // findOne→save, не атомарно
findOrCreateByTelegram()     // findOne→save, не атомарно

// ─── Оптимистичная блокировка ──────────────────────────────────
// deductTokens: условие фильтра содержит все три значения баланса
// MAX_DEDUCT_RETRIES = 3 попытки
// ⚠️ Высокая вероятность retry при любом параллельном изменении

// ─── Fire-and-forget трекинг ───────────────────────────────────
// AnalyticsService.track() вызывается без await
// Ошибки глотаются (logger.warn)
// Правильный паттерн: не блокирует основной флоу

// ─── Fallback цепочки ──────────────────────────────────────────
// AiProvidersService.executeWithFallback():
//   провайдер1 → провайдер2 → ... → ALL_PROVIDERS_FAILED
// StorageService.downloadAndSave():
//   S3 upload → при ошибке возвращает оригинальный URL (протухнет!)

// ─── Cache паттерны ────────────────────────────────────────────
// BillingService: plansCache/packagesCache (in-memory, TTL 60s)
// ReferralService: botUsernameCache (in-memory, TTL 1h)
// ⚠️ Все кэши in-memory → не шарятся между инстансами
// ⚠️ Нет Redis-кэша для часто читаемых данных (модели, планы)

// ─── Soft delete ───────────────────────────────────────────────
// User: isDeleted=true, deletedAt, deletedBy + анонимизация полей
// AIModel: isActive=false (не удаляется физически)
// ⚠️ Транзакции и генерации удалённых пользователей не анонимизируются

// ─── Populate стратегия ────────────────────────────────────────
// Большинство запросов НЕ используют populate (возвращают ID)
// Исключения:
//   AdminService.getUserById: populate referrer
//   SupportService.getAllTickets: populate userId
//   AdminTransactionsService.topSpenders: $lookup на users
🔐 Безопасность — сводная таблица

Typescript

// ─── Верификация webhook-ов ────────────────────────────────────
YooKassa:      ❌ нет верификации (принимает любой запрос)
Cryptomus:     ✅ MD5 подпись
Telegram Stars:❌ verifyWebhook всегда success:true
FreedomPay:    ✅ MD5 + script name
Tochka:        ✅ RS256 JWT (с возможностью отключить через env)
Heleket:       ✅ MD5 + timingSafeEqual + два варианта сериализации
KIE callback:  ❌ нет верификации (заглушка)

// ─── Открытые эндпоинты ────────────────────────────────────────
GET  /health                   [ok — намеренно публичный]
GET  /billing/packages         [ok]
GET  /billing/plans            [ok]
POST /auth/telegram            [ok]
POST /auth/telegram-widget     [ok]
POST /auth/dev                 [⚠️ только если NODE_ENV задан]
GET  /upload/download          [⚠️ proxy без auth, SSRF риск]
POST /billing/webhook/*        [намеренно без auth]
POST /webhooks/kie-callback    [⚠️ нет верификации]

// ─── SSRF / Injection ──────────────────────────────────────────
GET /upload/download:
  hostname.includes('suno') → 'evil-suno.com' проходит
  hostname.includes('kie')  → 'kie.evil.com' проходит
  Нужна: hostname === d || hostname.endsWith('.' + d)

// ─── Sensitive данные ──────────────────────────────────────────
Withdrawal.requisites: хранится открытым текстом (номер карты, телефон)
passwordHash: select:false (скрыт из большинства запросов, ✅)
email: select:false объявлен, но НЕ применён (⚠️ видна в ответах)
Логирование webhook body: первые 500 символов (может содержать sensitive)

// ─── Rate limiting ─────────────────────────────────────────────
/chat/send, /chat/stream:       Throttle 10/60s ✅
/generation/image, /audio:      Throttle 5/60s  ✅
/generation/video:              Throttle 3/60s  ✅
/generation/calculate-price:    ❌ нет throttle
/analytics/track/batch:         ❌ нет лимита размера массива
/upload/download:               ❌ нет rate limit
Все остальные:                  нет явного throttle
🏦 Финансовый флоу (сводная схема)


Покупка токенов/подписки:
  POST /billing/pay/tokens|subscription
    → создать Transaction(PENDING) + externalPaymentId
    → создать платёж у провайдера
    → вернуть paymentUrl

  Webhook от провайдера:
    → verifyWebhook
    → найти Transaction по externalPaymentId  ⚠️ без paymentProvider
    → PENDING → COMPLETED:
        addTokens(amount)              ← токены
        activateSubscription()         ← ⚠️ тоже вызывает addTokens → двойное начисление
        processReferralBonus(10%)      ← кэшбек рефереру
        markPromoCodeUsed()            ← если был промокод

Генерация (списание):
  POST /generation/image|video|audio
    → pricingService.calculatePrice()  ← preview алгоритм
    → validateBalance()                ⚠️ без cashbackBalance
    → generation.save(PENDING)
    → deductTokens()                   ← фактическое списание (bonusTokens→cashback→token)
    → queue.add()

  Bull worker:
    → AI провайдер (sync/async polling)
    → saveToStorage (S3)
    → recordSuccessfulGeneration()
        → billingService.recordMediaGeneration()
           → createTransaction(GENERATION, balanceBefore≈balanceAfter+cost)
    → WebSocket: generation:completed

  При ошибке (все попытки исчерпаны):
    → refundGeneration()
        → usersService.refundTokens()
        → billingService.recordRefund()
        → generation.isRefunded = true

Реферальная программа:
  Регистрация реферала → инвайтер +10 bonusTokens
  Покупка реферала     → инвайтер +10% от суммы в cashbackBalance
  Вывод кэшбека        → Withdrawal(PENDING)
    → reserveCashbackForWithdrawal (атомарный $inc)
    → Withdrawal.save()
    Admin: PENDING → APPROVED → PAID
           PENDING|APPROVED → REJECTED → refundCashback
📦 Зависимости (package.json — ключевые)

Typescript

// Framework:
@nestjs/core, @nestjs/common, @nestjs/platform-express

// Database:
@nestjs/mongoose, mongoose

// Queue:
@nestjs/bull, bull   // Redis-based queue для генераций

// Auth:
@nestjs/jwt, @nestjs/passport, passport, passport-jwt

// WebSocket:
@nestjs/websockets, @nestjs/platform-socket.io, socket.io

// Telegram:
nestjs-telegraf, telegraf

// S3:
@aws-sdk/client-s3

// HTTP:
axios

// Validation:
class-validator, class-transformer

// Crypto:
crypto (Node built-in)  // HMAC-SHA256, MD5

// Scheduling:
@nestjs/schedule        // Cron задачи

// Config:
@nestjs/config          // ConfigModule/ConfigService

// ⚠️ Нет:
// @nestjs/throttler глобально (используется локально)
// Redis adapter для Socket.IO (нет горизонтального масштабирования WS)
// winston/pino (используется стандартный NestJS Logger)
// Sentry/DataDog (нет APM)
// mongoose-paginate / mongoose-aggregate-paginate
🧩 Связи между модулями (что откуда вызывает)

Typescript

// GenerationModule → BillingService:
//   preChargeMediaGeneration, recordMediaGeneration, refundGeneration

// ChatModule → BillingService:
//   chargeForGeneration (text)

// AuthModule → UsersService:
//   findOrCreateByTelegram, findByTelegramId, findById

// AuthModule → ReferralService:
//   recordReferral (при регистрации)

// BillingModule → UsersService:
//   addTokens, deductTokens, refundTokens, addBonusTokens,
//   addCashback, updateSubscription, reserveCashbackForWithdrawal

// BillingModule → ReferralService:
//   markReferralPurchase (при успешной оплате)

// AdminModule → BillingService:
//   invalidateBillingCache (при изменении планов/пакетов)

// TelegramBotModule → UsersService:
//   findByTelegramId, findOrCreateByTelegram

// TelegramBotModule → ReferralService:
//   recordReferral, getReferralInfo

// AnalyticsModule (@Global) → используется в:
//   GenerationService (generation_start, generation_completed)
//   BillingService (payment_init, payment_completed)
//   AuthService (user_registered)
//   ChatService (неявно через GenerationService)

// StorageModule → используется в:
//   GenerationConsumer (saveToStorage)
//   UploadModule (через StorageService)
⚠️ Известные архитектурные проблемы

Typescript

// 1. ОТСУТСТВУЮЩИЙ ADMIN HTTP-доступ:
//    SupportService: getAllTickets, closeTicket — только в сервисе, нет контроллера
//    ReferralService: adminApprove/Reject/MarkPaid — есть в AdminModule контроллере ✅
//    SupportModule: AdminController отсутствует — саппорт не может работать через API

// 2. ДУБЛИРОВАНИЕ ЛОГИКИ:
//    matchPricingTier (BillingService) ≠ findMatchingRule (PricingService)
//    getExtension (StorageService) дублируется в UploadModule
//    S3Client создаётся в StorageService И в storage/UploadController
//    Vision validation дублируется в Chat sendMessage и streamMessage
//    Auth флоу (telegram, widget, dev) повторяется 3 раза без общего метода

// 3. DEPRECATED КОД:
//    AuthProvider.GOOGLE — enum есть, реализации нет
//    UserRole.PREMIUM — enum есть, нигде не применяется в guards
//    SubscriptionPlan.PRO и UNLIMITED — мигрируются при старте
//    model.tokenCost — поле используется как fallback в ModelsService,
//      но отсутствует в AIModel схеме (возвращает undefined)
//    providerCostPerMillion* — справочные поля, не влияют на списание

// 4. ОТСУТСТВУЮЩАЯ ФУНКЦИОНАЛЬНОСТЬ:
//    Email/Google авторизация (только интерфейсы)
//    Публичный каталог моделей (все /models/* требуют JWT)
//    Бессрочные подписки (expiresAt: null → isActive: false)
//    Admin эндпоинты для Support
//    Уведомления о новых тикетах поддержки
//    Уведомления пользователю об ответе саппорта
//    Обновление курса RUB/USD (хардкод 75)
//    Recovery для застрявших PENDING генераций

// 5. ГОРИЗОНТАЛЬНОЕ МАСШТАБИРОВАНИЕ:
//    WS Gateway: userSockets Map — in-memory, нет Redis adapter
//    BillingService: plansCache/packagesCache — in-memory
//    ReferralService: botUsernameCache — in-memory
//    scheduleDelete: setTimeout — не переживает рестарт
//    При 2+ инстансах WS события не доходят до нужного клиента
✅ Что реализовано правильно

Typescript

// Идемпотентность где критично:
//   billingRecorded, isRefunded — защита от дублей при Bull retry
//   $exists: false в миграциях — можно запускать повторно
//   Referral.referredId: UNIQUE — нельзя привязать двух рефереров

// Атомарность где есть:
//   deductTokens: оптимистичная блокировка с retry
//   reserveCashbackForWithdrawal: атомарный $inc
//   Withdrawal.adminReject: статус меняется ДО возврата денег

// Безопасность:
//   passwordHash, email: select:false
//   Tochka webhook: RS256 верификация
//   Heleket: timingSafeEqual против timing attacks
//   Withdrawal.requisites маскируется при выдаче
//   TelegramAuthGuard: HMAC-SHA256 + auth_date проверка
//   JwtStrategy: актуальная роль из БД (не из токена)

// Производительность:
//   Transaction индексы покрывают все основные запросы
//   Analytics TTL 90 дней — автоочистка старых данных
//   BillingService cache 60s для планов/пакетов
//   ProviderRegistryService health check каждые 5 минут
//   ordered: false в insertMany аналитики

// Структура:
//   Единый BaseProvider abstract class
//   Fallback между провайдерами через executeWithFallback
//   pricingMatrix + uiParameters для динамической конфигурации UI
//   Soft delete + анонимизация для Users
//   AdminBootstrapService синхронизирует роли через env

🚀 Порядок инициализации приложения (Bootstrap)

Typescript

// main.ts — последовательность запуска:

// 1. NestFactory.create(AppModule)
//    → ConfigModule.forRoot()         — загрузка configuration.ts
//    → MongooseModule.forRoot()       — подключение к MongoDB
//    → BullModule.forRoot()           — подключение к Redis
//    → TelegrafModule.forRootAsync()  — инициализация бота
//    → @Global AnalyticsModule        — регистрация глобального сервиса

// 2. onModuleInit хуки (параллельно в рамках DI-графа):
//    ProviderRegistryService.onModuleInit():
//      → initializeProviders()        — создать экземпляры провайдеров
//      → syncProvidersToDB()          — upsert в коллекцию providers
//      → seedDefaultModels()          — seed/migration моделей в ai_models
//        ⚠️ При первом запуске: создаёт 40+ моделей
//        ⚠️ При обновлении: $set обновляет провайдеры, $setOnInsert не трогает цены

// 3. onApplicationBootstrap хуки:
//    BillingService.onApplicationBootstrap():
//      → migratePlanNames()           — PRO→PLUS, UNLIMITED→ULTIMATE
//    AdminBootstrapService (через AuthService):
//      → парсит ADMIN_TG_IDS и SUPER_ADMIN_TG_IDS в Set<number>

// 4. app.listen(PORT)
//    → Глобальные middleware: ValidationPipe, LoggingInterceptor,
//      GlobalExceptionFilter, TimeoutInterceptor (локальный)

// ─── Глобальная конфигурация NestJS ────────────────────────────
app.useGlobalPipes(new ValidationPipe({
  transform: true,
  whitelist: true,          // удаляет лишние поля из body
  forbidNonWhitelisted: false,  // ⚠️ не бросает при лишних полях
}))
app.useGlobalFilters(new GlobalExceptionFilter())
app.useGlobalInterceptors(new LoggingInterceptor())
// ⚠️ TimeoutInterceptor НЕ глобальный — применяется локально на контроллерах
// ⚠️ ThrottleGuard НЕ глобальный — применяется локально через @Throttle()
🚨 Обработка ошибок (Error Handling)

Typescript

// ─── GlobalExceptionFilter ─────────────────────────────────────
// Перехватывает ВСЕ необработанные исключения
// HttpException → { statusCode, message, timestamp, path }
// Error (не Http) → 500 Internal Server Error
// Логирует: метод, путь, статус, время

// ⚠️ Контроллер auth/dev бросает throw new Error() вместо HttpException
//    → вернёт 500 вместо ожидаемого 403

// ─── Паттерны по модулям ───────────────────────────────────────

// AuthModule — JwtStrategy:
catch (error) {
  throw new UnauthorizedException()  // ⚠️ глотает ВСЕ включая БД ошибки
}

// BillingService — webhook:
// Ошибки провайдера → логирует, возвращает { success: false }
// Не бросает → вебхук получает 200 (правильно для retry логики)

// GenerationConsumer:
// Ошибки провайдера → throw → Bull делает retry
// Финальный fail → @OnQueueFailed → refundGeneration
// ⚠️ Ошибки между deduct и queue.add → нет обработки → PENDING навсегда

// StorageService.downloadAndSave():
catch → return { s3Url: originalUrl, key: '', size: 0 }
// ⚠️ Caller получает "успех" с временным URL

// AnalyticsService.track():
catch → logger.warn  // fire-and-forget, не блокирует

// ReferralService при отклонении заявки:
// refundCashback упал → CRITICAL лог + adminNote += '⚠️ REFUND FAILED'
// ⚠️ Ручная обработка требуется

// TelegramBotUpdate /balance и /ref:
catch → 'Сначала нажми /start'  // ⚠️ нет логирования

// ─── HTTP коды ошибок ──────────────────────────────────────────
// 400 BadRequest:     невалидный DTO, недостаточно баланса
// 401 Unauthorized:   невалидный JWT, заблокированный пользователь
// 403 Forbidden:      нет нужной роли, чужой ресурс
// 404 NotFound:       генерация/беседа/модель не найдена
// 408 Timeout:        TimeoutInterceptor (120 сек по умолчанию)
// 409 Conflict:       (не используется, нет в проекте)
// 429 TooManyRequests: Throttle guard
// 500 Internal:       необработанные ошибки, Error вместо HttpException
// 502 BadGateway:     (не используется, нужен для /upload/download proxy errors)

// ─── Что НЕ обрабатывается явно ───────────────────────────────
// MongoDB CastError (невалидный ObjectId) → 500 вместо 404
//   Затронуто: getConversationWithAccess, getGenerationById и др.
// Mongoose ValidationError → может вернуть 500 или 400
//   Зависит от того поймает ли GlobalExceptionFilter
// Bull connection errors → задачи не ставятся в очередь (нет fallback)
// S3 connection errors → downloadAndSave fallback к URL провайдера
📝 Логирование

Typescript

// ─── Используемые логгеры ──────────────────────────────────────
// Стандартный NestJS Logger (ConsoleLogger)
// Нет structured logging (JSON формат)
// Нет внешнего сервиса (Sentry, DataDog, ELK)

// ─── LoggingInterceptor (глобальный) ──────────────────────────
// Формат: POST /api/v1/generation/image 200 - 3421ms
// Logger name: 'HTTP'
// ⚠️ Логирует только успешные ответы (tap без catchError)
// ⚠️ Не логирует тело запроса/ответа

// ─── Что логируется по модулям ────────────────────────────────
// AuthModule:
//   logger.warn при mismatch hash (dev) — ⚠️ потенциальная утечка хешей
//   logger.log при смене роли (AdminBootstrapService)
//   logger.warn при referral ошибке (проглатывается)

// ProviderRegistryService:
//   logger.log при старте каждого провайдера
//   logger.warn каждые 10 неудачных healthcheck
//   logger.log '✅ Provider X recovered' при восстановлении

// GenerationConsumer:
//   logger.log при старте обработки
//   logger.error при финальном fail
//   logger.warn при промежуточных ошибках

// BillingService:
//   logger.log при webhook обработке
//   logger.error при критических ошибках (двойной рефанд и т.п.)

// StorageService:
//   logger.error при ошибке загрузки в S3
//   logger.warn при fallback к оригинальному URL

// TelegramBotUpdate:
//   logger.log команды пользователей
//   ⚠️ НУЛЕВОЕ логирование в catch блоках /balance и /ref

// ReferralService:
//   logger.error 'CRITICAL' при неудачном refundCashback
//   logger.warn при нестандартных ситуациях

// ─── Отсутствует ───────────────────────────────────────────────
// Correlation ID между запросами
// Request ID для трассировки генерации
// Логирование времени операций с БД
// Логирование Bull job ID при создании задачи
// Structured logging для поиска в ELK/Loki
🔍 DTO Валидация — сводная таблица

Typescript

// ─── Хорошо валидировано ──────────────────────────────────────
VideoGenerationDto:
  prompt: @MaxLength(10000)
  duration: @Min(3) @Max(20)
  imageUrl: @IsUrl()

AudioGenerationDto:
  prompt: @MaxLength(5000)
  duration: @Min(1) @Max(300)
  stability, similarity: @Min(0) @Max(1)
  speed: @Min(0.25) @Max(4)
  dialogue: @ValidateNested + @Type

CreateWithdrawal (в referral.controller.ts):
  amount: @IsNumber @Min(100) @Max(100000)
  method: @IsEnum(WithdrawalMethod)
  requisites: @IsString @MinLength(4) @MaxLength(200)

// ─── Слабо валидировано ───────────────────────────────────────
ImageGenerationDto:
  prompt: @IsString (⚠️ нет MaxLength → огромный prompt к провайдеру)
  mode: @IsString (⚠️ нет @IsIn(['normal','fast','turbo']))
  version: @IsString (⚠️ нет @IsIn(['normal','pro']))
  inputUrls: @IsArray @IsString (⚠️ нет @IsUrl на элементах)

SendMessageDto (chat):
  ❌ НЕТ class-validator вообще
  content: string (нет MaxLength, нет NotEmpty)
  imageUrls: string[] (нет @IsUrl)
  temperature: number (нет @Min/@Max)
  maxTokens: number (нет @Min/@Max)

CalculatePriceDto:
  params: @IsObject (⚠️ нет ограничений на содержимое)

UpdateSettingsDto:
  ❌ НЕТ DTO вообще — @Body() settings: any

// ─── Не валидировано вообще ───────────────────────────────────
SupportModule createTicket:
  subject: string  (нет длины, нет NotEmpty)
  message: string  (нет длины, нет NotEmpty)

SupportModule addMessage:
  content: string  (нет длины, нет NotEmpty)

AdminService.createModel:
  data: any  (нет типа на уровне сервиса)

ModelsFilterDto:
  isActive: string  (⚠️ не boolean — нет @Type(() => Boolean))
  isPremium: string (⚠️ не boolean)

FavoritesController:
  page, limit: Query без @Type(() => Number) или ParseIntPipe
  → приходят как string, JS неявно приводит

// ─── Специфические проблемы ───────────────────────────────────
// AudioGenerationDto.duration @Min(3):
//   ⚠️ Для аудио Min должен быть 1, не 3 (ElevenLabs поддерживает от 1 сек)
//   Но VideoGenerationDto тоже имеет @Min(3) — одна DTO для разных типов

// @IsUrl() на imageUrls в SendMessageDto отсутствует:
//   → data:image/... (base64) не пройдёт @IsUrl() даже если добавить
//   → нужна кастомная валидация

// ⚠️ whitelist: true в ValidationPipe удаляет незадекларированные поля
//    Но forbidNonWhitelisted: false — не бросает ошибку при лишних полях
//    В результате: лишние поля молча удаляются без предупреждения
🗄️ MongoDB — паттерны запросов и производительность

Typescript

// ─── Проблемные запросы (нет индексов / full scan) ─────────────

// UsersService.getStats():овой NestJS)

// ─── Что критично покрыть тестами ────────────────────────────

// Unit тесты (изолированные):
BillingService.matchPricingTier()     // два алгоритма должны давать один результат
PricingService.findMatchingRule()
PromoCodeService.validate()           // все условия применения
UsersService.deductTokens()           // оптимистичная блокировка
BillingService.handlePaymentWebhook() // все провайдеры, все статусы

// Integration тесты (с MongoDB в памяти):
findOrCreateByTelegram()   // race condition сценарий
checkDailyLimit()          // параллельные запросы
toggleFavorite()           // concurrent toggle
markUsed() для PromoCode   // concurrent применение

// E2E тесты:
POST /auth/telegram        // валидный/невалидный initData
POST /generation/image     // полный флоу с Bull mock
POST /billing/webhook/yookassa  // payment.succeeded

// ─── Рекомендуемые инструменты ───────────────────────────────
// @nestjs/testing + supertest для E2E
// mongodb-memory-server для изолированных тестов MongoDB
// @golevelup/ts-jest для мокирования
// bull-mock для тестирования Bull очередей
📋 Сводная матрица модулей




Модуль              Контроллер  Сервис  Schema  Guards          Критичные проблемы
──────────────────────────────────────────────────────────────────────────────────
AuthModule          ✅          ✅      —       JWT,TgAuth      race condition регистрации,
                                                                cashback не в totalBalance,
                                                                isBanned после syncRole
UsersModule         ✅(2 EP)    ✅      User    JWT             race condition findOrCreate,
                                                                checkDailyLimit не атомарен,
                                                                settings перезаписывает весь объект,
                                                                нет lastActiveAt индекса
BillingModule       ✅(12 EP)   ✅×3    ×5      JWT,none        двойное начисление при подписке,
                                                                webhook без paymentProvider,
                                                                markUsed не атомарен,
                                                                Stars без верификации,
                                                                YooKassa без верификации
AiProvidersModule   ✅(5 EP)    ✅      ×2      JWT             openrouter-image slug коллизия,
                                                                N+1 в getProvidersForModel,
                                                                два алгоритма pricingTier,
                                                                deepseek-v4 inactive mapping
ChatModule          ✅(7 EP)    ✅      ×2      JWT,Throttle    дубль user message в контексте,
                                                                cashback не в балансе,
                                                                message_end с удалённым ID,
                                                                нет валидации DTO
GenerationModule    ✅(9 EP)    ✅      ×1      JWT,Throttle    неатомарный флоу save→deduct→queue,
                                                                race cond billingRecorded,
                                                                retry дублирует S3 файлы,
                                                                нет recovery для PENDING
AnalyticsModule     ✅(4 EP)    ✅      ×1      JWT,Roles       TTL 90 дней (нет истории),
                                                                нет batch size limit,
                                                                нет enum событий
AdminModule         ✅(35 EP)   ✅×4    ×1      JWT,Roles       cashback не в revenue,
                                                                forwardRef на 4 модуля,
                                                                isActive/isPremium как string
ModelsModule        ✅(2 EP)    ✅      —       JWT             неверный расчёт cost TEXT,
                                                                мёртвые зависимости,
                                                                model.tokenCost не существует
ReferralModule      ✅(4 EP)    ✅      ×2      JWT             race cond createWithdrawal,
                                                                SBP валидация ломается,
                                                                реквизиты открытым текстом,
                                                                activeReferrals из limit(50)
SupportModule       ✅(3 EP)    ✅      ×1      JWT             role='support' без проверки,
                                                                sort priority как строка,
                                                                нет AdminController,
                                                                нет уведомлений
StorageModule       ✅(2 EP)    ✅      —       JWT(partial)    SSRF в /download,
                                                                /download без JWT,
                                                                конфликт POST /upload/image,
                                                                дублирует S3Client
UploadModule        ✅(2 EP)    —       —       JWT             конфликт POST /upload/image,
                                                                userId='anonymous' (wrong field),
                                                                scheduleDelete через setTimeout
TelegramBotModule   —           —       —       Telegraf        race condition wasNew,
                                                                хардкод '9 спичек',
                                                                нет логирования в catch,
                                                                latency в /ref (botUsername)
HealthModule        ✅(1 EP)    —       —       none            всегда HTTP 200 (даже без MongoDB),
                                                                нет проверки Redis/Bull
WebhooksModule      ✅(1 EP)    —       —       none            нет верификации KIE,
                                                                нет бизнес-логики (заглушка)
FavoritesModule     ✅(2 EP)    ✅      ×1      JWT             race cond toggle,
                                                                type без enum,
                                                                metadata дублирует поля
🔢 Числовые показатели проекта

Typescript

// ─── Размер кодовой базы ──────────────────────────────────────
Модулей NestJS:          17
Контроллеров:            20+ (включая sub-controllers)
Сервисов:                25+
MongoDB схем:            20+
Bull consumers:          1 (GenerationConsumer)
Cron задач:              2 (migratePlanNames, healthCheckAll)
WebSocket gateways:      1 (GenerationGateway)
Telegraf handlers:       4 команды (/start, /help, /balance, /ref)
AI провайдеров:          5 (openrouter, openrouter-image, evolink, kie, replicate)
Платёжных провайдеров:   6 (yookassa, cryptomus, stars, freedompay, tochka, heleket)
Моделей в каталоге:      40+
Эндпоинтов HTTP:         ~85
Env переменных:          50+

// ─── Критичные проблемы по категориям ────────────────────────
Race conditions:         8  (регистрация, dailyLimit, billingRecorded,
                             promoCode, createWithdrawal, toggleFavorite,
                             wasNew в боте, recordSuccessfulGeneration)
Атомарность:             6  (deductTokens, markUsed, findOrCreate,
                             checkDailyLimit, createWithdrawal, recordBilling)
Безопасность:            5  (SSRF, Stars webhook, YooKassa webhook,
                             KIE без верификации, реквизиты открытым текстом)
Финансовые ошибки:       4  (двойное начисление, cashback в балансе,
                             webhook без провайдера, balanceBefore реконструкция)
Конфликты маршрутов:     1  (POST /upload/image × 2)
Хардкоды:                8  (9 спичек, 75 RUB/USD, 999999 unlimited,
                             ссылка поддержки, sort priority, cost TEXT,
                             botUsername TTL, maxContextMessages)

// ─── MongoDB индексы ──────────────────────────────────────────
Существующих индексов:   35+ (по всем коллекциям)
Отсутствующих (нужных):  5+  (lastActiveAt, isActive+referralCount,
                              isBanned, isActive одиночный,
                              paymentProvider в транзакциях)
Избыточных (дублей):     6   (referrerId×2, userId в Ticket×2,
                              userId в Favorite×2, userId в Withdrawal×2)

// ─── Покрытие тестами ────────────────────────────────────────
Unit тесты:              0   (не обнаружено)
Integration тесты:       0
E2E тесты:               0
🗓️ Жизненный цикл данных

Typescript

// ─── User ──────────────────────────────────────────────────────
// Создание: findOrCreateByTelegram → bonusTokens: 9
// Активность: lastActiveAt обновляется при каждом findOrCreateByTelegram
// Подписка: updateSubscription() → plan + expiresAt
//   ⚠️ Нет cron деактивации — план не сбрасывается автоматически
// Бан: isBanned=true → JwtStrategy отклоняет токен
// Мягкое удаление: isDeleted=true + анонимизация полей
//   ⚠️ Транзакции и генерации остаются с userId

// ─── Generation ────────────────────────────────────────────────
// PENDING    → создана запись в БД, ещё не в очереди
// PENDING    → задача добавлена в Bull queue
// PROCESSING → Consumer взял задачу
// PROCESSING → polling async задачи у провайдера
// COMPLETED  → результат в S3, транзакция записана, WS событие
// FAILED     → все попытки исчерпаны, токены возвращены, WS событие
// ⚠️ PENDING без Bull job — нет перехода, нет recovery

// ─── Transaction ───────────────────────────────────────────────
// Жизненный цикл платёжной транзакции:
// PENDING → webhook → COMPLETED (токены начислены)
//        → webhook → FAILED    (ничего не меняется)
// ⚠️ Нет автоматической проверки зависших PENDING транзакций
// Жизненный цикл транзакции генерации:
// Создаётся сразу COMPLETED (списание произошло через deductTokens)
// При ошибке: REFUND транзакция создаётся отдельно

// ─── Subscription ──────────────────────────────────────────────
// Создание: activateSubscription() при webhook COMPLETED
// ⚠️ Нет автоматической деактивации при истечении
// Миграция: PRO→PLUS, UNLIMITED→ULTIMATE (cron 3AM)
// Проверка активности: только в buildAuthResponse() и checkFreeModelAccess()

// ─── AnalyticsEvent ────────────────────────────────────────────
// TTL индекс: автоудаление через 90 дней
// Нет архивирования перед удалением
// ⚠️ Исторические данные (квартал/год) недоступны

// ─── Withdrawal ────────────────────────────────────────────────
// PENDING  → создана, cashback зарезервирован ($inc уменьшил cashbackBalance)
// APPROVED → администратор одобрил
// PAID     → выплачено (cashback списан окончательно)
// REJECTED → отклонено, cashback возвращён (refundCashback)
// ⚠️ PENDING → PAID без APPROVED — разрешено (adminMarkPaid принимает PENDING)

// ─── PromoCode ─────────────────────────────────────────────────
// isActive=true, startsAt <= now <= expiresAt, currentUses < maxUses
// После применения: currentUses++, usages[userId].usesCount++
// ⚠️ Нет автоматической деактивации при isExpired
// ⚠️ usages — embedded array, растёт без ограничений
📌 Быстрый справочник для разработчика

Typescript

// ─── Как получить userId в контроллере ───────────────────────
@CurrentUser('sub') userId: string          // ✅ правильно (JWT payload.sub)
@CurrentUser() user: JwtPayload             // ✅ весь payload
req.user?.id                                // ❌ неправильно (нет такого поля)
req.user?._id                               // ❌ неправильно
req.user?.userId                            // ✅ есть алиас в JwtStrategy

// ─── Как добавить публичный эндпоинт ─────────────────────────
@SetMetadata('isPublic', true)              // пропускает JwtAuthGuard
@Get('public-route')
// или создать @Public() декоратор как алиас

// ─── Как получить баланс пользователя (правильно) ────────────
const total = user.tokenBalance + user.bonusTokens + user.cashbackBalance
// НЕ: user.tokenBalance + user.bonusTokens (текущий баг везде)

// ─── Как получить модель для генерации ───────────────────────
// В GenerationService:
const model = await this.aiProvidersService.getModelBySlug(slug)
// ⚠️ Не проверяет isActive — добавить проверку вручную
if (!model || !model.isActive) throw new NotFoundException()

// ─── Как рассчитать стоимость ─────────────────────────────────
// Для preview (до генерации):
const { costInTokens } = await this.pricingService.calculatePrice(slug, params)
// Для реального списания (в BillingService):
// matchPricingTier() — другой алгоритм! ⚠️

// ─── Как добавить новую модель ────────────────────────────────
// 1. Добавить в buildModelsCatalog() в ProviderRegistryService
// 2. $set поля обновятся при следующем деплое
// 3. $setOnInsert поля (цены) нужно задать в seed или через Admin UI
// 4. Если нужна pricingMatrix — добавить в $set (или ONE_TIME_MIGRATION)
// 5. Если нужен freeModel доступ — обновить subscription_plans в БД

// ─── Как добавить платёжного провайдера ──────────────────────
// 1. Создать class в billing/providers/ реализующий PaymentProviderInterface
// 2. Зарегистрировать в BillingModule providers
// 3. Добавить метод handleXxxWebhook в BillingService
// 4. Добавить POST /billing/webhook/xxx в BillingController
// 5. Добавить верификацию подписи в verifyWebhook()

// ─── Как добавить AI провайдера ──────────────────────────────
// 1. Создать class extends BaseProvider в ai-providers/providers/
// 2. Добавить в providers Map в ProviderRegistryService.initializeProviders()
// 3. Добавить slug в syncProvidersToDB()
// 4. Добавить модели в buildModelsCatalog() с providerMappings

// ─── Стандартные HTTP ответы ──────────────────────────────────
// Успех:   { success: true, data: ... }
// Ошибка:  { statusCode, message, timestamp, path }  (GlobalExceptionFilter)
// Webhook: { success: true } или { success: false, error: '...' }
// SSE:     event: eventName\ndata: JSON\n\n

// ─── Переменные которые ОБЯЗАТЕЛЬНО задать в production ───────
JWT_SECRET          // без него все токены невалидны
MONGODB_URI         // без неё приложение не запустится
TELEGRAM_BOT_TOKEN  // без неё авторизация невозможна
S3_PUBLIC_URL       // без неё URL файлов невалидны (относительные пути)
NODE_ENV=production // без неё /auth/dev открыт, initData TTL 30 дней
REDIS_HOST          // без неё Bull queue не работает, генерации не создаются

// ─── Переменные которые легко забыть ─────────────────────────
S3_PUBLIC_URL       // default '' → битые URL у всех файлов
TOCHKA_VERIFY_SIGNATURE=true  // default верифицирует, 'false' только для dev
ADMIN_TG_IDS        // без неё нет ни одного admin пользователя
API_PUBLIC_URL      // нужен FreedomPay для webhook URL
🔖 Глоссарий проекта


Спичка (🔥)          — внутренняя валюта системы (1 спичка = $0.01)
tokenBalance         — купленные спички (через платёж)
bonusTokens          — подарочные спички (промокоды, старт)
cashbackBalance      — кэшбек от рефералов (тратить + выводить)
totalBalance         — сумма всех трёх (⚠️ в коде только первые два)

pricingMatrix        — массив правил стоимости для media моделей
                       { conditions: {mode: 'fast'}, costInTokens: 4 }
uiParameters         — конфигурация интерфейса выбора параметров модели
inputCapabilities    — что модель принимает на вход (images, audio, video)
providerMappings     — список провайдеров умеющих обслужить модель
                       [{ providerSlug, modelId, priority, isActive }]

freeModels           — модели доступные без трат токенов для плана
                       { modelSlug, hourlyLimit, dailyLimit }
                       null лимиты = безлимит

billingRecorded      — флаг: транзакция за генерацию уже записана
isRefunded           — флаг: рефанд уже выполнен (идемпотентность)
preCharge            — предварительное списание токенов до генерации
                       (для async media: deduct сразу, запись потом)

pollTaskUntilComplete — цикл опроса статуса async задачи у провайдера
saveToStorage        — загрузка результата из URL провайдера в S3
recordMediaGeneration — создание транзакции после успешной генерации

execWithFallback     — перебор провайдеров по приоритету при ошибке
retryable: boolean   — может ли ошибка провайдера быть повторена
                       false = немедленный возврат ошибки без fallback

wasNew               — флаг: пользователь зарегистрировался в этом запросе
referredBy           — ObjectId реферера (кто пригласил)
cashbackEarnedTotal  — исторический счётчик всего заработанного кэшбека

$setOnInsert         — MongoDB: записать только при создании документа
$exists: false       — MongoDB: поле отсутствует (для идемпотентных миграций)
upsert: true         — MongoDB: создать если не существует

fire-and-forget      — вызов без await, ошибки игнорируются
                       используется для аналитики
soft delete          — isDeleted=true вместо физического удаления
denormalized         — данные продублированы в нескольких местах
                       (referralCount в User + реальные Referral документы)

📡 WebSocket события — полный список

Typescript

// ─── Подключение ──────────────────────────────────────────────
// Клиент подключается к WS с JWT токеном:
// ws://host/generations?token=JWT
// или headers: { Authorization: 'Bearer JWT' }

// GenerationGateway.handleConnection():
//   → JwtService.verify(token) → userId
//   → userSockets.set(userId, socket.id)  // in-memory Map
//   → socket.join(`user_${userId}`)        // room

// GenerationGateway.handleDisconnect():
//   → userSockets.delete(userId)

// ─── События: Сервер → Клиент ─────────────────────────────────

// 1. generation:started
// Когда: Bull consumer взял задачу из очереди
// Payload:
{
  generationId: string,   // MongoDB ObjectId
  status: 'processing',
  message: 'Генерация начата'
}

// 2. generation:completed
// Когда: генерация успешно завершена, файл в S3
// Payload:
{
  generationId: string,
  status: 'completed',
  result: {
    url: string,          // S3 публичный URL или оригинальный (если S3 упал)
    thumbnailUrl?: string,// только для video (если есть)
    duration?: number,    // только для audio/video
    width?: number,       // только для image
    height?: number,      // только для image
    seed?: number,        // только для image (если провайдер возвращает)
    mimeType?: string
  },
  tokensSpent: number,    // фактическое списание
  balanceAfter: number    // ⚠️ tokenBalance + bonusTokens (без cashback)
}

// 3. generation:failed
// Когда: все попытки Bull исчерпаны, рефанд выполнен
// Payload:
{
  generationId: string,
  status: 'failed',
  error: string,          // сообщение об ошибке для пользователя
  refunded: boolean,      // true если токены возвращены
  tokensRefunded: number  // сколько вернули
}

// 4. generation:progress
// Когда: async polling получил промежуточный статус
// ⚠️ НЕ реализовано — отсутствует в коде
// (pollTaskUntilComplete не эмитит прогресс)

// ─── События: Клиент → Сервер ─────────────────────────────────
// ⚠️ Нет входящих событий от клиента
// Gateway только отправляет, не принимает сообщения

// ─── Emit паттерн ─────────────────────────────────────────────
// GenerationGateway.sendToUser(userId, event, payload):
//   server.to(`user_${userId}`).emit(event, payload)
// ⚠️ userSockets Map не используется для emit (только для проверки онлайн)
// ⚠️ При 2+ инстансах: room user_${userId} существует только на одном
//    → клиент подключённый к инстансу 2 не получит событие от инстанса 1

// ─── Chat SSE (не WebSocket) ──────────────────────────────────
// GET /chat/stream — Server-Sent Events (EventSource)
// Headers: Authorization: Bearer JWT

// Поток событий:
data: {"type":"message_start","conversationId":"...","messageId":"..."}

data: {"type":"token","content":"Привет"}
data: {"type":"token","content":" как"}
data: {"type":"token","content":" дела"}
// ... N событий token

data: {"type":"message_end","messageId":"...","tokensUsed":42,"balanceAfter":958}
// ⚠️ messageId в message_end — это ID удалённого объекта из Map
//    если клиент разорвал соединение и переподключился — ID уже не существует

data: {"type":"error","message":"Недэшируется на 1 час

// Ошибка:
Bot: "Сначала нажми /start"

// ─── Inline кнопки ───────────────────────────────────────────────
// Все команды имеют кнопку [Открыть приложение]:
{ text: 'Открыть приложение 🚀', web_app: { url: MINI_APP_URL } }
// или при отсутствии MINI_APP_URL:
{ text: 'Открыть приложение 🚀', url: FRONTEND_URL }
// ⚠️ Если оба не заданы — кнопка имеет url: undefined → Telegram ошибка

// ─── Платёжные уведомления ───────────────────────────────────────
// ⚠️ НЕТ уведомлений об успешной оплате через бот
// ⚠️ НЕТ уведомлений об истечении подписки
// ⚠️ НЕТ уведомлений о выполненной заявке на вывод
// ⚠️ НЕТ уведомлений об ответе поддержки

// ─── Admin уведомления ───────────────────────────────────────────
// ⚠️ НЕТ уведомлений admin при новой заявке на вывод
// ⚠️ НЕТ уведомлений admin при новом тикете поддержки
// ⚠️ НЕТ уведомлений admin при крупной оплате
🌱 Seed данные — первый деплой

Typescript

// ─── Автоматически при старте (onModuleInit) ──────────────────

// 1. ProviderRegistryService.syncProvidersToDB()
//    Создаёт/обновляет документы в коллекции 'providers':
[
  { slug: 'openrouter',       name: 'OpenRouter',        isActive: true },
  { slug: 'openrouter-image', name: 'OpenRouter Image',  isActive: true },
  { slug: 'evolink',          name: 'Evolink',            isActive: true },
  { slug: 'kie',              name: 'KIE AI',             isActive: true },
  { slug: 'replicate',        name: 'Replicate',          isActive: true }
]
// Операция: updateOne({ slug }, { $set: {...} }, { upsert: true })

// 2. ProviderRegistryService.seedDefaultModels()
//    Создаёт/обновляет документы в коллекции 'ai_models'
//    Примеры создаваемых моделей:

// TEXT модели (через openrouter):
{ slug: 'gpt-4o',           name: 'GPT-4o',           type: 'text' }
{ slug: 'gpt-4o-mini',      name: 'GPT-4o Mini',      type: 'text' }
{ slug: 'claude-3-5-sonnet',name: 'Claude 3.5 Sonnet', type: 'text' }
{ slug: 'claude-3-5-haiku', name: 'Claude 3.5 Haiku', type: 'text' }
{ slug: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', type: 'text' }
{ slug: 'deepseek-v3',      name: 'DeepSeek V3',      type: 'text' }
{ slug: 'deepseek-r1',      name: 'DeepSeek R1',      type: 'text' }
// + 10-15 других text моделей

// IMAGE модели:
{ slug: 'midjourney',       name: 'Midjourney',        type: 'image' }
{ slug: 'dall-e-3',         name: 'DALL-E 3',          type: 'image' }
{ slug: 'stable-diffusion', name: 'Stable Diffusion',  type: 'image' }
{ slug: 'flux-pro',         name: 'FLUX Pro',          type: 'image' }
{ slug: 'flux-dev',         name: 'FLUX Dev',          type: 'image' }
// + другие image модели

// VIDEO модели:
{ slug: 'kling-video',      name: 'Kling Video',       type: 'video' }
{ slug: 'runway-gen3',      name: 'Runway Gen-3',      type: 'video' }
{ slug: 'luma-dream',       name: 'Luma Dream Machine', type: 'video' }

// AUDIO модели:
{ slug: 'elevenlabs',       name: 'ElevenLabs',        type: 'audio' }
{ slug: 'suno',             name: 'Suno',              type: 'audio' }

// Операция для каждой модели:
updateOne({ slug }, {
  $set: {
    name, type, providerMappings, inputCapabilities,
    uiParameters, isActive, isPremium, sortOrder
  },
  $setOnInsert: {
    costPerToken, pricingMatrix,    // ⚠️ цены НЕ обновляются при апдейте
    freeHourlyLimit, freeDailyLimit // ⚠️ лимиты НЕ обновляются при апдейте
  }
}, { upsert: true })

// 3. BillingService.migratePlanNames() (onApplicationBootstrap)
//    Обновляет в коллекции 'subscriptions':
updateMany(
  { plan: { $in: ['pro', 'unlimited'] } },
  [{ $set: { plan: {
    $switch: { branches: [
      { case: { $eq: ['$plan','pro'] },       then: 'plus' },
      { case: { $eq: ['$plan','unlimited'] }, then: 'ultimate' }
    ]}
  }}}]
)
// ✅ Идемпотентно

// ─── Ручные seed скрипты (запускать отдельно) ─────────────────

// scripts/seed-billing.ts
// Создаёт subscription_plans и token_packages:

SubscriptionPlans:
{ plan: 'free',     price: 0,   currency: 'RUB', tokensPerMonth: 0  }
{ plan: 'basic',    price: 299, currency: 'RUB', tokensPerMonth: 100 }
{ plan: 'plus',     price: 599, currency: 'RUB', tokensPerMonth: 300 }
{ plan: 'max',      price: 999, currency: 'RUB', tokensPerMonth: 700 }
{ plan: 'ultimate', price: 1999,currency: 'RUB', tokensPerMonth: 9999 }
// + каждый план имеет: features[], freeModels[], capabilities[]
// ⚠️ capabilities — строковые описания, не привязаны к моделям

TokenPackages:
{ tokens: 50,   price: 99,  currency: 'RUB', bonus: 0  }
{ tokens: 150,  price: 249, currency: 'RUB', bonus: 15 }
{ tokens: 350,  price: 499, currency: 'RUB', bonus: 50 }
{ tokens: 800,  price: 999, currency: 'RUB', bonus: 150}
{ tokens: 2000, price: 1999,currency: 'RUB', bonus: 500}
// Операция: $setOnInsert → не перезаписывает если уже есть

// scripts/seed-midjourney-pricing.ts
// Создаёт pricingMatrix для midjourney:
[
  { conditions: { mode: 'normal', version: 'normal' }, costInTokens: 3 },
  { conditions: { mode: 'normal', version: 'pro' },    costInTokens: 5 },
  { conditions: { mode: 'fast',   version: 'normal' }, costInTokens: 4 },
  { conditions: { mode: 'fast',   version: 'pro' },    costInTokens: 7 },
  { conditions: { mode: 'turbo',  version: 'normal' }, costInTokens: 2 },
  { conditions: { mode: 'turbo',  version: 'pro' },    costInTokens: 4 }
]
// Операция: updateOne({ slug: 'midjourney' }, { $set: { pricingMatrix } })
// ⚠️ Если модель не найдена (нет в БД) — code: 0, silent fail

// scripts/migrate-token-system.ts
// Разовая миграция: добавляет cashbackBalance=0 всем пользователям
// у которых нет этого поля
updateMany(
  { cashbackBalance: { $exists: false } },
  { $set: { cashbackBalance: 0 } }
)
// ✅ Идемпотентно
// ⚠️ Нет finally → app.close() может не вызваться при ошибке

// ─── Порядок запуска при первом деплое ────────────────────────
// 1. Настроить все env переменные
// 2. npm run start (автосeed моделей и провайдеров при старте)
// 3. ts-node scripts/seed-billing.ts     (планы и пакеты)
// 4. ts-node scripts/seed-midjourney-pricing.ts (цены MJ)
// 5. ts-node scripts/migrate-token-system.ts   (если старая БД)
// 6. Задать ADMIN_TG_IDS → перезапустить (или пользователь зайдёт сам)

// ─── Что НЕ создаётся автоматически ─────────────────────────
// ❌ Индексы MongoDB (создаются Mongoose при старте через @Index декораторы)
//    ✅ Фактически Mongoose createIndexes() вызывается при подключении
// ❌ Redis данные (Bull создаёт структуры сам при первой задаче)
// ❌ S3 bucket (нужно создать вручную в панели Timeweb)
// ❌ Telegram webhook (нужно зарегистрировать через setWebhook или polling)
// ❌ Промокоды (только через Admin API)
// ❌ Суперадмин пользователь (только через SUPER_ADMIN_TG_IDS + /start в боте)
🔀 Миграции — порядок и детали

Typescript

// ─── Автоматические (при каждом старте) ──────────────────────

// M1: syncProvidersToDB
// Файл: ai-providers/services/provider-registry.service.ts
// Триггер: onModuleInit
// Безопасность: upsert, не удаляет существующих
// Риск: ❌ нет

// M2: seedDefaultModels
// Файл: ai-providers/services/provider-registry.service.ts
// Триггер: onModuleInit (после M1)
// Безопасность: $setOnInsert для цен, $set для структуры
// Риск: ⚠️ изменение providerMappings может сломать активные генерации

// M3: migratePlanNames (PRO→PLUS, UNLIMITED→ULTIMATE)
// Файл: billing/billing.service.ts
// Триггер: onApplicationBootstrap
// Безопасность: $switch только для known values, идемпотентно
// Риск: ❌ нет

// ─── Ручные (разовые) ────────────────────────────────────────

// M4: migrate-token-system
// Файл: scripts/migrate-token-system.ts
// Цель: добавить cashbackBalance=0 всем пользователям
// Когда запускать: один раз при добавлении реферальной программы
// Проверка: db.users.find({ cashbackBalance: { $exists: false } }).count() === 0
// ⚠️ Нет try/finally — утечка соединения при ошибке

// M5: seed-billing
// Файл: scripts/seed-billing.ts
// Цель: создать subscription_plans и token_packages
// Когда запускать: при первом деплое + при добавлении новых планов
// Безопасность: $setOnInsert — не перезаписывает price если уже есть
// ⚠️ Для обновления цен нужно удалить документ вручную или убрать $setOnInsert

// M6: seed-midjourney-pricing
// Файл: scripts/seed-midjourney-pricing.ts
// Цель: задать pricingMatrix для Midjourney
// Когда запускать: при первом деплое
// Зависимость: M2 должна выполниться до (модель должна существовать)
// ⚠️ Silent fail если модель не найдена

// ─── Отсутствующие необходимые миграции ──────────────────────

// НУЖНА M7: добавить paymentProvider к старым транзакциям
// updateMany(
//   { paymentProvider: { $exists: false }, type: 'deposit' },
//   { $set: { paymentProvider: 'unknown' } }
// )

// НУЖНА M8: исправить балансы пользователей у которых
// cashbackBalance = undefined (не null, не 0)
// Симптом: /balance показывает NaN

// НУЖНА M9: деактивировать истёкшие подписки
// updateMany(
//   { isActive: true, expiresAt: { $lt: new Date() }, expiresAt: { $ne: null } },
//   { $set: { isActive: false } }
// )
// + обновить user.subscriptionPlan = 'free' для таких пользователей

// НУЖНА M10: нормализовать referralCount
// Пересчитать из реальных Referral документов:
// для каждого user: count = Referral.countDocuments({ referrerId: user._id })
// updateOne({ _id: user._id }, { $set: { referralCount: count } })
📊 Схемы MongoDB — все поля

Typescript

// ─── User ─────────────────────────────────────────────────────
{
  _id: ObjectId,
  telegramId: number,          // unique, sparse
  username: string,            // optional
  firstName: string,
  lastName: string,            // optional
  photoUrl: string,            // optional
  languageCode: string,        // optional (из Telegram)
  email: string,               // select:false ⚠️ НЕ работает
  passwordHash: string,        // select:false ✅ работает
  authProvider: string,        // 'telegram'|'email'|'google'
  role: string,                // 'user'|'admin'|'super_admin'
  tokenBalance: number,        // default: 0
  bonusTokens: number,         // default: 0 (или 9 при создании)
  cashbackBalance: number,     // default: 0 (добавлен через M4)
  cashbackEarnedTotal: number, // default: 0
  subscriptionPlan: string,    // default: 'free'
  referralCode: string,        // unique, sparse (8 символов hex)
  referredBy: ObjectId,        // ref: User, optional
  referralCount: number,       // default: 0 (денормализация)
  isActive: boolean,           // default: true
  isBanned: boolean,           // default: false
  isDeleted: boolean,          // default: false
  deletedAt: Date,             // optional
  deletedBy: ObjectId,         // optional
  lastActiveAt: Date,          // обновляется при findOrCreate
  dailyGenerationsCount: number,// default: 0 ⚠️ не сбрасывается
  dailyGenerationsDate: Date,  // дата последнего сброса
  settings: {                  // nested object
    notifications: boolean,    // default: true
    language: string,          // default: 'ru'
    theme: string,             // default: 'dark'
    // ⚠️ полностью перезаписывается при updateSettings
  },
  createdAt: Date,             // auto (timestamps)
  updatedAt: Date,             // auto (timestamps)
}
// Индексы:
// { telegramId: 1 } unique sparse
// { referralCode: 1 } unique sparse
// { role: 1 }
// { isBanned: 1 }
// { isDeleted: 1 }
// ⚠️ Нет: lastActiveAt, referralCount, isActive

// ─── Generation ───────────────────────────────────────────────
{
  _id: ObjectId,
  userId: ObjectId,            // ref: User
  type: string,                // 'image'|'video'|'audio'|'text'
  status: string,              // 'pending'|'processing'|'completed'|'failed'|'cancelled'
  modelSlug: string,
  providerSlug: string,        // какой провайдер использован
  prompt: string,
  negativePrompt: string,      // optional
  params: object,              // все параметры генерации (mode, size и т.п.)
  result: {
    url: string,               // S3 URL или URL провайдера
    thumbnailUrl: string,      // optional
    duration: number,          // optional (audio/video)
    width: number,             // optional (image)
    height: number,            // optional (image)
    seed: number,              // optional (image)
    mimeType: string,          // optional
    storageKey: string,        // S3 ключ для удаления
    fileSize: number,          // optional
  },
  taskId: string,              // external task ID у провайдера (async)
  errorMessage: string,        // optional при failed
  costInTokens: number,        // фактическое списание
  isFavorite: boolean,         // default: false
  isPublic: boolean,           // default: false ⚠️ нет публичной галереи
  billingRecorded: boolean,    // default: false (идемпотентность)
  isRefunded: boolean,         // default: false (идемпотентность)
  metadata: object,            // доп. данные (modelVersion, etc)
  createdAt: Date,
  updatedAt: Date,
}
// Индексы:
// { userId: 1, createdAt: -1 }
// { status: 1, taskId: 1 }
// { userId: 1, isFavorite: 1, createdAt: -1 }
// { userId: 1, type: 1, createdAt: -1 }

// ─── Transaction ──────────────────────────────────────────────
{
  _id: ObjectId,
  userId: ObjectId,            // ref: User
  type: string,                // TransactionType enum
  amount: number,              // в токенах (всегда положительное)
  balanceBefore: number,       // ⚠️ реконструируется как balanceAfter+amount
  balanceAfter: number,        // баланс после операции
  description: string,
  status: string,              // 'pending'|'completed'|'failed'|'refunded'
  paymentProvider: string,     // optional ('yookassa'|'cryptomus'|...)
  externalPaymentId: string,   // optional, sparse unique
  paymentAmount: number,       // в рублях/долларах (реальные деньги)
  paymentCurrency: string,     // 'RUB'|'USD'|'KZT'
  metadata: {
    modelSlug: string,         // для GENERATION
    generationId: ObjectId,    // для GENERATION
    freeAccess: boolean,       // для GENERATION (бесплатная)
    planId: ObjectId,          // для SUBSCRIPTION
    packageId: ObjectId,       // для DEPOSIT
    promoCodeId: ObjectId,     // если использован промокод
    promoDiscount: number,     // размер скидки
    referralId: ObjectId,      // для REFERRAL_BONUS
    adminNote: string,         // для ADMIN_ADJUSTMENT
  },
  createdAt: Date,
  updatedAt: Date,
}
// Индексы: (см. раздел MongoDB выше)

// ─── Subscription ─────────────────────────────────────────────
{
  _id: ObjectId,
  userId: ObjectId,            // ref: User, unique (один активный)
  plan: string,                // SubscriptionPlan enum
  isActive: boolean,
  startDate: Date,
  endDate: Date,               // ⚠️ алиас поля expiresAt используется в коде
  expiresAt: Date,             // ⚠️ оба поля существуют, путаница
  tokensPerMonth: number,
  autoRenew: boolean,          // default: false ⚠️ не реализовано
  paymentMethod: string,       // optional
  metadata: object,
  createdAt: Date,
  updatedAt: Date,
}
// ⚠️ endDate и expiresAt — два разных поля, в коде используются оба
// Индексы:
// { userId: 1, isActive: 1, endDate: -1 }
// { isActive: 1, endDate: 1 }

// ─── AIModel ──────────────────────────────────────────────────
{
  _id: ObjectId,
  slug: string,                // unique
  name: string,
  description: string,
  type: string,                // 'text'|'image'|'video'|'audio'
  providerMappings: [{
    providerSlug: string,
    modelId: string,           // ID модели у провайдера
    priority: number,          // меньше = выше приоритет
    isActive: boolean,
    config: object,            // доп. конфиг для провайдера
  }],
  inputCapabilities: {
    text: boolean,
    images: boolean,
    audio: boolean,
    video: boolean,
    documents: boolean,
  },
  outputType: string,          // 'text'|'image'|'video'|'audio'
  isActive: boolean,           // default: true
  isPremium: boolean,          // default: false
  sortOrder: number,           // для сортировки в UI
  costPerToken: number,        // стоимость для TEXT (устаревает)
  pricingMatrix: [{            // для IMAGE/VIDEO/AUDIO
    conditions: object,        // { mode: 'fast', size: '1024x1024' }
    costInTokens: number,
  }],
  uiParameters: [{             // параметры для отображения в UI
    key: string,               // имя параметра (mode, size, style и т.п.)
    label: string,             // отображаемое название
    type: string,              // 'select'|'slider'|'toggle'|'input'
    defaultValue: any,         // значение по умолчанию
    options: [{                // для type='select'
      value: string,
      label: string,
      costModifier: number,    // множитель стоимости (1.0 = без изменений)
    }],
    min: number,               // для type='slider'
    max: number,               // для type='slider'
    step: number,              // для type='slider'
    required: boolean,
    dependsOn: {               // условная видимость
      key: string,             // показывать только если
      value: string,           // этот параметр равен этому значению
    },
  }],
  f: string[],              // для фильтрации ['fast','cheap','vision']
  createdAt: Date,
  updatedAt: Date,
}
// Индексы:
// { slug: 1 } unique
// { type: 1, isActive: 1, sortOrder: 1 }
// { isPremium: 1 }

// ─── Conversation ─────────────────────────────────────────────
{
  _id: ObjectId,
  userId: ObjectId,            // ref: User
  title: string,               // первые N символов первого сообщения
  modelSlug: string,
  systemPrompt: string,        // optional (кастомный системный промпт)
  messages: [{                 // embedded array (не отдельная коллекция)
    role: string,              // 'user'|'assistant'|'system'
    content: string,
    imageUrls: string[],       // optional (multimodal)
    tokensUsed: number,        // optional (только для assistant)
    createdAt: Date,
  }],
  totalTokensUsed: number,     // счётчик всех токенов
  isActive: boolean,           // default: true
  isPinned: boolean,           // default: false
  metadata: {
    temperature: number,       // последнее использованное значение
    maxTokens: number,
  },
  createdAt: Date,
  updatedAt: Date,
}
// ⚠️ messages как embedded array — документ растёт неограниченно
// ⚠️ При 1000+ сообщениях документ может превысить 16MB лимит MongoDB
// Индексы:
// { userId: 1, createdAt: -1 }
// { userId: 1, isActive: 1, isPinned: -1, updatedAt: -1 }

// ─── PromoCode ────────────────────────────────────────────────
{
  _id: ObjectId,
  code: string,                // unique (uppercase)
  type: string,                // 'tokens'|'subscription'|'discount'
  value: number,               // токены / месяцы / процент скидки
  subscriptionPlan: string,    // только для type='subscription'
                               // ⚠️ не enum-валидирован
  maxUses: number,             // null = безлимит
  currentUses: number,         // default: 0
  usages: [{                   // embedded array
    userId: ObjectId,
    usedAt: Date,
    usesCount: number,         // сколько раз этот юзер использовал
  }],
  isActive: boolean,           // default: true
  startsAt: Date,              // optional
  expiresAt: Date,             // optional
  minPurchaseAmount: number,   // optional (минимальная сумма покупки)
  applicablePlans: string[],   // optional (для каких планов работает)
  createdBy: ObjectId,         // ref: User (admin)
  description: string,         // internal описание
  createdAt: Date,
  updatedAt: Date,
}
// Индексы:
// { code: 1 } unique
// { isActive: 1, expiresAt: 1 }

// ─── Referral ─────────────────────────────────────────────────
{
  _id: ObjectId,
  referrerId: ObjectId,        // ref: User (кто пригласил)
                               // ⚠️ два индекса: index + unique sparse
  referredId: ObjectId,        // ref: User (кого пригласили)
  status: string,              // 'pending'|'active'|'inactive'
  bonusAwarded: boolean,       // default: false (бонус рефереру выдан)
  bonusAmount: number,         // сколько выдано
  cashbackPercent: number,     // % кэшбека с покупок реферала
  totalCashbackEarned: number, // суммарный кэшбек
  createdAt: Date,
  updatedAt: Date,
}
// Индексы:
// { referrerId: 1 }           // ⚠️ дубль
// { referrerId: 1 } unique sparse // ⚠️ дубль
// { referredId: 1 } unique    // один реферал на одного юзера
// { status: 1 }

// ─── Withdrawal ───────────────────────────────────────────────
{
  _id: ObjectId,
  userId: ObjectId,            // ref: User
                               // ⚠️ два индекса: index + unique sparse
  amount: number,              // в токенах (кэшбек)
  amountRub: number,           // в рублях (рассчитывается при создании)
  status: string,              // 'pending'|'approved'|'paid'|'rejected'
  method: string,              // WithdrawalMethod enum
  requisites: string,          // ⚠️ открытым текстом (карта/телефон)
  adminNote: string,           // optional (комментарий админа)
  processedBy: ObjectId,       // ref: User (admin)
  processedAt: Date,
  createdAt: Date,
  updatedAt: Date,
}
// Индексы:
// { userId: 1 }               // ⚠️ дубль
// { userId: 1 } unique sparse // ⚠️ дубль
// { status: 1, createdAt: -1 }

// ─── SupportTicket ────────────────────────────────────────────
{
  _id: ObjectId,
  userId: ObjectId,            // ref: User
                               // ⚠️ два индекса
  ticketNumber: string,        // уникальный номер TICKET-XXXXX
  subject: string,
  status: string,              // 'open'|'in_progress'|'resolved'|'closed'
  priority: string,            // 'low'|'medium'|'high'|'urgent'
                               // ⚠️ сортировка как строка: high>low>medium>urgent
  category: string,            // 'billing'|'technical'|'general'|'abuse'
  messages: [{                 // embedded array
    senderId: ObjectId,        // ref: User
    senderRole: string,        // 'user'|'support'|'admin'
    content: string,
    attachments: string[],     // URLs
    isRead: boolean,
    createdAt: Date,
  }],
  assignedTo: ObjectId,        // ref: User (support agent)
  resolvedAt: Date,
  closedAt: Date,
  metadata: object,
  createdAt: Date,
  updatedAt: Date,
}
// Индексы:
// { userId: 1 }               // ⚠️ дубль
// { userId: 1, createdAt: -1 }// ⚠️ дубль
// { status: 1, priority: 1, createdAt: -1 }
// { ticketNumber: 1 } unique
// { assignedTo: 1 }

// ─── AnalyticsEvent ───────────────────────────────────────────
{
  _id: ObjectId,
  eventType: string,           // ⚠️ нет enum — свободная строка
  userId: ObjectId,            // optional ref: User
  sessionId: string,           // optional
  properties: object,          // любые доп. данные
  metadata: {
    ip: string,
    userAgent: string,
    platform: string,          // 'telegram'|'web'|'api'
    version: string,           // версия приложения
  },
  createdAt: Date,             // TTL индекс: удаление через 90 дней
}
// Индексы:
// { createdAt: 1 } TTL: 90 days
// { eventType: 1, createdAt: -1 }
// { userId: 1, createdAt: -1 }

// ─── Favorite ─────────────────────────────────────────────────
{
  _id: ObjectId,
  userId: ObjectId,            // ref: User
                               // ⚠️ два индекса
  itemId: ObjectId,            // ref: Generation (или другой тип)
  type: string,                // 'generation'|'model'|... ⚠️ нет enum
  metadata: {                  // ⚠️ дублирует данные из Generation
    modelSlug: string,
    type: string,              // тип генерации
    thumbnailUrl: string,
    prompt: string,
  },
  createdAt: Date,
}
// Индексы:
// { userId: 1 }               // ⚠️ дубль
// { userId: 1, type: 1, createdAt: -1 } // ⚠️ дубль
// { userId: 1, itemId: 1 } unique       // защита от дублей

// ─── Provider (runtime коллекция) ─────────────────────────────
{
  _id: ObjectId,
  slug: string,                // unique
  name: string,
  isActive: boolean,
  lastHealthCheck: Date,
  healthStatus: string,        // 'healthy'|'degraded'|'down'
  failureCount: number,        // consecutive failures
  metadata: object,
  createdAt: Date,
  updatedAt: Date,
}
// Индексы:
// { slug: 1 } unique
// { isActive: 1, healthStatus: 1 }
🌐 Примеры HTTP запросов

Bash

# ─── Auth ────────────────────────────────────────────────────
# Авторизация через Telegram Mini App
POST /api/v1/auth/telegram
Content-Type: application/json

{
  "initData": "query_id=AAH...&user=%7B%22id%22%3A123456%7D&hash=abc123",
  "referralCode": "a1b2c3d4"  // optional
}

# Ответ:
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "user": {
    "id": "64f1a2b3c4d5e6f7a8b9c0d1",
    "telegramId": 123456,
    "username": "john_doe",
    "firstName": "John",
    "role": "user",
    "tokenBalance": 9,
    "bonusTokens": 0,
    "cashbackBalance": 0,
    "totalBalance": 9,        // ⚠️ cashback НЕ включён
    "subscriptionPlan": "free",
    "referralCode": "a1b2c3d4"
  }
}

# Обновление токена
POST /api/v1/auth/refresh
Content-Type: application/json

{ "refreshToken": "eyJhbGc..." }

# ─── Users ───────────────────────────────────────────────────
# Профиль текущего пользователя
GET /api/v1/users/me
Authorization: Bearer eyJhbGc...

# Ответ:
{
  "id": "64f1...",
  "telegramId": 123456,
  "tokenBalance": 50,
  "bonusTokens": 9,
  "cashbackBalance": 25,     // ⚠️ не в totalBalance
  "totalBalance": 59,        // tokenBalance + bonusTokens (без cashback)
  "subscriptionPlan": "plus",
  "referralCode": "a1b2c3d4",
  "referralCount": 3,
  "settings": { "notifications": true, "language": "ru", "theme": "dark" }
}

# Обновить настройки (PATCH — но реализован как полная замена)
PATCH /api/v1/users/me/settings
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{ "theme": "light" }
# ⚠️ Перезапишет весь объект settings → notifications и language потеряются
# Правильно отправлять: { "notifications": true, "language": "ru", "theme": "light" }

# ─── Chat ────────────────────────────────────────────────────
# Создать беседу
POST /api/v1/chat/conversations
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "modelSlug": "gpt-4o",
  "title": "Моя беседа",       // optional (auto из первого сообщения)
  "systemPrompt": "You are a helpful assistant"  // optional
}

# Отправить сообщение (streaming)
POST /api/v1/chat/conversations/:id/messages
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "content": "Привет! Расскажи о себе",
  "imageUrls": [],             // optional
  "temperature": 0.7,          // optional
  "maxTokens": 2048            // optional
}
# ⚠️ Нет class-validator на этом DTO

# Получить SSE поток
GET /api/v1/chat/stream?conversationId=64f1...
Authorization: Bearer eyJhbGc...
# или token в query: ?token=eyJhbGc...&conversationId=64f1...

# SSE события:
# data: {"type":"message_start","conversationId":"...","messageId":"..."}
# data: {"type":"token","content":"Привет"}
# data: {"type":"message_end","messageId":"...","tokensUsed":42}

# ─── Generation ──────────────────────────────────────────────
# Сгенерировать изображение
POST /api/v1/generation/image
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "modelSlug": "midjourney",
  "prompt": "beautiful sunset over mountains, photorealistic",
  "negativePrompt": "blurry, low quality",  // optional
  "params": {
    "mode": "fast",
    "version": "pro",
    "size": "1024x1024",
    "style": "photographic"
  }
}

# Ответ (immediate, генерация async):
{
  "generationId": "64f1a2b3...",
  "status": "pending",
  "estimatedCost": 7,
  "message": "Генерация поставлена в очередь"
}
# Результат придёт через WebSocket: generation:completed

# Сгенерировать видео
POST /api/v1/generation/video
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "modelSlug": "kling-video",
  "prompt": "A cat playing piano",
  "params": {
    "duration": 5,
    "aspectRatio": "16:9",
    "imageUrl": "https://..."  // optional стартовый кадр
  }
}

# Сгенерировать аудио
POST /api/v1/generation/audio
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "modelSlug": "elevenlabs",
  "prompt": "Текст для озвучки",
  "params": {
    "voiceId": "voice_123",
    "stability": 0.75,
    "similarity": 0.85,
    "speed": 1.0
  }
}

# Получить статус генерации
GET /api/v1/generation/:id
Authorization: Bearer eyJhbGc...

# Ответ при completed:
{
  "id": "64f1...",
  "status": "completed",
  "result": {
    "url": "https://s3.timeweb.cloud/bucket/images/userId/uuid.png",
    "width": 1024,
    "height": 1024,
    "seed": 42
  },
  "costInTokens": 7,
  "createdAt": "2024-01-15T10:30:00Z"
}

# История генераций
GET /api/v1/generation/history?page=1&limit=20&type=image
Authorization: Bearer eyJhbGc...

# Рассчитать стоимость
POST /api/v1/generation/calculate-price
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "modelSlug": "midjourney",
  "params": { "mode": "fast", "version": "pro" }
}

# Ответ:
{
  "costInTokens": 7,
  "currentBalance": 59,
  "sufficient": true
}

# ─── Billing ─────────────────────────────────────────────────
# Создать платёж за подписку
POST /api/v1/billing/subscription/create
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "planId": "64f1a2b3...",
  "paymentProvider": "yookassa",
  "promoCode": "SAVE20"       // optional
}

# Ответ:
{
  "paymentUrl": "https://yookassa.ru/checkout/...",
  "transactionId": "64f1...",
  "amount": 479,              // 599 - 20%
  "currency": "RUB"
}

# Создать платёж за токены
POST /api/v1/billing/tokens/create
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "packageId": "64f1a2b3...",
  "paymentProvider": "cryptomus",
  "promoCode": null
}

# Webhook (без авторизации)
POST /api/v1/billing/webhook/yookassa
Content-Type: application/json
# ⚠️ Без верификации подписи

{
  "event": "payment.succeeded",
  "object": {
    "id": "ext_payment_123",
    "status": "succeeded",
    "amount": { "value": "599.00", "currency": "RUB" },
    "metadata": { "transactionId": "64f1..." }
  }
}

# Применить промокод
POST /api/v1/billing/promo/apply
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{ "code": "WELCOME10" }

# Ответ:
{
  "success": true,
  "type": "tokens",
  "value": 50,
  "message": "Начислено 50 спичек"
}

# ─── Upload ──────────────────────────────────────────────────
# Загрузить файл (multipart)
POST /api/v1/upload/image
Authorization: Bearer eyJhbGc...
Content-Type: multipart/form-data

file: [binary data]

# Ответ:
{
  "url": "https://s3.timeweb.cloud/bucket/uploads/userId/uuid.jpg",
  "key": "uploads/userId/uuid.jpg",
  "size": 204800,
  "mimeType": "image/jpeg"
}

# Скачать внешний файл через прокси (без авторизации ⚠️ SSRF)
GET /api/v1/upload/download?url=https://external-site.com/image.png

# ─── Models ──────────────────────────────────────────────────
# Список доступных моделей
GET /api/v1/models?type=image&isActive=true
Authorization: Bearer eyJhbGc...
# ⚠️ isActive передаётся как строка, не boolean

# Ответ:
{
  "models": [{
    "slug": "midjourney",
    "name": "Midjourney",
    "type": "image",
    "isPremium": false,
    "costPerToken": 0,         // для text
    "pricingMatrix": [...],    // для media
    "uiParameters": [...],
    "inputCapabilities": { "text": true, "images": true },
    "isAvailable": true,       // есть ли доступные провайдеры
    "isFree": false,           // доступна ли бесплатно для текущего плана
    "freeLimit": null
  }]
}

# Рассчитать стоимость (из ModelsController)
POST /api/v1/models/calculate-price
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "modelSlug": "flux-pro",
  "params": { "steps": 30, "size": "1024x1024" }
}

# ─── Referral ────────────────────────────────────────────────
# Статистика рефералов
GET /api/v1/referral/stats
Authorization: Bearer eyJhbGc...

# Ответ:
{
  "referralCode": "a1b2c3d4",
  "referralLink": "https://t.me/BOT_USERNAME?start=a1b2c3d4",
  "totalReferrals": 5,
  "activeReferrals": 3,        // ⚠️ из limit(50) — неточно при 50+
  "totalCashbackEarned": 150,
  "cashbackBalance": 75,
  "pendingWithdrawals": 0
}

# Список рефералов
GET /api/v1/referral/list?page=1&limit=20
Authorization: Bearer eyJhbGc...

# Создать заявку на вывод
POST /api/v1/referral/withdrawal
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "amount": 500,               // в токенах
  "method": "sbp",             // WithdrawalMethod enum
  "requisites": "+79001234567" // ⚠️ открытым текстом
}

# История выводов
GET /api/v1/referral/withdrawals
Authorization: Bearer eyJhbGc...

# ─── Support ─────────────────────────────────────────────────
# Создать тикет
POST /api/v1/support/tickets
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "subject": "Не списались токены",
  "message": "Оплатил но токены не пришли",
  "category": "billing",      // optional
  "priority": "high"          // optional, default: 'medium'
}

# Ответ:
{
  "ticketId": "64f1...",
  "ticketNumber": "TICKET-00123",
  "status": "open"
}

# Добавить сообщение в тикет
POST /api/v1/support/tickets/:id/messages
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "content": "Вот скриншот платежа",
  "attachments": ["https://..."]  // optional
}

# Получить тикет
GET /api/v1/support/tickets/:id
Authorization: Bearer eyJhbGc...

# ─── Admin ───────────────────────────────────────────────────
# Список пользователей
GET /api/v1/admin/users?page=1&limit=20&search=john&role=user
Authorization: Bearer eyJhbGc...   # требует role: admin

# Выдать токены пользователю
POST /api/v1/admin/users/:id/tokens
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "amount": 100,
  "type": "bonus",             // 'tokens'|'bonus'|'cashback'
  "reason": "Компенсация за ошибку"
}

# Создать промокод
POST /api/v1/admin/promo-codes
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "code": "SUMMER25",
  "type": "discount",
  "value": 25,                 // 25%
  "maxUses": 1000,
  "expiresAt": "2024-08-31T23:59:59Z",
  "description": "Летняя скидка"
}

# Статистика транзакций
GET /api/v1/admin/transactions/stats?from=2024-01-01&to=2024-01-31
Authorization: Bearer eyJhbGc...

# Ответ (10 параллельных агрегаций):
{
  "totalRevenue": 125000,
  "totalTransactions": 450,
  "byType": { "deposit": 200, "subscription": 150, "generation": 100 },
  "byProvider": { "yookassa": 300, "cryptomus": 100, "stars": 50 },
  "dailyRevenue": [{ "date": "2024-01-01", "amount": 4200 }, ...],
  "topModels": [{ "slug": "midjourney", "uses": 1200, "revenue": 8400 }],
  "topSpenders": [{ "userId": "...", "username": "john", "spent": 5000 }]
}

# Управление моделью
PATCH /api/v1/admin/models/:slug
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "isActive": false,
  "isPremium": true,
  "sortOrder": 5
}

# ─── Health ───────────────────────────────────────────────────
GET /api/v1/health
# Без авторизации

# Ответ (всегда 200 ⚠️):
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "uptime": 86400,
  "version": "1.0.0"
}
# ⚠️ Не проверяет MongoDB, Redis, Bull
# ⚠️ Всегда возвращает 200 даже если БД недоступна
🗺️ Диаграмма зависимостей модулей


                         AppModule
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
    ConfigModule      MongooseModule      BullModule
    (Global)          (forRoot)           (forRoot)
          │                 │                 │
          └────────────┬────┘                 │
                       │                      │
    ┌──────────────────┼──────────────────────┤
    │                  │                      │
    ▼                  ▼                      ▼
AuthModule         UsersModule          BillingModule
    │                  │                    │   │
    │ imports           │ imports            │   │
    │ ◄─────────────── ┤                    │   │
    │                  │                    │   │
    │              ┌───┘                    │   │
    │              │                        │   │
    ▼              ▼                        ▼   │
JwtModule    UsersService            PaymentProviders
(register)   (exported)              (5 classes)
    │              │                        │
    │         ┌────┘                        │
    │         │ forwardRef ──────────────►  │
    ▼         ▼                             │
  JWT      AdminModule ◄────────────────────┘
Strategy   (forwardRef to:
            UsersModule,
            BillingModule,
            AiProvidersModule,
            AnalyticsModule)

AiProvidersModule
    │
    ├── ProviderRegistryService (exported)
    │       │
    │       ├── OpenRouterProvider
    │       ├── OpenRouterImageProvider
    │       ├── EvolinkProvider
    │       ├── KieProvider
    │       └── ReplicateProvider
    │
    └── PricingService (exported)

GenerationModule
    │
    ├── imports: AiProvidersModule
    ├── imports: UsersModule
    ├── imports: BillingModule (forwardRef)
    ├── imports: StorageModule
    ├── imports: AnalyticsModule
    │
    ├── GenerationService
    ├── GenerationConsumer (Bull)
    └── GenerationGateway (WebSocket)

ChatModule
    │
    ├── imports: AiProvidersModule
    ├── imports: UsersModule
    ├── imports: BillingModule (forwardRef)
    └── imports: AnalyticsModule

StorageModule
    │
    ├── StorageService (exported, S3)
    └── UploadController (⚠️ конфликт с UploadModule)

UploadModule
    │
    └── UploadController (⚠️ конфликт с StorageModule)

AnalyticsModule (Global)
    │
    └── AnalyticsService (exported everywhere)

ReferralModule
    │
    ├── imports: UsersModule
    └── imports: BillingModule (forwardRef)

SupportModule
    │
    └── imports: UsersModule

TelegramBotModule
    │
    ├── imports: UsersModule
    ├── imports: AuthModule
    └── TelegrafModule (forRootAsync)

ModelsModule
    │
    ├── imports: AiProvidersModule
    └── imports: BillingModule (⚠️ мёртвая зависимость)

FavoritesModule
    │
    └── imports: GenerationModule (forwardRef)

HealthModule
    └── (нет зависимостей)

WebhooksModule
    └── (нет зависимостей, ⚠️ заглушка)



# ─── Легенда ─────────────────────────────────────────────────
#  ──►  прямой import
#  ◄──  реэкспорт (exported)
# (forwardRef) циклическая зависимость
# ⚠️  проблема
#
# ─── Критические циклы ───────────────────────────────────────
#
# BillingModule ◄──► GenerationModule
# BillingModule ◄──► ChatModule
# BillingModule ◄──► ReferralModule
# AdminModule   ──►  UsersModule ──► (нет цикла, OK)
# AdminModule   ──►  BillingModule (forwardRef, ⚠️ не нужен)
# AdminModule   ──►  AiProvidersModule (forwardRef, ⚠️ не нужен)
#
# ─── Глобальные модули (доступны везде без import) ───────────
# ConfigModule   → ConfigService
# AnalyticsModule → AnalyticsService
#
# ─── Модули без export (закрытые) ────────────────────────────
# AuthModule     → только контроллер
# ChatModule     → только контроллер
# GenerationModule → только контроллер + gateway
# SupportModule  → только контроллер
# TelegramBotModule → только bot handlers
# HealthModule   → только контроллер
# WebhooksModule → только контроллер
🔧 Конфигурация Docker / деплой

Dockerfile

# ─── Dockerfile (реконструкция по package.json) ──────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
# → dist/ папка

# ─── Production image ─────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

# ⚠️ scripts/ папка нужна для миграций
COPY --from=builder /app/scripts ./scripts

EXPOSE 3000

CMD ["node", "dist/main.js"]

# ─── .dockerignore (рекомендуемый) ───────────────────────────
node_modules
dist
.env
.env.*
*.log
coverage
.git

# ─── docker-compose.yml (рекомендуемый) ──────────────────────
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      PORT: 3000
      MONGODB_URI: mongodb://mongo:27017/app
      REDIS_HOST: redis
      REDIS_PORT: 6379
    depends_on:
      - mongo
      - redis
    restart: unless-stopped
    # ⚠️ Нет healthcheck
    # ⚠️ Нет resource limits
    # ⚠️ Нет volume для логов

  mongo:
    image: mongo:7
    volumes:
      - mongo_data:/data/db
    ports:
      - "27017:27017"    # ⚠️ не открывать в production
    restart: unless-stopped
    command: mongod --wiredTigerCacheSizeGB 1

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"      # ⚠️ не открывать в production
    restart: unless-stopped
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru

volumes:
  mongo_data:
  redis_data:

# ─── Переменные окружения — полный список ────────────────────
# Обязательные (без них приложение не запустится):

NODE_ENV=production
PORT=3000
MONGODB_URI=mongodb://localhost:27017/app
JWT_SECRET=<минимум 32 символа случайной строки>
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...

# Redis (для Bull queue):
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=                    # optional

# S3 хранилище (Timeweb Cloud):
S3_ENDPOINT=https://s3.timeweb.cloud
S3_BUCKET=your-bucket-name
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
S3_REGION=ru-1
S3_PUBLIC_URL=https://s3.timeweb.cloud/your-bucket
# ⚠️ Без S3_PUBLIC_URL все URL файлов будут пустыми строками

# JWT:
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=30d
# ⚠️ При изменении JWT_SECRET все refresh токены становятся невалидными

# Telegram:
TELEGRAM_BOT_USERNAME=your_bot          # без @
MINI_APP_URL=https://t.me/your_bot/app  # URL мини-приложения
FRONTEND_URL=https://your-app.com       # fallback для кнопок
ADMIN_TG_IDS=123456,789012              # через запятую, без пробелов
SUPER_ADMIN_TG_IDS=123456               # через запятую

# AI провайдеры:
OPENROUTER_API_KEY=sk-or-v1-...
EVOLINK_API_KEY=...
EVOLINK_API_URL=https://api.evolink.io/v1
KIE_API_KEY=...
KIE_API_URL=https://api.kie.ai/v1
REPLICATE_API_KEY=r8_...

# Платёжные провайдеры:
YOOKASSA_SHOP_ID=123456
YOOKASSA_SECRET_KEY=live_...
YOOKASSA_WEBHOOK_SECRET=              # ⚠️ не используется (нет верификации)

CRYPTOMUS_MERCHANT_ID=...
CRYPTOMUS_API_KEY=...
CRYPTOMUS_WEBHOOK_SECRET=...

TELEGRAM_STARS_BOT_TOKEN=             # обычно = TELEGRAM_BOT_TOKEN

FREEDOMPAY_MERCHANT_ID=...
FREEDOMPAY_SECRET_KEY=...
FREEDOMPAY_WEBHOOK_SECRET=...
API_PUBLIC_URL=https://your-api.com   # для callback URL FreedomPay

TOCHKA_CLIENT_ID=...
TOCHKA_CLIENT_SECRET=...
TOCHKA_WEBHOOK_SECRET=...
TOCHKA_VERIFY_SIGNATURE=true          # 'false' только для dev

HELEKET_API_KEY=...
HELEKET_WEBHOOK_SECRET=...

# Опциональные:
LOG_LEVEL=info                         # 'debug'|'info'|'warn'|'error'
BULL_CONCURRENCY=3                     # параллельных задач генерации
GENERATION_TIMEOUT_MS=180000           # таймаут генерации (3 мин)
POLL_INTERVAL_MS=3000                  # интервал polling async задач
POLL_MAX_ATTEMPTS=60                   # макс попыток polling
CORS_ORIGINS=https://your-app.com,https://t.me
RATE_LIMIT_TTL=60                      # секунд для rate limit окна
RATE_LIMIT_MAX=100                     # запросов в окне

# ─── Nginx конфигурация (рекомендуемая) ──────────────────────
server {
    listen 443 ssl;
    server_name api.your-app.com;

    ssl_certificate /etc/letsencrypt/.../fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/.../privkey.pem;

    # WebSocket поддержка (для GenerationGateway)
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # SSE поддержка (для ChatModule /chat/stream)
    location /api/v1/chat/stream {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";        # отключить keep-alive буферизацию
        proxy_buffering off;                   # ⚠️ обязательно для SSE
        proxy_cache off;
        proxy_read_timeout 600s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Обычный API
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        client_max_body_size 20m;              # для загрузки файлов
    }
}

# ─── PM2 конфигурация (альтернатива Docker) ──────────────────
# ecosystem.config.js
module.exports = {
  apps: [{
    name: 'api',
    script: 'dist/main.js',
    instances: 1,               // ⚠️ только 1 — WS не поддерживает cluster
                                // при 2+ нужен Redis adapter для Socket.io
    exec_mode: 'fork',          // не cluster
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    max_memory_restart: '1G',
    restart_delay: 5000,
    max_restarts: 10,
  }]
}
⚡ Приоритизированный план исправлений

Typescript

// ════════════════════════════════════════════════════════════
// КРИТИЧНО — исправить до production (блокируют работу)
// ════════════════════════════════════════════════════════════

// [P0-1] SSRF уязвимость в StorageController
// Файл: storage/storage.controller.ts
// Риск: злоумышленник получает доступ к внутренней сети
// Fix:
@Get('download')
// Добавить JWT guard
@UseGuards(JwtAuthGuard)
async downloadFile(@Query('url') url: string) {
  // Валидация URL — только разрешённые домены
  const ALLOWED_DOMAINS = [
    's3.timeweb.cloud',
    'cdn.openai.com',
    'replicate.delivery',
    // ... только AI провайдеры
  ]
  const parsed = new URL(url)
  if (!ALLOWED_DOMAINS.includes(parsed.hostname)) {
    throw new ForbiddenException('URL not allowed')
  }
  return this.storageService.downloadAndProxy(url)
}

// [P0-2] Двойное начисление токенов при подписке
// Файл: billing/billing.service.ts → activateSubscription()
// Риск: пользователь получает токены дважды
// Fix:
async activateSubscription(transactionId: string) {
  // Атомарная проверка + установка флага
  const transaction = await this.transactionModel.findOneAndUpdate(
    { _id: transactionId, status: 'pending', tokensAwarded: { $ne: true } },
    { $set: { tokensAwarded: true, status: 'completed' } },
    { new: true }
  )
  if (!transaction) return // уже обработано
  // теперь начислять токены
}

// [P0-3] Race condition при регистрации (двойной пользователь)
// Файл: users/users.service.ts → findOrCreateByTelegram()
// Fix:
async findOrCreateByTelegram(data: TelegramUserDto) {
  try {
    return await this.userModel.findOneAndUpdate(
      { telegramId: data.telegramId },
      {
        $setOnInsert: {
          ...data,
          bonusTokens: 9,
          referralCode: generateCode(),
          createdAt: new Date()
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
  } catch (err) {
    if (err.code === 11000) {
      // Дубль — просто найти
      return this.userModel.findOne({ telegramId: data.telegramId })
    }
    throw err
  }
}

// [P0-4] Webhook без верификации (Stars, YooKassa)
// Файл: billing/billing.service.ts
// Риск: злоумышленник создаёт фейковые платежи
// Fix для YooKassa:
async verifyYooKassaWebhook(body: any, signature: string): Promise<boolean> {
  const secret = this.config.get('YOOKASSA_WEBHOOK_SECRET')
  if (!secret) {
    this.logger.error('YOOKASSA_WEBHOOK_SECRET not set')
    return false
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex')
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  )
}

// [P0-5] Конфликт маршрутов POST /upload/image
// Файл: app.module.ts
// Риск: непредсказуемое поведение — какой контроллер ответит
// Fix: убрать дублирующий UploadController или
//      объединить StorageModule + UploadModule

// ════════════════════════════════════════════════════════════
// ВЫСОКИЙ — исправить в течение недели
// ════════════════════════════════════════════════════════════

// [P1-1] cashbackBalance не входит в totalBalance
// Затронуто: auth.service.ts, users.service.ts, billing.service.ts
// Fix: везде где считается баланс:
const totalBalance = user.tokenBalance + user.bonusTokens + user.cashbackBalance

// [P1-2] Неатомарный deductTokens
// Файл: users/users.service.ts
// Fix:
async deductTokens(userId: string, amount: number): Promise<boolean> {
  // Атомарный conditional update
  const result = await this.userModel.updateOne(
    {
      _id: userId,
      $expr: {
        $gte: [
          { $add: ['$tokenBalance', '$bonusTokens', '$cashbackBalance'] },
          amount
        ]
      }
    },
    [{
      $set: {
        // Сначала тратим bonusTokens, потом tokenBalance, потом cashback
        bonusTokens: {
          $max: [0, { $subtract: ['$bonusTokens', amount] }]
        },
        tokenBalance: {
          $max: [0, {
            $subtract: [
              '$tokenBalance',
              { $max: [0, { $subtract: [amount, '$bonusTokens'] }] }
            ]
          }]
        },
        // cashback тратится в последнюю очередь аналогично
      }
    }]
  )
  return result.modifiedCount > 0
}

// [P1-3] PENDING генерации без recovery
// Fix: добавить cron задачу
@Cron('0 */5 * * * *') // каждые 5 минут
async recoverStuckGenerations() {
  const stuckThreshold = new Date(Date.now() - 10 * 60 * 1000) // 10 минут
  const stuck = await this.generationModel.find({
    status: 'pending',
    createdAt: { $lt: stuckThreshold }
  }).limit(50)

  for (const gen of stuck) {
    this.logger.warn(`Recovering stuck generation ${gen._id}`)
    await this.generationQueue.add('process', { generationId: gen._id })
  }
}

// [P1-4] settings перезаписывает весь объект
// Fix:
async updateSettings(userId: string, settings: Partial<UserSettings>) {
  // Использовать dot-notation для partial update
  const updateQuery = {}
  for (const [key, value] of Object.entries(settings)) {
    updateQuery[`settings.${key}`] = value
  }
  return this.userModel.findByIdAndUpdate(
    userId,
    { $set: updateQuery },
    { new: true }
  )
}

// [P1-5] Реквизиты вывода открытым текстом
// Fix: шифровать перед сохранением
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

encryptRequisites(data: string): string {
  const key = Buffer.from(this.config.get('ENCRYPTION_KEY'), 'hex') // 32 bytes
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()])
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}

decryptRequisites(data: string): string {
  const [ivHex, encryptedHex] = data.split(':')
  const key = Buffer.from(this.config.get('ENCRYPTION_KEY'), 'hex')
  const iv = Buffer.from(ivHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')
  const decipher = createDecipheriv('aes-256-cbc', key, iv)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

// ════════════════════════════════════════════════════════════
// СРЕДНИЙ — исправить в течение месяца
// ════════════════════════════════════════════════════════════

// [P2-1] Добавить cron деактивации подписок
@Cron('0 0 * * * *') // каждый час
async deactivateExpiredSubscriptions() {
  const expired = await this.subscriptionModel.find({
    isActive: true,
    expiresAt: { $lt: new Date() },
    expiresAt: { $ne: null }
  })
  for (const sub of expired) {
    await this.subscriptionModel.updateOne(
      { _id: sub._id },
      { $set: { isActive: false } }
    )
    await this.userModel.updateOne(
      { _id: sub.userId },
      { $set: { subscriptionPlan: 'free' } }
    )
    // TODO: уведомить пользователя через бот
  }
}

// [P2-2] Добавить индексы MongoDB
// Файл: users/schemas/user.schema.ts
@Schema()
@Index({ lastActiveAt: -1 })           // для admin сортировки
@Index({ isActive: 1 })                // для фильтрации
@Index({ referralCount: -1 })          // для топа рефералов
export class User {}

// [P2-3] Устранить N+1 в getProvidersForModel
// Fix: один запрос вместо N
async getProvidersForModel(modelSlug: string) {
  const model = await this.aiModelModel
    .findOne({ slug: modelSlug })
    .lean()
  if (!model) return []

  const providerSlugs = model.providerMappings
    .filter(m => m.isActive)
    .map(m => m.providerSlug)

  // Один запрос вместо N
  const providers = await this.providerModel.find({
    slug: { $in: providerSlugs },
    isActive: true
  }).lean()

  const providerMap = new Map(providers.map(p => [p.slug, p]))

  return model.providerMappings
    .filter(m => m.isActive && providerMap.has(m.providerSlug))
    .sort((a, b) => a.priority - b.priority)
}

// [P2-4] Добавить enum для eventType в Analytics
// Файл: analytics/analytics.service.ts
export enum AnalyticsEventType {
  USER_REGISTERED    = 'user_registered',
  USER_LOGIN         = 'user_login',
  GENERATION_STARTED = 'generation_started',
  GENERATION_COMPLETED = 'generation_completed',
  GENERATION_FAILED  = 'generation_failed',
  PAYMENT_INITIATED  = 'payment_initiated',
  PAYMENT_COMPLETED  = 'payment_completed',
  SUBSCRIPTION_ACTIVATED = 'subscription_activated',
  PROMO_APPLIED      = 'promo_applied',
  REFERRAL_CREATED   = 'referral_created',
  WITHDRAWAL_CREATED = 'withdrawal_created',
}

// [P2-5] Добавить уведомления бота
// Файл: telegram-bot/telegram-bot.service.ts
async notifyUser(telegramId: number, message: string): Promise<void> {
  try {
    await this.bot.telegram.sendMessage(telegramId, message, {
      parse_mode: 'HTML'
    })
  } catch (err) {
    // Пользователь мог заблокировать бота
    this.logger.warn(`Cannot notify user ${telegramId}: ${err.message}`)
  }
}

// Вызывать при активации подписки:
await this.telegramBotService.notifyUser(
  user.telegramId,
  `✅ <b>Подписка активирована!</b>\n\nПлан: ${plan}\nДействует до: ${expiresAt}`
)

// [P2-6] Health check — реальные проверки
@Get()
async getHealth() {
  const checks = await Promise.allSettled([
    this.checkMongoDB(),
    this.checkRedis(),
    this.checkBullQueue(),
  ])

  const results = {
    mongodb: checks[0].status === 'fulfilled' ? 'ok' : 'error',
    redis:   checks[1].status === 'fulfilled' ? 'ok' : 'error',
    bull:    checks[2].status === 'fulfilled' ? 'ok' : 'error',
  }

  const allOk = Object.values(results).every(v => v === 'ok')

  // Правильный HTTP статус код
  if (!allOk) {
    throw new HttpException(
      { status: 'error', checks: results },
      HttpStatus.SERVICE_UNAVAILABLE
    )
  }

  return { status: 'ok', checks: results, uptime: process.uptime() }
}

// ════════════════════════════════════════════════════════════
// НИЗКИЙ — технический долг, улучшения
// ════════════════════════════════════════════════════════════

// [P3-1] Унифицировать два алгоритма расчёта цены
//        pricingService.calculatePrice() vs matchPricingTier()

// [P3-2] Убрать хардкоды в константы
export const SYSTEM_CONSTANTS = {
  NEW_USER_BONUS_TOKENS: 9,
  REFERRAL_BONUS_TOKENS: 10,
  REFERRAL_CASHBACK_PERCENT: 10,
  RUB_PER_TOKEN: 1,           // для расчёта выплат
  USD_PER_TOKEN: 0.01,
  UNLIMITED_TOKENS_SENTINEL: 999999,
  SUPPORT_LINK: process.env.SUPPORT_LINK || 'https://t.me/support',
  MAX_CONTEXT_MESSAGES: 50,
  ANALYTICS_TTL_DAYS: 90,
}

// [P3-3] Добавить тесты для критичных сервисов
// Приоритет:
// 1. BillingService.activateSubscription (двойное начисление)
// 2. UsersService.deductTokens (атомарность)
// 3. GenerationConsumer.process (полный флоу)
// 4. AuthService.validateTelegramInitData (безопасность)
// 5. ReferralService.createWithdrawal (финансы)

// [P3-4] Добавить Redis adapter для Socket.io (горизонтальный скейлинг)
// Файл: main.ts
import { createAdapter } from '@socket.io/redis-adapter'
import { createClient } from 'redis'

const pubClient = createClient({ url: redisUrl })
const subClient = pubClient.duplicate()
await Promise.all([pubClient.connect(), subClient.connect()])
io.adapter(createAdapter(pubClient, subClient))

// [P3-5] Заменить setTimeout на Bull в UploadModule
// Вместо:
setTimeout(() => this.storageService.deleteFile(key), 24 * 60 * 60 * 1000)
// Использовать:
await this.cleanupQueue.add(
  'delete-file',
  { key },
  { delay: 24 * 60 * 60 * 1000, attempts: 3 }
)
📋 Чеклист перед production

Bash

# ─── Безопасность ─────────────────────────────────────────────
[ ] JWT_SECRET установлен (минимум 32 символа)
[ ] NODE_ENV=production (закрывает /auth/dev)
[ ] SSRF уязвимость исправлена (/upload/download)
[ ] Webhook верификация включена (YooKassa, Stars, KIE)
[ ] TOCHKA_VERIFY_SIGNATURE=true
[ ] Реквизиты вывода шифруются
[ ] CORS_ORIGINS ограничен (не *)
[ ] MongoDB не открыт наружу (только localhost/internal)
[ ] Redis не открыт наружу
[ ] S3 bucket не публичный (только через S3_PUBLIC_URL)

# ─── Функциональность ─────────────────────────────────────────
[ ] Все AI провайдеры настроены и протестированы
[ ] Все платёжные провайдеры настроены
[ ] Webhook URLs зарегистрированы у провайдеров
[ ] Telegram Bot webhook зарегистрирован
[ ] S3_PUBLIC_URL установлен (иначе битые URL)
[ ] ADMIN_TG_IDS установлен
[ ] Seed скрипты запущены (billing, pricing)
[ ] Индексы MongoDB созданы (проверить через db.collection.getIndexes())

# ─── Производительность ───────────────────────────────────────
[ ] MongoDB индексы добавлены (lastActiveAt, isActive, referralCount)
[ ] Bull concurrency настроен (BULL_CONCURRENCY)
[ ] PM2/Docker запущен в fork mode (не cluster — из-за WS)
[ ] Nginx настроен с proxy_buffering off для SSE
[ ] Nginx настроен с Upgrade/Connection для WebSocket

# ─── Мониторинг ───────────────────────────────────────────────
[ ] Логи пишутся в файл (не только stdout)
[ ] Health endpoint отвечает реально (MongoDB + Redis)
[ ] Настроены алерты на ошибки (Sentry / свой логгер)
[ ] Мониторинг Bull queue (зависшие задачи)
[ ] Мониторинг PENDING транзакций (зависшие платежи)

# ─── Данные ───────────────────────────────────────────────────
[ ] Резервное копирование MongoDB настроено
[ ] Миграция M4 запущена (cashbackBalance)
[ ] Миграция M9 запущена (деактивация истёкших подписок)
[ ] Cron деактивации подписок добавлен
[ ] Recovery для PENDING генераций добавлен

# ─── Тестирование ─────────────────────────────────────────────
[ ] Тест: регистрация нового пользователя через бот
[ ] Тест: оплата через каждый провайдер (sandbox)
[ ] Тест: генерация через каждый AI провайдер
[ ] Тест: WebSocket получает события
[ ] Тест: SSE chat stream работает
[ ] Тест: промокод применяется корректно
[ ] Тест: реферальная программа начисляет кэшбек
[ ] Тест: вывод кэшбека создаётся и обрабатывается
[ ] Тест: admin панель доступна только для admins
[ ] Тест: banned пользователь не может авторизоваться