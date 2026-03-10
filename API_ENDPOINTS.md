┌─────────────────────────────────────────────────────────────────────┐
│                          AUTH                                        │
├─────────────────────────────────────────────────────────────────────┤
│ POST   /api/v1/auth/telegram          Авторизация через TG initData │
│ GET    /api/v1/auth/refresh           Обновить JWT                   │
├─────────────────────────────────────────────────────────────────────┤
│                          USERS                                       │
├─────────────────────────────────────────────────────────────────────┤
│ GET    /api/v1/users/me               Профиль                        │
│ PUT    /api/v1/users/me/settings      Настройки                      │
├─────────────────────────────────────────────────────────────────────┤
│                         MODELS                                       │
├─────────────────────────────────────────────────────────────────────┤
│ GET    /api/v1/models                 Список моделей (?type=text)    │
│ GET    /api/v1/models/:slug           Детали модели                  │
├─────────────────────────────────────────────────────────────────────┤
│                          CHAT                                        │
├─────────────────────────────────────────────────────────────────────┤
│ GET    /api/v1/chat/conversations     Список чатов                   │
│ GET    /api/v1/chat/conversations/:id/messages  Сообщения чата       │
│ POST   /api/v1/chat/send              Отправить (без стрима)         │
│ POST   /api/v1/chat/stream            Отправить (SSE стрим)          │
│ DELETE /api/v1/chat/conversations/:id Удалить чат                    │
│ PUT    /api/v1/chat/conversations/:id/rename  Переименовать          │
│ PUT    /api/v1/chat/conversations/:id/pin     Закрепить              │
├─────────────────────────────────────────────────────────────────────┤
│                       GENERATION                                     │
├─────────────────────────────────────────────────────────────────────┤
│ POST   /api/v1/generation/image       Генерация изображения          │
│ POST   /api/v1/generation/video       Генерация видео                │
│ POST   /api/v1/generation/audio       Генерация аудио                │
│ GET    /api/v1/generation/status/:id  Статус генерации               │
│ GET    /api/v1/generation/history     История (?type=image)          │
│ GET    /api/v1/generation/favorites   Избранные генерации            │
│ PUT    /api/v1/generation/:id/favorite Toggle favorite               │
├─────────────────────────────────────────────────────────────────────┤
│                        BILLING                                       │
├─────────────────────────────────────────────────────────────────────┤
│ GET    /api/v1/billing/packages       Пакеты токенов                 │
│ GET    /api/v1/billing/plans          Планы подписок                 │
│ GET    /api/v1/billing/balance        Баланс + лимиты                │
│ POST   /api/v1/billing/pay/tokens     Оплата пакета                  │
│ POST   /api/v1/billing/pay/subscription  Оплата подписки             │
│ POST   /api/v1/billing/promo          Применить промокод             │
│ GET    /api/v1/billing/transactions   История транзакций             │
│ POST   /api/v1/billing/webhook/yookassa   Webhook ЮKassa            │
│ POST   /api/v1/billing/webhook/cryptomus  Webhook Cryptomus          │
├─────────────────────────────────────────────────────────────────────┤
│                       REFERRAL                                       │
├─────────────────────────────────────────────────────────────────────┤
│ GET    /api/v1/referral/stats         Реферальная статистика         │
├─────────────────────────────────────────────────────────────────────┤
│                      FAVORITES                                       │
├─────────────────────────────────────────────────────────────────────┤
│ POST   /api/v1/favorites/toggle       Toggle избранное               │
│ GET    /api/v1/favorites              Список избранного              │
├─────────────────────────────────────────────────────────────────────┤
│                       SUPPORT                                        │
├─────────────────────────────────────────────────────────────────────┤
│ POST   /api/v1/support/tickets        Создать тикет                  │
│ GET    /api/v1/support/tickets        Мои тикеты                     │
│ POST   /api/v1/support/tickets/:id/message  Написать в тикет         │
├─────────────────────────────────────────────────────────────────────┤
│                      ANALYTICS                                       │
├─────────────────────────────────────────────────────────────────────┤
│ POST   /api/v1/analytics/track        Трекинг событий               │
│ POST   /api/v1/analytics/track/batch  Batch-трекинг                 │
│ GET    /api/v1/analytics/stats        Статистика (admin)             │
│ GET    /api/v1/analytics/platforms    По платформам (admin)          │
├─────────────────────────────────────────────────────────────────────┤
│                        ADMIN                                         │
├─────────────────────────────────────────────────────────────────────┤
│ GET    /api/v1/admin/dashboard        Дашборд                        │
│ GET    /api/v1/admin/users            Список юзеров                  │
│ PUT    /api/v1/admin/users/:id/role   Сменить роль                   │
│ PUT    /api/v1/admin/users/:id/ban    Бан/разбан                     │
│ POST   /api/v1/admin/users/:id/adjust-balance  Корректировка баланса │
│ GET    /api/v1/admin/providers        Список провайдеров             │
│ PUT    /api/v1/admin/providers/:slug  Вкл/выкл провайдер             │
│ GET    /api/v1/admin/models           Все модели                     │
│ PUT    /api/v1/admin/models/:slug     Обновить модель                │
│ GET    /api/v1/admin/promo-codes      Промокоды                      │
│ POST   /api/v1/admin/promo-codes      Создать промокод               │
│ DELETE /api/v1/admin/promo-codes/:code Деактивировать                │
│ GET    /api/v1/admin/analytics/revenue     Аналитика дохода          │
│ GET    /api/v1/admin/analytics/generations Аналитика генераций       │
│ GET    /api/v1/admin/analytics/models      Аналитика по моделям      │
├─────────────────────────────────────────────────────────────────────┤
│                        HEALTH                                        │
├─────────────────────────────────────────────────────────────────────┤
│ GET    /api/v1/health                 Health check                   │
├─────────────────────────────────────────────────────────────────────┤
│                       WEBSOCKET                                      │
├─────────────────────────────────────────────────────────────────────┤
│ WS     /generation                    Namespace для real-time        │
│        → generation:subscribe         Подписка на статус генерации   │
│        → generation:status            Обновление статуса             │
│        → generation:progress          Прогресс (%)                   │
│        → generation:completed         Завершение                     │
│        → generation:failed            Ошибка                         │
└─────────────────────────────────────────────────────────────────────┘