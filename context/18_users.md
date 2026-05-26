📦 Контекст: Backend (NestJS) — Блок 15: Users Module

🗂️ Структура модуля


src/modules/users/
├── users.module.ts
├── users.controller.ts
├── users.service.ts
└── schemas/
    └── user.schema.ts
🔗 Зависимости модуля

Typescript

UsersModule imports:
  MongooseModule: [User]

exports:
  UsersService

// Нет зависимостей от других модулей приложения
// Используется через forwardRef в:
//   TelegramBotModule (Блок 13)
//   AuthModule, BillingModule, ReferralModule и др.
📡 API Эндпоинты


GET  /users/me           профиль текущего пользователя   [JWT]
PUT  /users/me/settings  обновить настройки              [JWT]

// Все admin-методы (getStats, getLeaderboard) — только в сервисе,
// нет AdminController в этом модуле
🗄️ Схема User — поля

Auth

Typescript

authProvider: AuthProvider     // TELEGRAM | EMAIL | GOOGLE
telegramId: number | null      // sparse unique
email: string | null           // sparse unique, select: false (нет — не скрыт)
passwordHash: string | null    // select: false (скрыт по умолчанию)
isEmailVerified: boolean
googleId: string | null        // sparse unique
isPremiumTelegram: boolean
Profile

Typescript

firstName: string    // default: ''
lastName: string     // default: ''
username: string     // default: ''
photoUrl: string     // default: ''
languageCode: string // default: ''
Balance

Typescript

tokenBalance: number         // купленные токены, default: 0, no min
bonusTokens: number          // промо токены, default: 0, no min
cashbackBalance: number      // кэшбек (тратить/вывести), default: 0, no min
cashbackEarnedTotal: number  // статистика, default: 0, min: 0
totalTokensSpent: number     // статистика, default: 0, no min
totalDeposited: number       // статистика, default: 0, no min

// ⚠️ min: 0 убран намеренно (комментарий в схеме)
//    Защита от отрицательных значений — в normalizeBalances()
// ⚠️ cashbackEarnedTotal имеет min: 0 в схеме, остальные — нет
//    Несоответствие: либо у всех min: 0, либо ни у кого
Role & Subscription

Typescript

role: UserRole                    // USER | ADMIN, default: USER
subscriptionPlan: SubscriptionPlan // FREE | ..., default: FREE
subscriptionExpiresAt: Date | null
Referral

Typescript

referralCode: string              // unique, sparse
referredBy: Types.ObjectId | null // ref: User
referralCount: number
referralEarnings: number
Limits

Typescript

dailyGenerations: number
dailyGenerationsResetAt: Date | null
Status

Typescript

isActive: boolean       // default: true
isBanned: boolean       // default: false
banReason: string
lastActiveAt: Date | null
isDeleted: boolean      // index: true, soft delete
deletedAt: Date | null
deletedBy: Types.ObjectId | null  // ref: User
Settings

Typescript

settings: {
  defaultTextModel?: string
  defaultImageModel?: string
  defaultVideoModel?: string
  theme?: string
  language?: string
  notifications?: boolean
}
📐 Индексы

Typescript

{ telegramId: 1 }  unique, sparse, partialFilter: { telegramId: { $ne: null } }
{ email: 1 }       unique, sparse, partialFilter: { email: { $ne: null } }
{ googleId: 1 }    unique, sparse, partialFilter: { googleId: { $ne: null } }
{ username: 1 }    non-unique (username не уникален по бизнес-логике)
{ role: 1 }
{ createdAt: -1 }
{ isDeleted: 1 }   из @Prop({ index: true })

// ⚠️ Нет индекса на { lastActiveAt: 1 } — используется в getStats()
//    countDocuments({ lastActiveAt: { $gte: ... } }) без индекса → full scan
// ⚠️ Нет индекса на { referralCode: 1 } — используется в findOrCreateByTelegram()
//    для поиска реферера: findOne({ referralCode }) → full scan
//    referralCode имеет { unique: true, sparse: true } через @Prop,
//    но без явного UserSchema.index() — sparse unique создаётся,
//    однако это нужно проверить
// ⚠️ Нет индекса на { isBanned: 1 } и { isActive: 1 } для фильтрации
🔧 UsersService — методы

findOrCreateByTelegram()

Typescript

async findOrCreateByTelegram(
  telegramUser: TelegramUser,
  referralCode?: string,
): Promise<UserDocument>

// Флоу:
// 1. findOne({ telegramId })
// 2. Если существует → findByIdAndUpdate($set profile + lastActiveAt) → return
// 3. Новый:
//    - new this.userModel({ bonusTokens: 9, ... })
//    - если referralCode: findOne({ referralCode }) → user.referredBy = referrer._id
//    - user.save()
//    - если referredBy: $inc { referralCount: 1, bonusTokens: +10, referralEarnings: +10 }
//    - return user

// ⚠️ Race condition: findOne + new + save — не атомарно.
//    Два параллельных /start от одного telegramId могут создать двух пользователей.
//    Нужен upsert: findOneAndUpdate({ telegramId }, ..., { upsert: true, new: true })
//    или unique index error catching с retry.
//    Unique index на telegramId защитит от дублей в БД (duplicate key error),
//    но save() бросит ошибку — необработанный 500.

// ⚠️ Стартовый бонус хардкодом: bonusTokens: 9
//    Не из константы/конфига. При изменении нужно менять здесь
//    и в TelegramBotUpdate (Блок 13): хардкод '9' в приветствии.

// ⚠️ Self-referral защита через telegramId (number):
//    referrer.telegramId !== telegramUser.id
//    Если пользователь регистрируется через email/google — telegramId null у обоих,
//    null !== null → false — защита сработает некорректно (не позволит реферал).
//    Нужна проверка по _id, не telegramId.

// ⚠️ referralCode коллизия: uuid().substring(0, 8) → 8 символов hex.
//    Пространство: 16^8 = ~4 млрд. При большой базе возможны коллизии.
//    При коллизии generateReferralCode() вернёт дубль, save() упадёт
//    с duplicate key error — не обрабатывается.
deductTokens()

Typescript

async deductTokens(userId: string, amount: number, _type: string)

// _type параметр принимается но не используется (underscore prefix)
// Приоритет списания: bonusTokens → cashbackBalance → tokenBalance
// Оптимистичная блокировка: MAX_DEDUCT_RETRIES = 3 попытки
// Условие в фильтре: все три баланса должны совпасть с прочитанными

// ⚠️ Три баланса в условии фильтра — высокая вероятность retry:
//    Если bonusTokens изменился (начисление реферального бонуса параллельно),
//    условие не сработает, даже если tokenBalance достаточен.
//    3 попытки могут не хватить при активной системе.

// ⚠️ fromTokens = remaining (без roundTokens):
//    remaining уже rounded на каждом шаге, но явный roundTokens(fromTokens)
//    отсутствует. При накопленной погрешности fromTokens может иметь
//    лишние знаки после запятой.

// ⚠️ _type не используется — нет аудита: какой тип операции списал токены.
//    Нет записи в TransactionLog (если такой существует).
normalizeBalances()

Typescript

private async normalizeBalances(user: UserDocument): Promise<UserDocument>

// Вызывается после каждой операции с балансом
// ⚠️ Дополнительный запрос к БД при каждой операции (если нужна нормализация)
//    При нормальной работе (без float-погрешностей) needsUpdate = false → нет запроса
//    При погрешности: +1 запрос к БД на каждую операцию с балансом

// ⚠️ Нормализует totalDeposited и cashbackEarnedTotal —
//    это счётчики "всего за всё время", их нельзя клэмпить в 0.
//    Если они стали отрицательными — это баг в логике, не float-погрешность.
//    normalizeBalances скроет баг молча (только error log).
checkDailyLimit()

Typescript

async checkDailyLimit(userId: string, maxDaily: number): Promise<boolean>

// ⚠️ Race condition: findById + findByIdAndUpdate — не атомарно.
//    Два параллельных запроса могут оба увидеть dailyGenerations < maxDaily
//    и оба разрешить генерацию → overshoot лимита.
//    Нужен атомарный $inc с условием:
//    findOneAndUpdate({ _id, dailyGenerations: { $lt: maxDaily } }, { $inc: { dailyGenerations: 1 } })

// ⚠️ "tomorrow" вычисляется как следующая полночь локального времени сервера.
//    Если сервер в UTC, а пользователи в UTC+3 — сброс в 03:00 по МСК, не в полночь.
//    Нужна timezone-aware логика или фиксированный UTC reset.

// ⚠️ checkDailyLimit и incrementDailyGenerations — два отдельных метода.
//    Вызывающий код должен вызвать оба. Если incrementDailyGenerations
//    не вызван после checkDailyLimit — лимит никогда не исчерпается.
updateSettings()

Typescript

async updateSettings(userId: string, settings: any): Promise<UserDocument>

// ⚠️ settings: any — полная замена объекта настроек через $set.
//    Нет валидации ключей: { $set: { settings: <что угодно> } }
//    Пользователь может сохранить: { settings: { __proto__: ... } }
//    или очень большой объект (нет ограничения размера).
//    Нужна whitelist валидация через DTO.

// ⚠️ $set заменяет весь объект settings целиком.
//    Если клиент отправит { theme: 'dark' } — все остальные настройки
//    (defaultTextModel, language, notifications) будут удалены.
//    Нужен $set: { 'settings.theme': 'dark' } или merge на уровне сервиса.
getLeaderboard()

Typescript

async getLeaderboard(limit = 10)
// .find({ isActive: true }).sort({ referralCount: -1 }).limit(limit)
// ⚠️ Нет индекса на { isActive: 1, referralCount: -1 } — сортировка без индекса
// ⚠️ Нет защиты soft-deleted пользователей: { isActive: true, isDeleted: false }
updateSubscription()

Typescript

async updateSubscription(userId: string, plan: string, expiresAt: Date | null)
// plan: string — не SubscriptionPlan enum, нет валидации на уровне сервиса
// Mongoose enum validate спасёт на уровне БД, но TypeScript не защищает
addTokens()

Typescript

// totalDeposited инкрементируется при addTokens
// ⚠️ addBonusTokens и addCashback НЕ инкрементируют totalDeposited — корректно
// ⚠️ refundTokens декрементирует totalTokensSpent — корректно
//    Но totalDeposited не уменьшается при возврате средств (если нужна бухгалтерия)
🎮 UsersController

GET /users/me

Typescript

// subscriptionActive логика:
const subscriptionActive =
  user.subscriptionPlan !== 'free' &&        // строка 'free', не SubscriptionPlan.FREE
  user.subscriptionExpiresAt !== null &&
  user.subscriptionExpiresAt > now;

// ⚠️ Сравнение с литералом 'free' вместо SubscriptionPlan.FREE
//    Если enum изменится — сравнение сломается без ошибки компиляции

// ⚠️ totalBalance = tokenBalance + bonusTokens — не включает cashbackBalance
//    Пользователь видит неполный доступный баланс
//    (cashbackBalance тоже можно тратить, согласно deductTokens)

// ⚠️ Нет cashbackBalance в ответе — пользователь не видит свой кэшбек в профиле
// ⚠️ Нет isBanned в ответе — клиент не знает, заблокирован ли аккаунт
PUT /users/me/settings

Typescript

// @Body() settings: any — нет DTO, нет валидации
// Передаёт settings напрямую в updateSettings() → полная замена объекта
// ⚠️ Описано выше в updateSettings()
⚠️ Замеченные проблемы

🔴 Критичные

Race condition в findOrCreateByTelegram — findOne + new + save() не атомарно. При двух параллельных /start (Telegram retry policy) оба запроса пройдут findOne (оба получат null), оба создадут new this.userModel(...), второй save() упадёт с duplicate key error на telegramId index. Ошибка не обрабатывается → необработанный 500. Нужен findOneAndUpdate({ telegramId }, ..., { upsert: true, new: true, setOnInsert: {...} }).

Race condition в checkDailyLimit — findById (чтение) + findByIdAndUpdate (сброс) + отдельный incrementDailyGenerations — три неатомарных операции. При параллельных генерациях: оба запроса читают dailyGenerations: 4 при maxDaily: 5, оба разрешают, оба вызывают increment → dailyGenerations: 6 при лимите 5. Нужен атомарный findOneAndUpdate с условием { dailyGenerations: { $lt: maxDaily } } и $inc: 1 в одном запросе.

Self-referral защита через telegramId — referrer.telegramId !== telegramUser.id работает только для Telegram. Для email/google пользователей telegramId = null у обоих, условие null !== null → false → реферал не привязывается даже для разных пользователей. Нужна проверка referrer._id.toString() !== user._id.toString() (но user._id ещё не существует на этапе проверки). Правильно: после user.save() проверить user._id.toString() !== referrer._id.toString().

🟡 Средние

updateSettings заменяет весь объект — $set: { settings } удаляет все ненаправленные ключи. Запрос { theme: 'dark' } сотрёт defaultTextModel, language, notifications. Нужен merge: читать текущие настройки + spread + сохранить, или использовать $set: { 'settings.theme': value } для каждого ключа по отдельности.

settings: any без валидации — нет DTO, нет whitelist ключей. Пользователь может записать произвольные данные в поле settings документа. Нужен UpdateSettingsDto с class-validator.

Хардкод стартового бонуса bonusTokens: 9 — значение в findOrCreateByTelegram и строка '*9 спичек*' в TelegramBotUpdate должны быть синхронизированы. При изменении одного место — другое устареет. Нужна именованная константа INITIAL_BONUS_TOKENS = 9 в общем файле констант.

Коллизия referralCode — uuidv4().substring(0, 8) даёт 8 hex-символов = 16^8 ≈ 4 млрд вариантов. При дубликате save() бросает duplicate key error — не обрабатывается. При росте базы (100k+ пользователей) вероятность коллизии ≈ 0.001% — редко, но возможно. Нужен retry с regeneration при duplicate key error на referralCode.

Нет индекса на lastActiveAt — getStats() использует countDocuments({ lastActiveAt: { $gte: ... } }) — range query без индекса → full collection scan. При 100k+ пользователей — заметная деградация при каждом admin-запросе статистики.

Нет индекса на { isActive: 1, referralCount: -1 } — getLeaderboard() делает sort без индекса.

totalBalance в GET /users/me не включает cashbackBalance — пользователь видит tokenBalance + bonusTokens, но cashbackBalance тоже доступен для трат (согласно deductTokens). Отображаемый баланс занижен. cashbackBalance отсутствует в ответе GET /users/me полностью.

Сброс dailyGenerations по локальному времени сервера — new Date(year, month, date + 1) создаёт дату в timezone сервера. Если сервер в UTC, "следующий день" начинается в 00:00 UTC. Для пользователей в UTC+3 сброс происходит в 03:00 по МСК, а не в полночь.

🟢 Минорные

subscriptionPlan !== 'free' — литерал вместо enum — должно быть user.subscriptionPlan !== SubscriptionPlan.FREE. При переименовании enum-значения TypeScript укажет на ошибку в enum, но не в строковом литерале.

_type параметр в deductTokens не используется — принимается, логируется, не пишется в transaction log. Если transaction log существует — нужно писать. Если нет — параметр вводит в заблуждение (underscore-prefix указывает на намеренное игнорирование, но параметр публичный).

normalizeBalances клэмпит totalDeposited и cashbackEarnedTotal в 0 — эти поля — исторические счётчики "всего за всё время", они не должны быть отрицательными в принципе. Если они стали отрицательными — это логический баг (двойной возврат средств и т.п.), а не float-погрешность. Клэмп скрывает проблему.

isBanned и isDeleted не возвращаются в GET /users/me — клиент не знает о статусе аккаунта. При бане пользователь продолжает видеть нормальный UI до следующего JWT-защищённого запроса.