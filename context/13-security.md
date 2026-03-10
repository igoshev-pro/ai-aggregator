<!-- context/13-security.md -->
# 🔒 Security — Детальный контекст

## Назначение
Описание всех мер безопасности проекта: аутентификация, авторизация, rate limiting, защита от атак.

## Многоуровневая защита

### 1. Telegram Init Data Validation
Уровень: Аутентификация
Файл: src/common/guards/telegram-auth.guard.ts

Алгоритм:

Получить initData из header X-Telegram-Init-Data
Распарсить URLSearchParams
Извлечь hash, удалить из params
Отсортировать params алфавитно
Сформировать data_check_string
HMAC-SHA256("WebAppData", BOT_TOKEN) → secret_key
HMAC-SHA256(secret_key, data_check_string) → calculated_hash
Сравнить calculated_hash === hash
Проверить auth_date не старше 1 часа (для guards) / 24 часов (для auth)


### 2. JWT Authentication
Уровень: Сессия
Файл: src/common/guards/jwt-auth.guard.ts

Algorithm: HS256
Expiration: 7 days
Payload: { sub, telegramId, role }
Извлечение: Bearer token из Authorization header
Валидация: passport-jwt стратегия
Проверка: пользователь существует, isActive, !isBanned


### 3. Role-Based Access Control (RBAC)
Уровень: Авторизация
Файл: src/common/guards/roles.guard.ts

Роли (иерархия):
user         — обычный пользователь
premium      — платный пользователь
admin        — администратор
super_admin  — суперадмин (управление ролями)

Декоратор: @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
Guard проверяет: requiredRoles.includes(user.role)



### 4. Rate Limiting
Уровень: Защита от спама
Пакет: @nestjs/throttler

Глобальный лимит:
TTL: 60 секунд
Limit: 60 запросов

Per-endpoint лимиты:
POST /generation/image:   5 req/min
POST /generation/video:   3 req/min
POST /generation/audio:   5 req/min
POST /auth/telegram:      10 req/min (TODO)

Реализация: Redis-based (через ThrottlerModule)



### 5. Input Validation
Уровень: Валидация данных
Пакет: class-validator + class-transformer

Настройки ValidationPipe:
whitelist: true              — удаляет неизвестные поля
forbidNonWhitelisted: true   — ошибка при неизвестных полях
transform: true              — авто-приведение типов
enableImplicitConversion: true

Примеры:
@IsString(), @MaxLength(2000)     — промпты
@IsNumber(), @Min(256), @Max(2048) — размеры изображений
@IsEnum(GenerationType)           — типы генерации



### 6. HTTP Security Headers
Уровень: Transport
Пакет: helmet

Заголовки:
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000
Content-Security-Policy: default-src 'self'
X-Download-Options: noopen
X-Permitted-Cross-Domain-Policies: none
Referrer-Policy: no-referrer



### 7. CORS
Уровень: Cross-Origin
Файл: src/main.ts

Настройки:
origin: из CORS_ORIGINS env (список доменов через запятую)
credentials: true
methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
allowedHeaders: Content-Type, Authorization, X-Telegram-Init-Data



### 8. API Key Security
Уровень: Хранение секретов

Правила:
✅ Все ключи в .env файле
✅ .env в .gitignore
✅ .env.example с placeholder-ами
✅ Доступ через ConfigService (typed)
❌ Никогда не хардкодить ключи
❌ Не логировать ключи
❌ Не отправлять ключи в ответах API



### 9. MongoDB Security
Уровень: База данных

Защита:

Mongoose автоматически экранирует спец.символы ($, .)
Схемы со strict mode (лишние поля игнорируются)
Валидация типов на уровне схемы
Индексы с unique для предотвращения дубликатов
Auth через username/password (MONGO_USER/MONGO_PASSWORD)


### 10. Payment Webhook Security
Уровень: Финансовая безопасность

YooKassa:

IP whitelist (TODO)
Проверка shop_id в payload (TODO)
Idempotence key при создании платежа
Cryptomus:

Sign verification: MD5(base64(json) + apiKey)
Проверка sign в каждом webhook
Telegram Stars:

Верификация через Bot API
pre_checkout_query подтверждение


### 11. Global Exception Filter
Уровень: Error handling
Файл: src/common/filters/global-exception.filter.ts

Все ошибки ловятся централизованно
Внутренние ошибки не раскрывают stack trace клиенту
Unhandled exceptions логируются
Стандартный формат ответа: { success, statusCode, message, timestamp, path }


## Чек-лист безопасности

| Мера | Статус | Файл |
|------|--------|------|
| Telegram HMAC validation | ✅ | telegram-auth.guard.ts |
| JWT authentication | ✅ | jwt-auth.guard.ts, jwt.strategy.ts |
| RBAC (roles) | ✅ | roles.guard.ts, roles.decorator.ts |
| Rate limiting (global) | ✅ | ThrottlerModule в app.module.ts |
| Rate limiting (per-endpoint) | ✅ | @Throttle() на контроллерах |
| Input validation (whitelist) | ✅ | ValidationPipe в main.ts |
| Helmet headers | ✅ | main.ts |
| CORS configuration | ✅ | main.ts |
| Env-based secrets | ✅ | configuration.ts |
| Error sanitization | ✅ | global-exception.filter.ts |
| MongoDB injection prevention | ✅ | Mongoose schemas |
| Payment webhook verification | ✅ | payment providers |
| Request logging | ✅ | logging.interceptor.ts |
| Request timeout | ✅ | timeout.interceptor.ts (120s) |
| Ban system | ✅ | users.service.ts + jwt.strategy.ts |
| Docker non-root user | ✅ | Dockerfile |

## TODO / Улучшения безопасности
- [ ] Refresh token rotation (отдельная коллекция)
- [ ] IP whitelist для webhook endpoints
- [ ] Brute force protection на auth (progressive delay)
- [ ] Request signing для критичных операций (payments)
- [ ] Audit log для админских действий
- [ ] Encryption at rest для чувствительных данных
- [ ] CSP headers настроить под конкретные домены
- [ ] Dependency audit (`npm audit`) в CI/CD
- [ ] Secrets manager (Vault / AWS Secrets Manager) вместо .env
- [ ] WAF (Web Application Firewall) перед API