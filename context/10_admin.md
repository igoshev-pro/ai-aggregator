📦 Контекст: Backend (NestJS) — Блок 10: Admin Module

🗂️ Структура модуля


src/modules/admin/
├── admin.module.ts
├── admin.controller.ts          главный контроллер
├── admin.service.ts             главный сервис
├── admin-billing.controller.ts  планы + пакеты токенов
├── admin-billing.service.ts
├── admin-promo-codes.controller.ts
├── admin-promo-codes.service.ts
├── admin-transactions.controller.ts
├── admin-transactions.service.ts
├── admin-referral.controller.ts  (физически в referral/, но входит в AdminModule)
├── dto/
│   ├── model.dto.ts             ModelsFilterDto, UpdateModelDto, CreateModelDto
│   └── tokenomics.dto.ts        PurchasePackDto, UpdateTokenomicsDto
└── schemas/
    └── tokenomics-settings.schema.ts
🔐 Авторизация

Все эндпоинты закрыты:

Typescript

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
Отдельные операции дополнительно ограничены @Roles(UserRole.SUPER_ADMIN):


POST   /admin/plans              создать план
DELETE /admin/plans/:id          удалить план
POST   /admin/token-packages     создать пакет
DELETE /admin/token-packages/:id удалить пакет
POST   /admin/models             создать модель
DELETE /admin/models/:slug       удалить модель
PUT    /admin/users/:id/role     сменить роль
PUT    /admin/settings/tokenomics обновить токеномику
DELETE /admin/promo-codes/:id    удалить промокод
🗺️ API эндпоинты (полная карта)

AdminController (/admin)


GET    /admin/check                    проверка доступа
GET    /admin/dashboard                статистика дашборда
GET    /admin/users                    список пользователей (фильтры)
GET    /admin/users/:id                детали пользователя
PUT    /admin/users/:id/role           сменить роль [SUPER_ADMIN]
PUT    /admin/users/:id/ban            бан/разбан
POST   /admin/users/:id/adjust-balance корректировка баланса
DELETE /admin/users/:id                soft-delete + анонимизация [SUPER_ADMIN + ADMIN]
GET    /admin/providers                список AI провайдеров
PUT    /admin/providers/:slug          обновить провайдер
GET    /admin/models                   список моделей (фильтры)
GET    /admin/models/:slug             модель по slug
POST   /admin/models                   создать модель [SUPER_ADMIN]
PUT    /admin/models/:slug             обновить модель
POST   /admin/models/:slug/toggle      вкл/выкл модель
DELETE /admin/models/:slug             удалить (?hard=true для хард) [SUPER_ADMIN]
GET    /admin/analytics/revenue        аналитика выручки (?days=30)
GET    /admin/analytics/generations    аналитика генераций (?days=30)
GET    /admin/analytics/models         использование моделей (последние 30 дней)
GET    /admin/settings/tokenomics      настройки токеномики
PUT    /admin/settings/tokenomics      обновить токеномику [SUPER_ADMIN]
AdminBillingController (/admin)


GET    /admin/plans                    список планов подписки
GET    /admin/plans/:id                план по ID
POST   /admin/plans                    создать план [SUPER_ADMIN]
PUT    /admin/plans/:id                обновить план
POST   /admin/plans/:id/toggle         вкл/выкл план
DELETE /admin/plans/:id                удалить план [SUPER_ADMIN]
GET    /admin/token-packages           список пакетов токенов
GET    /admin/token-packages/:id       пакет по ID
POST   /admin/token-packages           создать пакет [SUPER_ADMIN]
PUT    /admin/token-packages/:id       обновить пакет
POST   /admin/token-packages/:id/toggle вкл/выкл пакет
DELETE /admin/token-packages/:id       удалить пакет [SUPER_ADMIN]
AdminPromoCodesController (/admin/promo-codes)


GET    /admin/promo-codes              список (page/limit/search/type/status/sortBy/order)
GET    /admin/promo-codes/:id          промокод по ID
GET    /admin/promo-codes/:id/stats    статистика использования
POST   /admin/promo-codes              создать
PUT    /admin/promo-codes/:id          обновить
POST   /admin/promo-codes/:id/toggle   вкл/выкл
DELETE /admin/promo-codes/:id          удалить [SUPER_ADMIN]
AdminTransactionsController (/admin/transactions)


GET    /admin/transactions             список (14 фильтров)
GET    /admin/transactions/stats       агрегированная статистика (?days=30)
GET    /admin/transactions/:id         детали транзакции
ReferralAdminController (/admin/referral)


GET    /admin/referral/withdrawals             все заявки на вывод
GET    /admin/referral/withdrawals/summary     сводка по статусам
PATCH  /admin/referral/withdrawals/:id/approve одобрить заявку
PATCH  /admin/referral/withdrawals/:id/paid    отметить выплаченной
PATCH  /admin/referral/withdrawals/:id/reject  отклонить (возврат кэшбека)
GET    /admin/referral/top-referrers           топ рефереров
📊 AdminService — ключевая логика

getDashboardStats()

Typescript

// 8 параллельных запросов к MongoDB
{
  users: {
    total,          // всего не удалённых
    activeToday,    // lastActiveAt >= сегодня
    newToday,       // createdAt >= сегодня
    newThisMonth,   // createdAt >= начало месяца
  },
  generations: { total, today },
  revenue: { thisMonth },    // только DEPOSIT + COMPLETED
  subscriptions: { active }, // subscriptionPlan != 'free' AND expiresAt > now
}
⚠️ revenue.thisMonth — считает только TransactionType.DEPOSIT, не учитывает SUBSCRIPTION. Итоговая выручка будет занижена если есть платные подписки.

getUsers() — поиск


Поиск по: username, firstName, lastName, email, telegramId (если число)
Сортировка по: createdAt, lastActiveAt, totalDeposited, totalTokensSpent, tokenBalance
Фильтры: role, banned (all/active/banned)
Исключены: isDeleted=true, passwordHash из select
getUserById() — детали пользователя

Typescript

// 6 параллельных запросов
{
  user,                    // данные без passwordHash
  stats: {
    generationsCount,
    transactionsCount,
    invitedCount,          // количество приглашённых
  },
  recentTransactions,      // последние 20
  recentGenerations,       // последние 20
  referrer,                // кто пригласил (если есть)
  invitedUsers,            // последние 20 приглашённых
}
adminAdjustBalanceV2() — корректировка баланса


Типы балансов: tokenBalance | bonusTokens | cashbackBalance
Валидация:
  - amount: ненулевое целое число
  - reason: минимум 3 символа
  - after >= 0 (нельзя уйти в минус)
Побочный эффект: если cashbackBalance + > 0, обновляет cashbackEarnedTotal
Записывает транзакцию ADMIN_ADJUSTMENT с metadata (adminUserId, balanceType, reason, before/after)
deleteUser() — soft delete + анонимизация


Защиты:
  - нельзя удалить себя
  - нельзя удалить ADMIN/SUPER_ADMIN (сначала снять роль)
  - нельзя удалить уже удалённого

Что делает:
  isDeleted = true, deletedAt = now, deletedBy = adminId
  isBanned = true, isActive = false
  email → deleted_{id}@deleted.local
  telegramId → null, googleId → null
  firstName → 'Deleted', lastName → 'User'
  username → '', photoUrl → ''
  passwordHash → null
  referralCode → 'DEL_{last6chars}'
⚠️ GDPR/PDPA: данные анонимизируются, но _id и createdAt остаются. Транзакции и генерации пользователя не анонимизируются — userId в них остаётся.

📊 AdminTransactionsService — статистика

getStats() — 10 параллельных агрегаций

Typescript

// Период: 1-365 дней (default 30)
{
  period: { days, since },
  summary: {
    totalCount,
    depositsRub,          // только DEPOSIT + COMPLETED
    subscriptionsRub,     // только SUBSCRIPTION + COMPLETED
    totalRevenueRub,      // deposits + subscriptions
    tokensDeposited,      // токены зачислены за период
    tokensSpent,          // токены потрачены (abs)
    pendingCount,
    failedCount,
  },
  byType,                 // группировка по типу транзакции
  byStatus,               // группировка по статусу
  byProvider,             // выручка по платёжным провайдерам
  revenueByDay,           // выручка по дням (type=DEPOSIT|SUBSCRIPTION)
  generationsByDay,       // расход токенов по дням
  topModels,              // топ-10 моделей по токенам
  topSpenders,            // топ-10 платящих юзеров (с $lookup на users)
  promoStats,             // топ-10 промокодов по использованию
  refunds,                // { count, tokens } рефандов
}
list() — поиск по транзакциям


14 фильтров: page, limit, search, userId, type, status,
             provider, modelSlug, promoCode, dateFrom, dateTo,
             amountMin, amountMax, sortBy, order

Поиск (search) по:
  - externalPaymentId, generationId, description, promoCode (regex)
  - _id, userId (если валидный ObjectId)
  - telegramId (если число)
  - username, firstName, lastName, email пользователя (sub-query в users, limit 50)

Возвращает:
  items[]    — транзакции с полем user: AdminUserLite
  total
  page, pages
  totals: { count, tokens, rub }  — агрегат по текущему фильтру
⚠️ Поиск по пользователю делает дополнительный запрос userModel.find() с limit 50. При большой базе и частом поиске — нагрузка на индексы users.

🎫 AdminPromoCodesService

Типы промокодов (PromoCodeType)


DISCOUNT_PERCENT    — скидка % (discountPercent: 1-100)
DISCOUNT_RUB        — скидка в рублях (discountRub > 0)
BONUS_TOKENS        — бонусные токены (bonusTokens > 0)
SUBSCRIPTION_DAYS   — дни подписки (subscriptionDays > 0 + subscriptionPlan required)
PromoApplyTo


(импортируется из billing/schemas/promo-code.schema)
Валидация кода


Regex: /^[A-Z0-9_-]{3,32}$/
Автоматически преобразуется в UPPERCASE при создании
Иммутабельные поля (при update)


code, currentUses, usages, totalDiscountGivenRub,
totalBonusTokensGiven, totalSubscriptionDaysGiven, createdBy
stats() — статистика промокода

Typescript

{
  code, type, isActive,
  currentUses, maxUses,
  remainingUses,            // null если unlimited
  totalDiscountGivenRub,
  totalBonusTokensGiven,
  totalSubscriptionDaysGiven,
  uniqueUsers,              // длина массива usages
  lastUsedAt,               // максимальный usages[].lastUsedAt
  startsAt, expiresAt,
}
⚠️ uniqueUsers = usages.length — это количество уникальных пользователей ТОЛЬКО если в массиве по одной записи на юзера. Если один юзер может иметь несколько записей — счётчик некорректен.

🏦 AdminBillingService

Subscription Plans (SubscriptionPlanEntity)


Сортировка: sortOrder ASC, priceRub ASC
Уникальный ключ: planKey (нельзя изменить после создания)
Token Packages (TokenPackageEntity)


Сортировка: sortOrder ASC, priceRub ASC
Уникальный ключ: packageId (нельзя изменить после создания)
Обязательные поля при создании: packageId, label, tokens, priceRub
💰 TokenomicsSettings Schema

Typescript

// collection: 'tokenomics_settings' (singleton — всегда одна запись)
{
  tokenToDollarRate: 0.01,    // 1 спичка = $0.01
  freeTokensOnSignup: 50,     // подарок при регистрации
  minPurchaseTokens: 100,     // минимальная покупка
  purchasePacks: [            // пресеты пакетов
    { tokens, priceRub, bonusTokens, label?, highlight? }
  ],
  refundOnError: true,        // возврат спичек при ошибке генерации
  updatedBy?: string,         // ID последнего редактора
}
⚠️ getTokenomics() — если документ не найден, создаёт с дефолтными значениями. Это seed-логика в рантайме. Лучше вынести в отдельный seed скрипт.

⚠️ TokenomicsSettings использует _id: false для PurchasePack — значит подзаписи не имеют своего _id. Обновление конкретного pack по ID невозможно, только полная замена массива.

🔗 Зависимости модуля


AdminModule imports:
  MongooseModule:
    User, Generation, Transaction, AIModel,
    TokenomicsSettings, PromoCode

  forwardRef → UsersModule         (UsersService)
  forwardRef → AiProvidersModule   (AiProvidersService)
  forwardRef → BillingModule       (BillingService)
  forwardRef → ReferralModule      (ReferralService)
⚠️ Все 4 внешних модуля через forwardRef — признак циклических зависимостей. AdminModule зависит от всего, и эти модули вероятно зависят от AdminModule или друг от друга.

⚠️ SubscriptionPlanEntity и TokenPackageEntity — схемы из BillingModule, но AdminBillingService регистрирует их через MongooseModule.forFeature повторно в AdminModule. Это работает, но дублирует регистрацию.

📐 DTO

ModelsFilterDto


search?     string
type?       GenerationType enum
isActive?   string ('true'/'false') — не boolean!
isPremium?  string ('true'/'false') — не boolean!
⚠️ isActive и isPremium — строки, не boolean. ValidationPipe с transform: true не преобразует их автоматически потому что нет @Type(() => Boolean).

UpdateModelDto — поля цены


costPerMillionInputTokens    стоимость входных токенов LLM
costPerMillionOutputTokens   стоимость выходных токенов LLM
fixedCostPerGeneration       фиксированная стоимость (image/video)
tokensPerDollar              обратная метрика
minTokenCost                 минимальная стоимость в спичках
tokenCost                    прямая стоимость в спичках
CreateModelDto extends UpdateModelDto


Обязательные поля: slug, name, displayName, type
⚠️ Замеченные проблемы

🔴 Критичные

getDashboardStats не считает SUBSCRIPTION выручку — revenue.thisMonth только из DEPOSIT. Дашборд показывает неполную картину.

Нет защиты от race condition в adminAdjustBalanceV2 — findById → изменение → save() без транзакции. Если два запроса одновременно — возможна потеря обновления.

deleteUser не анонимизирует транзакции и генерации — userId в них указывает на удалённого пользователя. Нарушение GDPR при полном удалении данных.

🟡 Средние

@CurrentUser('userId') в checkAccess — но JWT payload использует поле sub, не userId. Вернёт undefined. Правильно: @CurrentUser('sub').

forwardRef на 4 модуля — симптом высокой связности. AdminModule знает слишком много о деталях реализации других модулей.

TokenomicsSettings singleton без транзакций — Object.assign(existing, updates) → save() небезопасно при конкурентных запросах.

SubscriptionPlanEntity/TokenPackageEntity регистрируются дважды — в BillingModule и в AdminModule через forFeature. Работает, но путает.

AdminService.createModel принимает data: any вместо CreateModelDto — валидация на уровне контроллера, но сервис не типизирован.

getAnalytics/models всегда за 30 дней хардкодом, параметр days не принимает.

🟢 Минорные

ModelsFilterDto.isActive/isPremium — строки вместо boolean, нужен @Transform.

PurchasePack без _id — нельзя обновить один pack, только весь массив.

getTokenomics создаёт документ при первом вызове — seed логика в рантайме.

AdminWithdrawalActionDto объявлен прямо в файле контроллера, не в /dto.

Нет аудит-лога для критических операций (бан, смена роли, удаление). Только logger.warn.