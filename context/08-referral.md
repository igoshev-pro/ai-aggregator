<!-- context/08-referral.md -->
# 🔗 Referral Module — Детальный контекст

## Назначение
Реферальная система: уникальные коды, отслеживание приглашённых, бонусы.

## Файлы модуля
src/modules/referral/
├── referral.module.ts
├── referral.controller.ts
├── referral.service.ts
└── schemas/
└── referral.schema.ts



## Механика

### Регистрация реферала
1. Пользователь А имеет код `referralCode: "ABC12345"`
2. Новый пользователь Б переходит по ссылке `t.me/bot?start=ref_ABC12345`
3. Frontend передаёт `referralCode` при авторизации
4. При создании пользователя Б:
   - `referredBy` → ObjectId пользователя А
   - Пользователь Б получает 100 бонусных токенов (вместо 50 welcome)
   - Пользователь А получает 50 бонусных токенов
   - `referralCount` пользователя А += 1

### Бонус от покупок реферала
При каждой успешной покупке пользователем Б:
- Пользователь А получает 10% от купленных токенов как бонусные
- Создаётся транзакция REFERRAL_BONUS

## Referral Schema
```typescript
{
  referrerId: ObjectId → User;
  referredId: ObjectId → User;    // unique
  bonusEarned: number;
  hasPurchased: boolean;
  firstPurchaseAt: Date;
}
API Endpoints

Method	Path	Auth	Description
GET	/referral/stats	✅	Статистика + ссылка
Response

Json

{
  "referralCode": "ABC12345",
  "referralLink": "https://t.me/bot?start=ref_ABC12345",
  "totalReferrals": 15,
  "totalEarnings": 750,
  "referrals": [
    {
      "user": { "firstName": "Иван", "username": "ivan" },
      "bonusEarned": 50,
      "hasPurchased": true,
      "joinedAt": "2025-01-15T10:00:00Z"
    }
  ]
}