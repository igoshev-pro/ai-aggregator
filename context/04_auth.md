📦 Контекст: Backend (NestJS) — Блок 4: Auth Module

🗂️ Структура модуля


src/modules/auth/
├── auth.module.ts
├── auth.controller.ts
├── auth.service.ts
├── admin-bootstrap.service.ts
├── dto/
│   └── telegram-auth.dto.ts
└── strategies/
    └── jwt.strategy.ts
🔗 Зависимости модуля

Typescript

AuthModule imports:
  forwardRef → UsersModule      (UsersService)
  forwardRef → ReferralModule   (ReferralService)
  PassportModule (defaultStrategy: 'jwt')
  JwtModule.registerAsync (secret: JWT_SECRET, expiresIn: JWT_EXPIRATION || '7d')

exports:
  AuthService
  AdminBootstrapService
📡 API Эндпоинты


POST /auth/telegram         Mini App авторизация через initData      [публичный]
POST /auth/telegram-widget  Login Widget авторизация                 [публичный]
POST /auth/dev              DEV-режим авторизация                    [публичный, только !production]
GET  /auth/refresh          Обновление JWT токена                    [JWT required]
🔐 Методы авторизации

1. Mini App Auth (POST /auth/telegram)

Входные данные: TelegramAuthDto { initData: string, referralCode?: string }

Алгоритм:


1. DEV bypass: если isDev && (initData.includes('test') || 'dev') → handleDevTelegramAuth()
2. validateAndParseInitData(initData) → TelegramUser | null
3. findByTelegramId(user.id) → определяем isNewUser
4. findOrCreateByTelegram(telegramUser, referralCode)
5. adminBootstrap.syncRoleFromEnv(user)
6. Проверка isBanned ПОСЛЕ syncRoleFromEnv
7. Если isNewUser && user.referredBy → referralService.recordReferral()
8. buildAuthResponse(user) → { token, user }
Валидация initData (validateAndParseInitData):

Typescript

// Алгоритм проверки (Telegram WebApp):
secretKey = HMAC-SHA256('WebAppData', botToken)
hash = HMAC-SHA256(secretKey, dataCheckString)

// dataCheckString — все параметры кроме hash, отсортированные по ключу:
"auth_date=...\nquery_id=...\nuser=..."

// Проверка свежести:
// DEV: maxAge = 30 дней
// PROD: maxAge = 24 часа
2. Telegram Login Widget Auth (POST /auth/telegram-widget)

Входные данные: TelegramWidgetAuthDto { id, first_name, last_name?, username?, photo_url?, auth_date, hash, referralCode? }

DEV bypass: dto.hash === 'dev_bypass'

Валидация (validateWidgetData):

Typescript

// Алгоритм проверки (Login Widget):
// ОТЛИЧИЕ от Mini App: секрет = SHA256(botToken), не HMAC!
secretKey = SHA256(botToken)
hash = HMAC-SHA256(secretKey, dataCheckString)

// dataCheckString из полей: id, first_name, last_name, username, photo_url, auth_date
// Только присутствующие поля (undefined исключаются)
// Отсортированные по ключу, формат "key=value\n..."

// Проверка свежести:
// DEV: maxAge = 30 дней
// PROD: maxAge = 24 часа
⚠️ Важное различие криптографии:

Mini App: HMAC('WebAppData', botToken) → секрет
Widget: SHA256(botToken) → секрет Оба используют HMAC-SHA256(секрет, dataCheckString) для финального хеша.
3. DEV Auth (POST /auth/dev)

Typescript

// Контроллер: проверка NODE_ENV === 'production' → throw Error (не HttpException!)
// Сервис: дополнительная проверка isDev
// Устанавливает 10000 tokenBalance + 5000 bonusTokens если баланс пустой
// Синхронизирует роль из .env ПЕРВЫМ, затем опционально применяет role из body
⚠️ Контроллер бросает throw new Error(...) вместо throw new HttpException(...) — вернёт 500 вместо 403.

⚠️ POST /auth/dev нет в AuthController защиты через Guard — только process.env.NODE_ENV проверка. Если NODE_ENV не установлен — эндпоинт доступен.

4. Token Refresh (GET /auth/refresh)

Typescript

// Требует валидный JWT (JwtAuthGuard)
// Создаёт новый токен из актуальных данных пользователя из БД
// НЕ проверяет isBanned при refresh — только JwtStrategy.validate() проверяет
// Возвращает только { token } без user объекта
🎫 JWT

JwtPayload (в токене)

Typescript

{
  sub: string           // userId (ObjectId как string)
  telegramId?: number
  email?: string
  authProvider: AuthProvider
  role: UserRole
  iat: number           // issued at (автоматически)
  exp: number           // expiration (автоматически)
}
JwtStrategy.validate() — что попадает в req.user

Typescript

// При каждом запросе с JWT:
// 1. Декодирует payload
// 2. Загружает актуального юзера из БД (findById)
// 3. Проверяет isActive && !isBanned
// 4. Возвращает расширенный объект:
{
  ...payload,           // sub, iat, exp, telegramId, email, authProvider, role из токена
  userId: payload.sub,  // alias для удобства
  role: user.role,      // АКТУАЛЬНАЯ роль из БД (перезаписывает из токена)
  telegramId: user.telegramId,
  username: user.username,
  firstName: user.firstName,
  lastName: user.lastName,
}
⚠️ role берётся из БД при каждом запросе — это правильно, т.к. смена роли в БД немедленно вступает в силу без перевыпуска токена.

⚠️ Если findById бросает исключение (например MongoNetworkError) — внешний try/catch ловит ВСЁ и бросает UnauthorizedException. При временных сбоях БД все пользователи получат 401.

🛡️ AdminBootstrapService

Назначение

Синхронизирует роль пользователя с переменными окружения ADMIN_TG_IDS / SUPER_ADMIN_TG_IDS. Вызывается при каждом логине.

Конфигурация (.env)


ADMIN_TG_IDS=123456789,987654321
SUPER_ADMIN_TG_IDS=111111111
Формат: числа через запятую. Парсится в Set<number> при старте приложения.

Логика syncRoleFromEnv()


telegramId отсутствует → return без изменений

isSuperAdmin (в SUPER_ADMIN_TG_IDS):
  → targetRole = SUPER_ADMIN

isAdmin (в ADMIN_TG_IDS):
  currentRole === SUPER_ADMIN → не трогаем (нет targetRole)
  иначе → targetRole = ADMIN

Не в обоих списках:
  currentRole === ADMIN или SUPER_ADMIN → targetRole = USER (понижение с логом)
  иначе → не трогаем

Если targetRole !== currentRole → user.role = targetRole, user.save()
⚠️ Пользователи без telegramId (email/OAuth) не синхронизируются — их роль нельзя управлять через ADMIN_TG_IDS.

⚠️ Вызов user.save() при каждом логине если роль изменилась — write на каждый auth. Для 100+ одновременных логинов — нагрузка.

📝 AuthResponseDto

Typescript

{
  token: string
  user: {
    id: string
    telegramId: number | null
    authProvider: string
    email: string | null
    firstName: string
    lastName: string
    username: string
    photoUrl: string
    role: string
    tokenBalance: number
    bonusTokens: number
    totalBalance: number          // tokenBalance + bonusTokens (без cashbackBalance!)
    subscription: {
      plan: string
      expiresAt: string | null    // ISO 8601
      isActive: boolean
    }
    referralCode: string
    createdAt: string | null      // ISO 8601
  }
}
⚠️ totalBalance = tokenBalance + bonusTokens — не включает cashbackBalance. Фронт видит неполный баланс.

⚠️ subscriptionActive определяется как plan !== 'free' && expiresAt !== null && expiresAt > now. Если план 'pro' но expiresAt === null (бессрочный) → isActive = false. Бессрочные подписки не поддерживаются.

🔄 Referral при регистрации

Typescript

// Условие записи реферала:
isNewUser &&           // первый вход пользователя
user.referredBy        // referredBy установлен в findOrCreateByTelegram()

// Вызывает: referralService.recordReferral(referrerId, newUserId)
// Ошибки: глотаются (logger.warn) — не блокируют авторизацию
⚠️ isNewUser определяется через findByTelegramId ДО findOrCreateByTelegram. Между этими двумя запросами есть race condition — два одновременных запроса могут оба решить что пользователь новый.

🌍 Env переменные модуля


JWT_SECRET            обязательный — секрет подписи JWT
JWT_EXPIRATION        опциональный, дефолт '7d'
TELEGRAM_BOT_TOKEN    обязательный для production auth
NODE_ENV              'production' | 'development' | др.
ADMIN_TG_IDS          опциональный — "id1,id2,id3"
SUPER_ADMIN_TG_IDS    опциональный — "id1,id2"
⚠️ Замеченные проблемы

🔴 Критичные

POST /auth/dev доступен без NODE_ENV — если переменная не установлена, process.env.NODE_ENV === 'production' → false → эндпоинт открыт. Контроллер бросает Error (не HttpException) → 500 вместо 403 в production.

Race condition isNewUser — findByTelegramId → findOrCreateByTelegram не атомарны. При concurrent запросах один пользователь может быть посчитан "новым" дважды → двойной recordReferral.

JwtStrategy глотает ВСЕ ошибки — catch { throw new UnauthorizedException() } превращает ошибки БД/сети в 401. Пользователи не могут войти при кратковременном сбое MongoDB.

isBanned проверяется ПОСЛЕ syncRoleFromEnv — если забаненный пользователь есть в ADMIN_TG_IDS, его роль обновится до ADMIN до того как придёт 401. Роль синхронизируется даже для забаненных пользователей.

🟡 Средние

totalBalance без cashbackBalance — tokenBalance + bonusTokens не учитывает кэшбек. Фронт показывает неполный баланс.

Бессрочные подписки — subscriptionActive требует expiresAt !== null. Нет поддержки lifetime-планов.

DEV bypass по содержимому строки — initData.includes('test') || initData.includes('dev') — слишком широкий матч. Настоящий initData содержащий слово 'test' в username обойдёт валидацию в dev-режиме.

devAuth принимает role параметр но контроллер его не передаёт — сигнатура devAuth(userId, username?, role?) но AuthController.devAuth вызывает без role. Параметр мёртвый.

forwardRef на UsersModule и ReferralModule — оба через forwardRef. Признак цикличных зависимостей: Auth → Users → ?, Auth → Referral → ?.

refreshToken не проверяет isBanned — только JwtStrategy.validate() проверяет бан. Если JwtStrategy каким-то образом пропущен — забаненный получит новый токен.

🟢 Минорные

Дублирование кода — блок findByTelegramId → isNewUser → findOrCreateByTelegram → syncRoleFromEnv → recordReferral повторяется 3 раза (telegram, widget, widget dev-bypass). Нужен приватный метод handleSuccessfulAuth().

handleDevTelegramAuth игнорирует _referralCode — параметр с префиксом _ никогда не используется. Реферальный код теряется в DEV Telegram auth.

Логирование хешей в dev — logger.warn выводит ожидаемый и полученный хеши при mismatch. В dev это полезно, но если dev-логи попадут в мониторинг — потенциальная утечка.

createdAt в AuthResponseDto — user.createdAt ? user.createdAt.toISOString() : null — timestamps: true гарантирует наличие createdAt, null невозможен после сохранения.