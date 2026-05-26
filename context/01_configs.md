📦 Контекст: Backend (NestJS) — Блок 1: Общие настройки и конфигурация

🎯 Назначение проекта

ai-aggregator-backend — NestJS бэкенд для SPICHKI AI платформы. Обслуживает:

Telegram Mini App и веб-клиент (фронтенд на Next.js)
Telegram Bot (отдельный модуль)
Админ-панель
🛠️ Технологический стек

Core

Технология	Версия	Назначение
NestJS	^10.4.0	Framework (DI, модули, декораторы)
Node.js	20-alpine	Runtime
TypeScript	^5.4.0	Типизация
MongoDB	через Mongoose ^8.4.0	Основная БД
Redis	через ioredis ^5.3.0	Кэш + Bull очереди
Инфраструктура

Библиотека	Назначение
@nestjs/bull + bull ^4.12.0	Фоновые задачи (очереди генераций)
@nestjs/schedule ^4.0.0	Cron-задачи
@nestjs/websockets + socket.io ^4.8.3	WebSocket для статусов генерации
@nestjs/swagger ^7.3.0	Swagger документация
@nestjs/throttler ^5.1.0	Rate limiting
helmet ^7.1.0	Security headers
Auth & Security

Библиотека	Назначение
@nestjs/jwt ^10.2.0	JWT токены
@nestjs/passport + passport-jwt	JWT стратегия
bcryptjs ^2.4.3	Хэширование паролей
jsonwebtoken ^9.0.3	Прямая работа с JWT
AI Провайдеры

Библиотека	Назначение
axios ^1.13.6	HTTP запросы к AI API
form-data ^4.0.5	Multipart для AI API
Платежи & Файлы

Библиотека	Назначение
xml2js ^0.6.2	Парсинг XML (FreedomPay)
@aws-sdk/client-s3 ^3.1010.0	S3-совместимое хранилище (Timeweb)
multer ^2.1.1	Upload файлов
Telegram

Библиотека	Назначение
nestjs-telegraf ^2.9.1	NestJS интеграция Telegraf
telegraf ^4.16.3	Telegram Bot SDK
⚙️ TypeScript конфигурация


target: ES2021
module: commonjs
strictNullChecks: true       ✅ включён
noImplicitAny: false         ⚠️ выключен — any разрешён
emitDecoratorMetadata: true  обязательно для NestJS DI
experimentalDecorators: true обязательно для декораторов
incremental: true            ускорение пересборки
skipLibCheck: true           пропуск проверки node_modules
Path aliases:


@/*        → src/*
@common/*  → src/common/*
@modules/* → src/modules/*
@config/*  → src/config/*
⚠️ noImplicitAny: false — TypeScript не ругается на any. В связке с фронтом где тоже много any — риск накопления непойманных ошибок типов.

🌍 Переменные окружения

App


PORT=3001
NODE_ENV=development
API_PREFIX=api/v1
Базы данных


MONGO_URI=mongodb://admin:password@localhost:27017/ai-aggregator?authSource=admin
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=xxx
JWT & Auth


JWT_SECRET=xxx          ⚠️ менять в проде!
JWT_EXPIRATION=7d
Telegram


TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_BOT_USERNAME=spichki_ai_bot
MINI_APP_URL=https://spichki-ai.net
TG_BOT_USERNAME=spichki_ai_bot   ⚠️ дублирует TELEGRAM_BOT_USERNAME
AI Провайдеры


OPENROUTER_API_KEY=xxx       основной LLM провайдер
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

EVOLINK_API_KEY=xxx          image/video/audio генерация
EVOLINK_BASE_URL=https://api.evolink.ai/v1

KIE_API_KEY=xxx              дополнительный провайдер
KIE_BASE_URL=https://api.kie.ai/v1

REPLICATE_API_KEY=xxx        Replicate (image/video)
Платёжные системы


# YooKassa (не используется в UI — legacy?)
YOOKASSA_SHOP_ID=xxx
YOOKASSA_SECRET_KEY=xxx
YOOKASSA_WEBHOOK_SECRET=xxx

# Cryptomus (не используется в UI — legacy?)
CRYPTOMUS_MERCHANT_ID=xxx
CRYPTOMUS_API_KEY=xxx

# FreedomPay (KZ, активный)
FREEDOMPAY_MERCHANT_ID=xxx
FREEDOMPAY_SECRET_KEY=xxx (JWT)
FREEDOMPAY_BASE_URL=https://api.freedompay.kz
FREEDOMPAY_CURRENCY=KZT
FREEDOMPAY_RUB_TO_KZT=6.25
FREEDOMPAY_TESTING_MODE=0

# Точка (РФ, активный)
TOCHKA_API_URL=https://enter.tochka.com/uapi
TOCHKA_JWT=xxx
TOCHKA_CUSTOMER_CODE=xxx
TOCHKA_MERCHANT_ID=xxx
TOCHKA_CLIENT_ID=xxx
TOCHKA_VERIFY_SIGNATURE=false  ⚠️ отключена верификация подписи!
TOCHKA_REDIRECT_URL=https://spichki-ai.net/topup/success
TOCHKA_FAIL_REDIRECT_URL=https://spichki-ai.net/topup/fail
TOCHKA_PAYMENT_TTL_MIN=60

# Heleket (Crypto, активный)
HELEKET_MERCHANT_ID=xxx
HELEKET_API_KEY=xxx
HELEKET_BASE_URL=https://api.heleket.com
HELEKET_WEBHOOK_URL=https://spichki-ai.net/api/v1/billing/webhook/heleket
HELEKET_RETURN_URL=https://spichki-ai.net/topup/success
S3 хранилище (два блока — дубль!)


# Блок 1 (Yandex Cloud — скорее всего старый):
S3_ENDPOINT=https://storage.yandexcloud.net
S3_BUCKET=ai-aggregator
S3_REGION=ru-central1

# Блок 2 (Timeweb Cloud — актуальный):
S3_ENDPOINT=https://s3.timeweb.cloud
S3_REGION=ru-1
S3_BUCKET=your-bucket-name
S3_PUBLIC_URL=https://s3.timeweb.cloud/your-bucket-name

# Общие:
S3_ACCESS_KEY=xxx
S3_SECRET_KEY=xxx
⚠️ S3_ENDPOINT объявлен дважды с разными значениями. Второй блок (Timeweb) перезапишет первый (Yandex). Нужно удалить первый блок.

Rate Limiting & CORS


THROTTLE_TTL=60       (секунды)
THROTTLE_LIMIT=60     (запросов за TTL)
CORS_ORIGINS=http://localhost:3000,https://yourdomain.com
API_PUBLIC_URL=https://spichki-ai.net
🏛️ Архитектура AppModule

16 Feature Modules


AuthModule           /auth/*           JWT + Telegram auth
UsersModule          /users/*          Профили, балансы
BillingModule        /billing/*        Платежи, подписки, пакеты
AiProvidersModule    (internal)        Клиенты AI API
GenerationModule     /generation/*     Image/Video/Audio генерация
ModelsModule         /models/*         Каталог AI моделей
ChatModule           /chats/*          LLM чат + SSE стриминг
FavoritesModule      /favorites/*      Избранное
AdminModule          /admin/*          Админ-панель API
ReferralModule       /referral/*       Реферальная программа
SupportModule        /support/*        Тикеты поддержки
AnalyticsModule      (internal)        Аналитика
HealthModule         /health           Healthcheck endpoint
UploadModule         /upload/*         Загрузка файлов → S3
TelegramBotModule    (bot, не HTTP)    Telegram Bot команды
Глобальные модули


ConfigModule    isGlobal: true    доступен везде без импорта
Инфраструктура (в AppModule)


MongooseModule    autoIndex: true    ⚠️ в проде лучше false (замедляет старт)
BullModule        очереди генераций
ThrottlerModule   rate limiting
ScheduleModule    cron задачи
Bull Queue defaults


removeOnComplete: 100   хранить 100 последних завершённых
removeOnFail: 50        хранить 50 последних упавших
attempts: 3             3 попытки
backoff: exponential, delay: 2000ms
🚀 main.ts — Bootstrap

Порядок middleware


1. helmet()                           Security headers
2. bodyParser.urlencoded(5mb)         Form data
3. bodyParser.text для /billing/webhook/tochka  ← Точка шлёт text/plain с JWT
4. bodyParser.json(5mb)               JSON body
5. CORS (из CORS_ORIGINS env)
6. Global prefix: api/v1
7. ValidationPipe (whitelist + transform)
8. GlobalExceptionFilter
9. LoggingInterceptor
10. IoAdapter (Socket.io WebSocket)
11. Swagger (только не в production)
ValidationPipe настройки

Typescript

{
  whitelist: true,              // удаляет неизвестные поля из DTO
  forbidNonWhitelisted: true,   // 400 если есть неизвестные поля
  transform: true,              // авто-трансформация типов
  transformOptions: {
    enableImplicitConversion: true  // string '42' → number 42
  }
}
Специальный webhook парсинг

Typescript

// Точка банк шлёт вебхук как text/plain
// Поэтому ПЕРЕД bodyParser.json():
app.use('/api/v1/billing/webhook/tochka',
  bodyParser.text({ type: '*/*', limit: '1mb' })
)
⚠️ Порядок важен — если поставить после json-парсера, text/plain не распарсится.

Swagger


URL: /docs (только NODE_ENV !== 'production')
Auth: Bearer JWT + X-Telegram-Init-Data header
Healthcheck


GET /api/v1/health
Используется Docker HEALTHCHECK: wget -qO- http://localhost:3001/api/v1/health
🐳 Docker

Multi-stage build


Stage 1 (builder):
  node:20-alpine
  pnpm install --frozen-lockfile
  pnpm run build → dist/

Stage 2 (production):
  node:20-alpine
  nestjs:nodejs (UID/GID 1001) — непривилегированный
  Копирует: dist/ + node_modules/ + package.json
  EXPOSE 3001
  CMD ["node", "dist/main"]
Healthcheck


Interval: 30s
Timeout: 5s
Retries: 3
Start period: 15s  (даёт время на старт NestJS + MongoDB connection)
⚠️ Пакетный менеджер — pnpm (в отличие от фронта где yarn). Используется pnpm-lock.yaml.

📋 Scripts

Bash

pnpm run build        # nest build → dist/
pnpm run start        # nest start
pnpm run start:dev    # nest start --watch (hot reload)
pnpm run start:prod   # node dist/main
pnpm run lint         # eslint --fix
pnpm run migrate:tokens  # ts-node src/scripts/migrate-token-system.ts
⚠️ migrate:tokens — миграционный скрипт для токенной системы. Значит была смена модели токенов (вероятно с «кредиты» на «спички»). Скрипт существует → нужно понимать нужно ли его запускать на новых окружениях.

⚠️ Замеченные проблемы

🔴 Критичные

TOCHKA_VERIFY_SIGNATURE=false — верификация подписи вебхука отключена. Любой может слать фейковые уведомления об оплате.
S3_ENDPOINT дублируется — два блока с разными значениями в .env. Активный — Timeweb (второй блок).
JWT_SECRET=your-super-secret-jwt-key-change-in-production — дефолтное значение в примере. Если попало в прод — критическая уязвимость.
autoIndex: true в Mongoose — в продакшне замедляет старт, может вызвать проблемы при большом объёме данных.
🟡 Средние

TG_BOT_USERNAME дублирует TELEGRAM_BOT_USERNAME — два env для одного значения. Нужно унифицировать.
YooKassa и Cryptomus — есть в env, но отсутствуют в UI фронта как провайдеры. Либо legacy, либо планируемые.
noImplicitAny: false — любой any разрешён без предупреждений.
FREEDOMPAY_RUB_TO_KZT=6.25 хардкод — курс валюты в env. Актуальный курс ~5.4. Устаревший.
Swagger только в не-production — нет возможности посмотреть документацию в проде без изменения кода.
🟢 Минорные

migrate:tokens скрипт — нет документации когда нужно запускать.
CORS_ORIGINS в .env пример содержит https://yourdomain.com — шаблонное значение, нужно обновить.
logger: ['error', 'warn', 'log', 'debug'] — все уровни включены, в проде лучше убрать debug.
🗺️ Что нужно для следующих блоков


Блок 2: Структура модулей
  → дерево src/modules/
  → src/common/ (filters, interceptors, guards, decorators)
  → src/config/configuration.ts

Блок 3: Auth модуль
  → auth.module.ts, auth.service.ts, auth.controller.ts
  → jwt.strategy.ts, telegram.strategy.ts
  → dto/

Блок 4: Users модуль
  → user.schema.ts (MongoDB модель)
  → users.service.ts

Блок 5: Generation модуль
  → generation.service.ts
  → generation.gateway.ts (WebSocket)
  → generation.processor.ts (Bull queue)

Блок 6: AI Providers модуль
  → openrouter.service.ts
  → evolink.service.ts
  → kie.service.ts

Блок 7: Billing модуль
  → billing.service.ts
  → webhook controllers (tochka, freedompay, heleket)

Блок 8: Models модуль
  → model.schema.ts
  → models.service.ts (uiConfig, priceCalculation)

Блок 9: Chat модуль
  → chat.service.ts
  → streaming logic

Блок 10: Admin модуль
  → admin.guard.ts
  → admin controllers