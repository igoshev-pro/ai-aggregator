<!-- context/02-users.md -->
# 👤 Users Module — Детальный контекст

## Назначение
Управление пользователями: профиль, баланс токенов, настройки, роли, лимиты.

## Файлы модуля
src/modules/users/
├── users.module.ts
├── users.controller.ts
├── users.service.ts
├── schemas/
│   └── user.schema.ts
└── dto/
└── update-user.dto.ts



## User Schema — полная схема

```typescript
{
  telegramId: number;          // unique, indexed
  firstName: string;
  lastName: string;
  username: string;            // indexed
  photoUrl: string;
  languageCode: string;
  isPremiumTelegram: boolean;

  // Баланс
  tokenBalance: number;        // купленные токены (min: 0)
  bonusTokens: number;         // бонусные/промо токены (min: 0)
  totalTokensSpent: number;    // всего потрачено
  totalDeposited: number;      // всего пополнено

  // Роль и подписка
  role: 'user' | 'premium' | 'admin' | 'super_admin';
  subscriptionPlan: 'free' | 'basic' | 'pro' | 'unlimited';
  subscriptionExpiresAt: Date;

  // Реферальная система
  referralCode: string;        // unique, 8 символов uppercase
  referredBy: ObjectId → User;
  referralCount: number;
  referralEarnings: number;

  // Лимиты
  dailyGenerations: number;
  dailyGenerationsResetAt: Date;

  // Статусы
  isActive: boolean;
  isBanned: boolean;
  banReason: string;
  lastActiveAt: Date;

  // Настройки
  settings: {
    defaultTextModel: string;
    defaultImageModel: string;
    defaultVideoModel: string;
    theme: string;
    language: string;
    notifications: boolean;
  }

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}
Логика баланса

Два типа токенов

tokenBalance — купленные за реальные деньги
bonusTokens — начисленные за промокоды, рефералов, welcome
Порядок списания

При генерации сначала списываются bonusTokens, затем tokenBalance.

Typescript

// Пример: нужно 5 токенов
// bonusTokens: 3, tokenBalance: 10
// Результат: bonusTokens: 0, tokenBalance: 8
// (3 из бонусных + 2 из основных = 5)
Методы работы с балансом


deductTokens(userId, amount)     → списание (бонусные → основные)
addTokens(userId, amount)        → пополнение tokenBalance
addBonusTokens(userId, amount)   → пополнение bonusTokens
refundTokens(userId, amount)     → возврат в tokenBalance
Daily Limits

Счётчик dailyGenerations сбрасывается автоматически при первом запросе нового дня
Лимит зависит от подписки:
Free: определяется из конфига (по умолчанию нет жёсткого лимита, ограничение только по токенам)
Basic: 50/день
Pro: 200/день
Unlimited: без лимита
API Endpoints

Method	Path	Auth	Description
GET	/users/me	✅ JWT	Профиль + баланс
PUT	/users/me/settings	✅ JWT	Обновить настройки
Индексы MongoDB


{ telegramId: 1 }           — unique
{ username: 1 }
{ referralCode: 1 }         — unique, sparse
{ role: 1 }
{ createdAt: -1 }
Зависимости

Этот модуль экспортируется и используется практически везде:

AuthModule — создание/поиск пользователя
BillingModule — работа с балансом
GenerationModule — проверка баланса, лимитов
ChatModule — проверка баланса
AdminModule — управление пользователями