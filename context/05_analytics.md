📦 Контекст: Backend (NestJS) — Блок 5: Analytics Module

🗂️ Структура модуля


src/modules/analytics/
├── analytics.module.ts    (@Global)
├── analytics.controller.ts
├── analytics.service.ts
└── schemas/
    └── analytics-event.schema.ts
🌐 Глобальный модуль

Typescript

@Global()
// AnalyticsService доступен во всех модулях без явного импорта
// Экспортирует: AnalyticsService
⚠️ @Global() означает что любой модуль может инжектить AnalyticsService напрямую без добавления AnalyticsModule в imports. Фактически используется в GenerationModule, BillingService и т.д. для fire-and-forget трекинга.

📊 AnalyticsEvent Schema

Typescript

// Коллекция: analytics_events (автоимя от класса)
{
  event: string      // required, indexed — 'page_view', 'generation_start',
                     // 'payment_init', 'model_select', 'user_registered',
                     // 'generation_completed', 'payment_completed'
  userId?: ObjectId  // ref: User, indexed, опциональный (анонимные события)
  sessionId?: string
  properties: {}     // произвольные данные события
  source?: string    // 'miniapp' | 'webapp' | 'bot'
  platform?: string  // 'ios' | 'android' | 'desktop' | 'web'
  userAgent?: string
  ip?: string
  createdAt: Date    // автоматически (timestamps: true)
}
Индексы


event: 1                           (одиночный, sparse)
userId: 1                          (одиночный, sparse)
{ event: 1, createdAt: -1 }        (составной — для фильтра по типу за период)
{ userId: 1, event: 1, createdAt: -1 } (составной — история пользователя)
{ createdAt: 1 } TTL: 90 дней      (автоудаление — данные живут 90 дней)
⚠️ TTL индекс на createdAt с 90 днями — MongoDB автоматически удаляет документы старше 90 дней. Это нужно учитывать при построении долгосрочной аналитики — данные старше 3 месяцев недоступны.

⚠️ event и userId имеют ИЛИ одиночные индексы (через @Prop({ index: true })), ИЛИ покрыты составными. Одиночные в данном случае избыточны — составные их включают. Небольшой overhead на запись.

📡 API Эндпоинты


POST /analytics/track        трекинг одного события    [JWT required]
POST /analytics/track/batch  трекинг пачки событий     [JWT required]
GET  /analytics/stats        статистика событий        [ADMIN+]
GET  /analytics/platforms    статистика платформ       [ADMIN+]
⚠️ Нет публичного (анонимного) трекинга — все события требуют JWT. Анонимные события (до регистрации) невозможны через API, только если вызывать AnalyticsService.track() напрямую из других сервисов.

🔧 AnalyticsService

track() — одиночное событие

Typescript

track({
  event, userId?, sessionId?, properties?, source?, platform?, userAgent?, ip?
})
// Создаёт документ через new Model() + .save()
// Ошибки: глотает (logger.warn) — не ронят основной флоу
// Fire-and-forget: вызывается без await в основных сервисах (рекомендованный паттерн)
trackBatch() — пачка событий

Typescript

trackBatch(events[])
// insertMany с ordered: false
// ordered: false → продолжает вставку даже если часть документов упала
// Ошибки: глотает (logger.warn)
⚠️ track() использует new Model() + .save() вместо Model.create(). Функционально идентично, но insertMany в trackBatch() более эффективен для пачки.

⚠️ Нет валидации event строки — любая строка принимается. При опечатке в имени события (generaton_start вместо generation_start) данные запишутся но не попадут в воронку.

⚠️ Нет лимита на batch размер — фронт может прислать 10000 событий одним запросом.

📈 getEventStats(days = 30)

4 параллельных агрегации:

1. eventCounts — счётчики по типам событий

Typescript

// За период days, группировка по event
// Возвращает: { _id: eventName, count, uniqueUsersCount }
// uniqueUsers через $addToSet → $size
// Сортировка: count DESC
⚠️ $addToSet для uniqueUsers накапливает все ObjectId в памяти. При большом количестве событий (>100K) и высокой кардинальности userId — может вызвать OOM в агрегации. Лучше использовать $approxCountDistinct (MongoDB 5.0+).

2. dailyActive — DAU по дням

Typescript

// Только события с userId ($exists: true)
// Группировка по дате ('YYYY-MM-DD')
// Возвращает: { date, dau }
// Сортировка: date ASC
3. topEvents — топ-10 за последние 24 часа

Typescript

// Отдельный временной срез: последние 24 часа (не зависит от параметра days)
// Возвращает: [{ _id: eventName, count }]
// Limit: 10
4. funnelData — воронка конверсии

Typescript

// Три независимых счётчика:
registered        // countDocuments({ event: 'user_registered' })
madeGeneration    // unique users с event 'generation_completed'
madePurchase      // unique users с event 'payment_completed'
⚠️ Воронка считает уникальных пользователей независимо — не строгая воронка. Пользователь, сделавший покупку, но не делавший генерацию в этом периоде, попадёт в madePurchase но не в madeGeneration. Данные могут не соответствовать ожидаемой последовательности.

⚠️ getFunnelData — 3 отдельных запроса (можно объединить в один aggregate с $facet).

📱 getPlatformStats(days = 30)

Typescript

// Группировка по { source, platform }
// Возвращает: { _id: { source, platform }, count, uniqueUsersCount }
// $ifNull на uniqueUsers — защита от null (правильно)
// Сортировка: count DESC
👤 getUserActivity(userId, days = 7)

Typescript

// Используется из поддержки / AdminService
// Последние 100 событий пользователя за 7 дней
// Сортировка: createdAt DESC
// Лимит: 100
// Не является эндпоинтом контроллера — только прямой вызов из других сервисов
🔑 Известные события (из кода)


user_registered      — регистрация нового пользователя
generation_start     — начало генерации
generation_completed — завершение генерации
payment_init         — инициализация платежа
payment_completed    — успешный платёж
page_view            — просмотр страницы
model_select         — выбор модели
⚠️ Список событий нигде не зафиксирован как константы/enum — только в комментариях и строках. Риск рассинхронизации между сервисами и аналитикой.

⚠️ Замеченные проблемы

🔴 Критичные

TTL 90 дней — долгосрочная аналитика (год, квартал сравнение) недоступна. Данные старше 3 месяцев удаляются автоматически.

Нет лимита на batch — POST /analytics/track/batch принимает массив любого размера. DoS вектор.

🟡 Средние

Нет enum событий — имена событий как свободные строки. Опечатки ломают воронку молча.

Воронка не строгая — getFunnelData считает независимые множества, а не последовательность user_registered → generation_completed → payment_completed у одного пользователя.

$addToSet в агрегациях — при высоком трафике (>100K событий/день) накопление уникальных userId в памяти может вызвать проблемы.

Нет анонимного трекинга — события до регистрации (лендинг, онбординг) не отслеживаются через API.

getStats и getPlatformStats — параметр days принимается как string из Query без явного Number() преобразования. since.setDate() вызывается с string — работает через неявное приведение, но хрупко.

🟢 Минорные

Дублирование схемы — в коде файл analytics-event.schema.ts присутствует дважды (задвоение в сообщении). В реальном коде один файл.

getUserActivity не в контроллере — метод есть в сервисе, но нет эндпоинта. Доступен только из AdminService внутренне.

IP адрес — req.ip за proxy может вернуть внутренний IP. Нужен X-Forwarded-For заголовок для реального IP.