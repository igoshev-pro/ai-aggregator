📦 Контекст: Backend (NestJS) — Блок 2: Структура, Common, Config

🗂️ Структура src/


src/
├── app.module.ts
├── main.ts
├── config/
│   └── configuration.ts
├── common/
│   ├── decorators/
│   │   ├── current-user.decorator.ts
│   │   └── roles.decorator.ts
│   ├── filters/
│   │   └── global-exception.filter.ts
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   ├── roles.guard.ts
│   │   └── telegram-auth.guard.ts
│   ├── interceptors/
│   │   ├── logging.interceptor.ts
│   │   └── timeout.interceptor.ts
│   └── interfaces/
│       └── index.ts
└── modules/
    (19 модулей)
⚙️ src/config/configuration.ts

Единый конфиг-объект, загружается через ConfigModule.forRoot({ load: [configuration] }).

Структура конфига

Typescript

config.get('port')           // 3001
config.get('nodeEnv')        // 'development'

// Вложенные через точку:
config.get('mongo.uri')
config.get('redis.host')
config.get('redis.port')
config.get('redis.password')

config.get('jwt.secret')
config.get('jwt.expiration')   // '7d'

config.get('telegram.botToken')
config.get('telegram.botUsername')

config.get('providers.openrouter.apiKey')
config.get('providers.openrouter.baseUrl')
config.get('providers.evolink.apiKey')
config.get('providers.evolink.baseUrl')
config.get('providers.kie.apiKey')
config.get('providers.kie.baseUrl')   // 'https://api.kie.ai' (без /v1!)
config.get('providers.replicate.apiKey')

config.get('payment.yookassa.*')
config.get('payment.cryptomus.*')
config.get('payment.freedompay.*')
config.get('payment.heleket.*')

config.get('s3.endpoint')
config.get('s3.bucket')
config.get('s3.accessKey')
config.get('s3.secretKey')
config.get('s3.region')

config.get('defaultPricing.text')   // { 'gpt-4o': 3, ... }
config.get('defaultPricing.image')
config.get('defaultPricing.video')
config.get('defaultPricing.audio')
defaultPricing — цены в "спичках"


TEXT:
  gpt-4o: 3          claude-3.5-sonnet: 3    grok-3: 3
  gpt-4o-mini: 1     claude-3-haiku: 1       perplexity-sonar: 2
  gemini-2.0-flash:1 gemini-1.5-pro: 3       qwen-2.5-72b: 2
  deepseek-v3: 1     deepseek-r1: 2

IMAGE:
  midjourney: 10     seedream: 5
  dall-e-3: 5        imagen-3: 5
  flux-pro: 5        chatgpt-images: 5
  stable-diffusion-xl: 3  nano-banana: 5

VIDEO:
  sora: 30           luma-ray2: 20
  kling-1.6: 20      pika-2.0: 15
  runway-gen3: 25    hailuo: 15
  veo-2: 25

AUDIO:
  suno-v4: 10
  elevenlabs: 5
⚠️ defaultPricing в конфиге — это fallback. Актуальные цены хранятся в MongoDB в коллекции моделей (ModelsModule). Конфиг используется как начальные значения при создании модели или если модель не найдена в БД.

⚠️ providers.kie.baseUrl = 'https://api.kie.ai' — без /v1. Нужно учитывать при формировании URL в KieService (добавлять /v1 вручную или уже в сервисе).

FreedomPay специфика

Typescript

freedompay: {
  merchantId: parseInt(...),     // number, не string!
  testingMode: 0 | 1,           // number, не boolean
  rubToKzt: 5.7,                // float — курс конвертации
}
Tochka — не в configuration.ts!

Tochka параметры (TOCHKA_JWT, TOCHKA_CUSTOMER_CODE и др.) читаются напрямую через configService.get('TOCHKA_*') в billing модуле, а не через вложенный объект конфига. Это непоследовательно с остальными провайдерами.

🔧 src/common/

Декораторы

@CurrentUser(field?)

Typescript

// Использование в контроллере:
@Get('profile')
getProfile(@CurrentUser() user: UserDocument) { ... }

@Get('id')
getId(@CurrentUser('_id') id: string) { ... }
Читает request.user — устанавливается JwtStrategy после валидации токена.

@Roles(...roles)

Typescript

@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
deleteUser() { ... }
Устанавливает metadata 'roles' на роут/класс. Читается RolesGuard.

Guards

JwtAuthGuard — основной guard

Typescript

// Расширяет AuthGuard('jwt') от passport
// Поддерживает публичные роуты:
@SetMetadata('isPublic', true)  // или кастомный @Public() декоратор
@Get('public-route')
publicRoute() { ... }
Логика:

Проверяет metadata 'isPublic' → если true, пропускает без проверки
Иначе запускает JWT стратегию паспорта
⚠️ isPublic читается через строку, не через константу. Если где-то используется @Public() декоратор — он должен устанавливать именно 'isPublic'.

RolesGuard

Typescript

// Работает ПОСЛЕ JwtAuthGuard (user уже в request)
// Проверяет: requiredRoles.some(role => user.role === role)
⚠️ Проверка через some — достаточно совпадения хотя бы одной роли.
⚠️ Иерархии ролей нет — ADMIN не проходит проверку для @Roles(UserRole.SUPER_ADMIN) автоматически. Нужно явно указывать все допустимые роли.

TelegramAuthGuard

Typescript

// Используется для эндпоинтов, вызываемых напрямую из Telegram Mini App
// Header: X-Telegram-Init-Data
Алгоритм валидации (официальный Telegram WebApp):


1. Получить initData из заголовка
2. Извлечь hash из параметров
3. Удалить hash из параметров
4. Отсортировать оставшиеся параметры по ключу
5. Собрать dataCheckString = "key=value\nkey=value..."
6. secretKey = HMAC-SHA256("WebAppData", botToken)
7. calculatedHash = HMAC-SHA256(secretKey, dataCheckString)
8. Сравнить calculatedHash === hash
9. Проверить auth_date: now - auth_date <= 3600 (1 час)
После успешной валидации: request.telegramUser = распарсенный объект пользователя.

⚠️ request.telegramUser — не то же самое что request.user (который устанавливает JwtStrategy). Это разные поля. Контроллеры должны знать какой guard используется и откуда читать пользователя.

⚠️ Лимит валидности initData — 1 час. После истечения Telegram Mini App должен получать новый initData. Если пользователь долго держит открытое приложение — может получить 401.

Interceptors

LoggingInterceptor (глобальный)


Логирует: METHOD /path STATUS - Xms
Пример: POST /api/v1/generation/image 200 - 3421ms
Logger: 'HTTP'
⚠️ Не логирует тело запроса/ответа (правильно для прода, но усложняет отладку).
⚠️ Не логирует ошибки — только успешные ответы (tap без catchError). Ошибки логирует GlobalExceptionFilter.

TimeoutInterceptor

Typescript

// Дефолтный timeout: 120 секунд (2 минуты)
// Используется для генераций — видео может генерироваться долго
new TimeoutInterceptor(120000)

// Можно создать с кастомным значением:
new TimeoutInterceptor(30000)  // 30 сек для обычных API
При превышении кидает RequestTimeoutException (HTTP 408).

⚠️ Глобально не подключён в main.ts — используется локально на контроллерах/методах через @UseInterceptors(new TimeoutInterceptor(N)).

Interfaces (src/common/interfaces/index.ts)

Интерфейсы

Typescript

TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  photo_url?: string
  is_premium?: boolean
}

JwtPayload {
  sub: string           // MongoDB _id пользователя
  telegramId?: number
  email?: string
  authProvider: AuthProvider
  role: UserRole
}
Enums

Typescript

AuthProvider {
  TELEGRAM = 'telegram'
  EMAIL = 'email'
  GOOGLE = 'google'    // есть в enum, но нет реализации в auth модуле
}

UserRole {
  USER = 'user'
  PREMIUM = 'premium'
  ADMIN = 'admin'
  SUPER_ADMIN = 'super_admin'
}

GenerationType {
  TEXT = 'text'
  IMAGE = 'image'
  VIDEO = 'video'
  AUDIO = 'audio'
}

GenerationStatus {
  PENDING = 'pending'
  PROCESSING = 'processing'
  COMPLETED = 'completed'
  FAILED = 'failed'
  CANCELLED = 'cancelled'
}

TransactionType {
  DEPOSIT = 'deposit'
  WITHDRAWAL = 'withdrawal'
  GENERATION = 'generation'
  REFUND = 'refund'
  REFERRAL_BONUS = 'referral_bonus'
  PROMO_CODE = 'promo_code'
  SUBSCRIPTION = 'subscription'
  ADMIN_ADJUSTMENT = 'admin_adjustment'
}

PaymentStatus {
  PENDING = 'pending'
  COMPLETED = 'completed'
  FAILED = 'failed'
  REFUNDED = 'refunded'
}

SubscriptionPlan {
  FREE = 'free'
  BASIC = 'basic'
  PLUS = 'plus'         // активный (был PRO)
  MAX = 'max'           // активный
  ULTIMATE = 'ultimate' // активный
  PRO = 'pro'           // @deprecated → PLUS
  UNLIMITED = 'unlimited' // @deprecated → MAX/ULTIMATE
}
SubscriptionPlan — важно для совместимости


Активные планы: FREE, BASIC, PLUS, MAX, ULTIMATE
Deprecated (в БД могут быть старые записи): PRO, UNLIMITED

При работе с планами нужна нормализация:
  PRO → PLUS
  UNLIMITED → MAX или ULTIMATE (зависит от контекста)
🗺️ Структура modules/ (19 модулей)

Дерево не предоставлено полностью, но из AppModule известны:


src/modules/
├── admin/
├── ai-providers/
├── analytics/
├── auth/
├── billing/
├── chat/
├── favorites/
├── generation/
├── health/
├── models/
├── referral/
├── support/
├── telegram-bot/
├── upload/
└── users/
⚠️ Замеченные проблемы (Блок 2)

🔴 Критичные

TelegramAuthGuard vs JwtAuthGuard — два разных guard'а устанавливают пользователя в разные поля (request.user и request.telegramUser). Контроллеры должны чётко знать какой guard используют. Смешивание приведёт к ошибкам.

RolesGuard без иерархии — SUPER_ADMIN не проходит проверку @Roles(UserRole.ADMIN) автоматически. Нужно либо добавлять оба, либо реализовать иерархию ролей.

🟡 Средние

AuthProvider.GOOGLE — есть в enum, но реализации нет. Если кто-то попытается войти через Google — упадёт.

TimeoutInterceptor не глобальный — нет единой точки применения. Каждый модуль настраивает самостоятельно или не настраивает вообще. Риск зависших запросов без таймаута.

kie.baseUrl без /v1 — 'https://api.kie.ai'. Остальные провайдеры имеют полный baseUrl с версией. Нужно следить при формировании запросов в KieService.

isPublic как строка — нет @Public() декоратора в common. Если он определён где-то в модулях отдельно — может быть несогласованность.

LoggingInterceptor не логирует ошибки — при падении запроса лог будет только из ExceptionFilter без времени выполнения.

🟢 Минорные

defaultPricing в конфиге — устаревшие данные (нет новых моделей добавленных позже). Служит как fallback, но может путать при отладке.

Tochka конфиг не в configuration.ts — читается напрямую из process.env. Непоследовательно, сложнее тестировать.

auth_date проверка 3600 сек — в TelegramAuthGuard. Если нужно увеличить — придётся менять код, а не конфиг.

