<!-- context/07-admin.md -->
# 🛡 Admin Module — Детальный контекст

## Назначение
Административная панель: дашборд, управление пользователями, провайдерами, моделями, промокодами, аналитика.

## Файлы модуля
src/modules/admin/
├── admin.module.ts
├── admin.controller.ts
├── admin.service.ts
└── dto/
├── update-provider.dto.ts
├── update-tariff.dto.ts
└── analytics-query.dto.ts



## Доступ
Все эндпоинты защищены:
- `JwtAuthGuard` — нужен JWT токен
- `RolesGuard` — нужна роль `admin` или `super_admin`
- Смена ролей доступна только `super_admin`

## Dashboard Stats
```typescript
{
  users: {
    total: number;
    activeToday: number;
    newToday: number;
    newThisMonth: number;
  };
  generations: {
    total: number;
    today: number;
  };
  revenue: {
    thisMonth: number;   // RUB
  };
  subscriptions: {
    active: number;
  };
}
Функции

Управление пользователями

Список с поиском (по username, firstName, telegramId)
Фильтрация по роли
Смена роли (super_admin only)
Бан/разбан с указанием причины
Ручная корректировка баланса (с записью транзакции ADMIN_ADJUSTMENT)
Управление провайдерами

Список всех провайдеров с health status
Включение/выключение провайдера
Изменение приоритета
Управление моделями

Список всех моделей
Включение/выключение модели
Изменение стоимости (tokenCost)
Пометка как premium
Изменение порядка сортировки
Промокоды

Создание с параметрами (бонус, лимиты, срок)
Просмотр всех промокодов
Деактивация
Аналитика

Revenue: доход по дням, общий за период
Generations: по дням, по типам, по статусам
Models: топ моделей, success rate, avg response time, tokens spent
API Endpoints

Method	Path	Auth	Role	Description
GET	/admin/dashboard	✅	Admin	Дашборд
GET	/admin/users	✅	Admin	Список юзеров
PUT	/admin/users/:id/role	✅	Super	Смена роли
PUT	/admin/users/:id/ban	✅	Admin	Бан/разбан
POST	/admin/users/:id/adjust-balance	✅	Admin	Баланс
GET	/admin/providers	✅	Admin	Провайдеры
PUT	/admin/providers/:slug	✅	Admin	Обновить
GET	/admin/models	✅	Admin	Модели
PUT	/admin/models/:slug	✅	Admin	Обновить
GET	/admin/promo-codes	✅	Admin	Промокоды
POST	/admin/promo-codes	✅	Admin	Создать
DELETE	/admin/promo-codes/:code	✅	Admin	Деактивировать
GET	/admin/analytics/revenue	✅	Admin	Аналитика дохода
GET	/admin/analytics/generations	✅	Admin	Генерации
GET	/admin/analytics/models	✅	Admin	По моделям

