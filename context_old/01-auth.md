<!-- context/01-auth.md -->
# 🔐 Auth Module — Детальный контекст

## Назначение
Авторизация пользователей через Telegram WebApp initData. Выдача JWT токенов для дальнейших запросов к API.

## Файлы модуля
src/modules/auth/
├── auth.module.ts
├── auth.controller.ts
├── auth.service.ts
├── strategies/
│   └── jwt.strategy.ts
└── dto/
├── telegram-auth.dto.ts
└── auth-response.dto.ts



## Поток авторизации
TG Mini App вызывает Telegram.WebApp.initData
Frontend отправляет POST /api/v1/auth/telegram { initData, referralCode? }
Backend: a. Парсит initData (URLSearchParams) b. Извлекает hash, удаляет из params c. Сортирует оставшиеся params алфавитно d. Формирует data_check_string: "key=value\nkey=value" e. Вычисляет HMAC-SHA256:
secret_key = HMAC-SHA256("WebAppData", BOT_TOKEN)
hash = HMAC-SHA256(secret_key, data_check_string) f. Сравнивает hash с полученным g. Проверяет auth_date не старше 24 часов h. Парсит user из params
findOrCreate в MongoDB:
Если существует → обновляет info (firstName, username, photo)
Если новый → создаёт с welcome bonus (50 токенов)
Если есть referralCode → связывает, начисляет бонусы
Генерирует JWT: { sub: mongoId, telegramId, role }
Возвращает { accessToken, user }


## JWT Payload
```typescript
interface JwtPayload {
  sub: string;        // MongoDB ObjectId
  telegramId: number; // Telegram user ID
  role: UserRole;     // 'user' | 'premium' | 'admin' | 'super_admin'
}
Настройки

JWT expiration: 7 дней (JWT_EXPIRATION env)
Auth date max age: 24 часа (для первичной авторизации)
TelegramAuthGuard: 1 час (для повторных запросов с initData в headers)
API Endpoints

Method	Path	Auth	Description
POST	/auth/telegram	❌	Авторизация через initData
GET	/auth/refresh	✅ JWT	Обновить токен
Зависимости

UsersModule — findOrCreate пользователя
@nestjs/jwt — генерация/валидация JWT
@nestjs/passport — стратегия JWT
Guards

JwtAuthGuard

Стандартный passport JWT guard
Поддерживает декоратор @Public() для открытых эндпоинтов
Валидирует токен → проверяет что пользователь существует, не забанен
TelegramAuthGuard

Отдельный guard для валидации initData в headers
Используется для эндпоинтов, где нужна и JWT и telegram верификация
Header: X-Telegram-Init-Data
Возможные ошибки

Код	Сообщение	Причина
401	Invalid Telegram authentication data	Невалидный HMAC
401	Telegram init data is required	Нет initData
401	Account is banned	Пользователь забанен

TODO / Улучшения

 Добавить refresh token (отдельная коллекция с ротацией)
 Web-авторизация через Telegram Login Widget
 Rate limit на auth endpoint (5 req/min)
 Логирование неудачных попыток авторизации