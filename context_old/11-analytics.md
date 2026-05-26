# 📊 Analytics Module — Детальный контекст

## Назначение
Трекинг событий пользователей, сбор метрик, воронка конверсии, DAU, аналитика по платформам. Глобальный модуль — доступен из любого места в приложении.

## Файлы модуля
src/modules/analytics/
├── analytics.module.ts          # @Global() — доступен везде
├── analytics.controller.ts
├── analytics.service.ts
└── schemas/
└── analytics-event.schema.ts



## AnalyticsEvent Schema
```typescript
{
  event: string;           // 'page_view', 'generation_start', 'payment_init', etc.
  userId: ObjectId;        // nullable для анонимных
  sessionId: string;
  properties: {};          // произвольные данные события
  source: string;          // 'miniapp' | 'webapp' | 'bot'
  platform: string;        // 'ios' | 'android' | 'desktop' | 'web'
  userAgent: string;
  ip: string;
  createdAt: Date;         // auto, indexed
}

// TTL Index: автоудаление через 90 дней
// expireAfterSeconds: 90 * 24 * 60 * 60
Стандартные события

Пользовательские

Event	Когда	Properties
user_registered	Первая авторизация	{ referralCode?, source }
user_login	Каждая авторизация	{ source, platform }
page_view	Переход на страницу	{ page, previousPage }
model_select	Выбор модели	{ modelSlug, type }
Генерации

Event	Когда	Properties
generation_start	Начало генерации	{ type, modelSlug, generationId }
generation_completed	Успешное завершение	{ type, modelSlug, responseTimeMs }
generation_failed	Ошибка	{ type, modelSlug, error }
chat_message_sent	Отправка сообщения	{ modelSlug, conversationId }
Биллинг

Event	Когда	Properties
payment_init	Начало оплаты	{ provider, packageId, amount }
payment_completed	Оплата прошла	{ provider, tokens, amountRub }
payment_failed	Ошибка оплаты	{ provider, error }
promo_applied	Промокод применён	{ code, bonusTokens }
subscription_activated	Подписка активирована	{ plan }
Реферальные

Event	Когда	Properties
referral_click	Переход по рефссылке	{ referralCode }
referral_registered	Реферал зарегался	{ referrerId }
referral_bonus	Начислен бонус	{ amount, trigger }
Использование в других модулях

Typescript

// Любой сервис может инжектить AnalyticsService (модуль @Global)
constructor(private analyticsService: AnalyticsService) {}

// Трекинг события
await this.analyticsService.track({
  event: 'generation_completed',
  userId: user._id.toString(),
  properties: { type: 'image', modelSlug: 'midjourney', responseTimeMs: 4500 },
  source: 'miniapp',
});
Аналитические отчёты (для админки)

getEventStats(days)

Typescript

{
  eventCounts: [
    { _id: 'generation_start', count: 5420, uniqueUsersCount: 890 },
    { _id: 'page_view', count: 12000, uniqueUsersCount: 2100 },
    ...
  ],
  dailyActive: [
    { date: '2025-01-15', dau: 340 },
    { date: '2025-01-16', dau: 380 },
    ...
  ],
  topEvents: [
    { _id: 'page_view', count: 500 },    // за 24 часа
    { _id: 'generation_start', count: 230 },
    ...
  ],
  funnelData: {
    registered: 500,
    madeGeneration: 320,     // 64% conversion
    madePurchase: 45          // 9% conversion
  }
}
getPlatformStats(days)

Typescript

[
  { _id: { source: 'miniapp', platform: 'android' }, count: 8500, uniqueUsersCount: 1200 },
  { _id: { source: 'miniapp', platform: 'ios' }, count: 6200, uniqueUsersCount: 900 },
  { _id: { source: 'webapp', platform: 'desktop' }, count: 3100, uniqueUsersCount: 500 },
  ...
]
API Endpoints

Method	Path	Auth	Role	Description
POST	/analytics/track	✅ JWT	User	Трекинг события
POST	/analytics/track/batch	✅ JWT	User	Batch-трекинг
GET	/analytics/stats	✅ JWT	Admin	Статистика событий
GET	/analytics/platforms	✅ JWT	Admin	По платформам
Особенности

Не роняет основной флоу — все ошибки трекинга ловятся try/catch и логируются как warn
TTL 90 дней — старые события автоматически удаляются MongoDB
Batch-insert — фронт может накапливать события и слать пачкой
@Global() — не нужно импортировать в каждый модуль
TODO

 Интеграция с внешней аналитикой (Amplitude / Mixpanel)
 Real-time dashboard через WebSocket (лайв-метрики)
 Retention analysis (Day 1/7/30)
 Когортный анализ
 A/B тестирование (feature flags)
 Export данных в CSV