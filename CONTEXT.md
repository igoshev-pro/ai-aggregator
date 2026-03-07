<!-- CONTEXT.md -->
# 🧠 AI Aggregator — Project Context

> **Этот файл содержит полное описание проекта. Передай его Claude в начале нового чата, чтобы он мгновенно понял архитектуру, стек, модули и текущее состояние разработки. Для глубоких подробностей по конкретному модулю — запроси соответствующий файл из папки `/context/`.**

---

## 📋 Краткое описание

**AI Aggregator** — платформа-агрегатор нейросетей, работающая как Telegram Mini App + Web-приложение. Единая экосистема для генерации текста, изображений, видео и аудио через 20+ AI моделей. Внутренняя валюта (токены), подписки, реферальная система, полная админка.

## 🏗 Архитектура
┌──────────────────────────────────────────────────────────────┐
│                        КЛИЕНТЫ                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ TG Mini App      │  │ Web App (Next)  │  │ TG Bot       │ │
│  │ React/Next 15+   │  │ SSR + CSR       │  │ Commands     │ │
│  └────────┬─────────┘  └────────┬────────┘  └──────┬───────┘ │
└───────────┼──────────────────────┼──────────────────┼─────────┘
│                      │                  │
▼                      ▼                  ▼
┌──────────────────────────────────────────────────────────────┐
│                     API GATEWAY (NestJS)                      │
│  Port: 3001 | Prefix: /api/v1                                │
│                                                              │
│  ┌──────┐ ┌──────┐ ┌────────┐ ┌──────────┐ ┌─────────────┐ │
│  │ Auth │ │Users │ │Billing │ │Generation│ │   Chat      │ │
│  └──────┘ └──────┘ └────────┘ └──────────┘ └─────────────┘ │
│  ┌──────┐ ┌──────┐ ┌────────┐ ┌──────────┐ ┌─────────────┐ │
│  │Admin │ │Refer │ │Support │ │Analytics │ │  Favorites  │ │
│  └──────┘ └──────┘ └────────┘ └──────────┘ └─────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              AI Providers Module                        │  │
│  │  OpenRouter │ Evolink │ KIE │ Replicate │ ...          │  │
│  │  ┌─────────────────────────────────────────┐           │  │
│  │  │  Provider Registry + Fallback Engine    │           │  │
│  │  └─────────────────────────────────────────┘           │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────┬──────────────────────┬────────────────────────────┘
│                      │
▼                      ▼
┌──────────────────┐   ┌──────────────────┐
│   MongoDB 7      │   │   Redis 7        │
│   - Users        │   │   - Bull Queues  │
│   - Generations  │   │   - Cache        │
│   - Transactions │   │   - Rate Limits  │
│   - Chats        │   │   - Sessions     │
│   - Analytics    │   │                  │
└──────────────────┘   └──────────────────┘



## 🛠 Технологический стек

| Компонент | Технология | Версия |
|-----------|-----------|--------|
| **Backend Framework** | NestJS | 10.x |
| **Runtime** | Node.js | 20.x |
| **Language** | TypeScript | 5.4+ |
| **Database** | MongoDB (Mongoose) | 7 / 8.x |
| **Cache & Queues** | Redis + Bull | 7 / 4.x |
| **WebSocket** | Socket.IO (через NestJS) | 10.x |
| **Auth** | JWT + Passport | — |
| **API Docs** | Swagger (OpenAPI) | 7.x |
| **Frontend** | React / Next.js 15+ | 15.x |
| **Deployment** | Docker + docker-compose | — |

## 🤖 Поддерживаемые AI модели

### Текстовые (7 моделей)
| Модель | Slug | Провайдеры | Стоимость |
|--------|------|-----------|-----------|
| ChatGPT 4o | `gpt-4o` | openrouter, evolink | 3 токена |
| ChatGPT 4o Mini | `gpt-4o-mini` | openrouter, evolink | 1 токен |
| Claude 3.5 Sonnet | `claude-3.5-sonnet` | openrouter | 3 токена |
| Claude 3 Haiku | `claude-3-haiku` | openrouter | 1 токен |
| Gemini 2.0 Flash | `gemini-2.0-flash` | openrouter | 1 токен |
| Gemini 1.5 Pro | `gemini-1.5-pro` | openrouter | 3 токена |
| DeepSeek V3 | `deepseek-v3` | openrouter | 1 токен |
| DeepSeek R1 | `deepseek-r1` | openrouter | 2 токена |
| Grok 3 | `grok-3` | openrouter | 3 токена |
| Perplexity Sonar | `perplexity-sonar` | openrouter | 2 токена |
| Qwen 2.5 72B | `qwen-2.5-72b` | openrouter | 2 токена |

### Изображения (8 моделей)
| Модель | Slug | Провайдеры | Стоимость |
|--------|------|-----------|-----------|
| Midjourney | `midjourney` | evolink, kie | 10 токенов |
| DALL-E 3 | `dall-e-3` | openrouter | 5 токенов |
| ChatGPT Images | `chatgpt-images` | openrouter | 5 токенов |
| Flux Pro | `flux-pro` | replicate, evolink | 5 токенов |
| Stable Diffusion XL | `stable-diffusion-xl` | replicate, evolink | 3 токена |
| Seedream | `seedream` | evolink | 5 токенов |
| Imagen 3 | `imagen-3` | evolink | 5 токенов |
| Nano Banana | `nano-banana` | evolink | 5 токенов |

### Видео (7 моделей)
| Модель | Slug | Провайдеры | Стоимость |
|--------|------|-----------|-----------|
| Sora | `sora` | evolink | 30 токенов |
| Kling 1.6 | `kling-1.6` | evolink, kie | 20 токенов |
| Runway Gen-3 | `runway-gen3` | evolink | 25 токенов |
| Veo 2 | `veo-2` | evolink | 25 токенов |
| Hailuo | `hailuo` | evolink | 15 токенов |
| Luma Ray2 | `luma-ray2` | replicate, evolink | 20 токенов |
| Pika 2.0 | `pika-2.0` | evolink | 15 токенов |

### Аудио (2 модели)
| Модель | Slug | Провайдеры | Стоимость |
|--------|------|-----------|-----------|
| Suno V4 | `suno-v4` | evolink | 10 токенов |
| ElevenLabs | `elevenlabs` | evolink | 5 токенов |

## 📁 Структура проекта
ai-aggregator-backend/
├── CONTEXT.md                          ← ТЫ ЗДЕСЬ
├── context/                            ← Детальные контексты модулей
│   ├── 01-auth.md
│   ├── 02-users.md
│   ├── 03-ai-providers.md
│   ├── 04-chat.md
│   ├── 05-generation.md
│   ├── 06-billing.md
│   ├── 07-admin.md
│   ├── 08-referral.md
│   ├── 09-favorites.md
│   ├── 10-support.md
│   ├── 11-analytics.md
│   ├── 12-websocket.md
│   ├── 13-security.md
│   └── 14-deployment.md
├── src/
│   ├── main.ts                         # Bootstrap + Swagger + CORS
│   ├── app.module.ts                   # Root module
│   ├── config/
│   │   └── configuration.ts            # Env → typed config
│   ├── common/
│   │   ├── decorators/                 # @CurrentUser, @Roles
│   │   ├── guards/                     # JWT, Telegram, Roles
│   │   ├── filters/                    # GlobalExceptionFilter
│   │   ├── interceptors/              # Logging, Timeout
│   │   └── interfaces/               # Enums, types
│   └── modules/
│       ├── auth/                       # Telegram auth → JWT
│       ├── users/                      # User CRUD, balance
│       ├── ai-providers/              # Provider registry, fallback
│       ├── chat/                       # Text chat with context
│       ├── generation/                # Image/Video/Audio + queues
│       ├── billing/                   # Payments, subscriptions, promo
│       ├── admin/                     # Admin panel API
│       ├── referral/                  # Referral system
│       ├── favorites/                 # Favorites
│       ├── support/                   # Support tickets
│       ├── analytics/                 # Event tracking
│       └── health/                    # Health check
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── package.json
├── tsconfig.json
└── nest-cli.json



## 🔄 Ключевые потоки данных

### Поток авторизации
TG Mini App → initData → POST /auth/telegram → validate HMAC →
findOrCreate User → generate JWT → return { token, user }



### Поток текстовой генерации (стриминг)
Client → POST /chat/stream (SSE) → validate balance →
save user message → build context (last 20 msgs) →
AI Providers (fallback chain) → stream chunks via SSE →
save assistant message → deduct tokens → close stream



### Поток медиа-генерации (изображения/видео/аудио)
Client → POST /generation/image → validate balance →
deduct tokens (reserve) → create Generation record →
Bull Queue → Consumer picks up → AI Provider (fallback) →
├── Sync result → update DB → WebSocket notify
└── Async (taskId) → poll every 5s → complete → WS notify
On failure → refund tokens → WS notify error



### Поток оплаты
Client → POST /billing/pay/tokens → create payment at provider →
return paymentUrl → user pays → webhook → verify →
add tokens → referral bonus → update transaction



## 🔑 Ключевые паттерны

1. **Provider Fallback Chain** — каждая модель привязана к N провайдерам с приоритетами. При ошибке retryable — автоматический переход на следующего.

2. **Token Economy** — два типа баланса: `tokenBalance` (купленные) и `bonusTokens` (промо/реферал). Сначала списываются бонусные.

3. **Async Generation + Polling** — для видео/аудио/некоторых изображений: создаётся taskId, consumer делает polling каждые 5 сек, обновления через WebSocket.

4. **SSE Streaming** — текстовые генерации стримятся через Server-Sent Events (`POST /chat/stream`).

5. **Bull Queue** — тяжёлые генерации идут через очередь с retry, backoff, timeout.

6. **Health Check + Auto-disable** — каждую минуту проверяются все провайдеры. При 5+ ошибках подряд провайдер автоматически исключается из fallback chain.

## 💰 Монетизация

| Механизм | Описание |
|----------|----------|
| Пакеты токенов | 5 пакетов от 99₽ до 2499₽ |
| Подписки | Basic (299₽) / Pro (699₽) / Unlimited (1999₽) в месяц |
| Welcome бонус | 50 токенов при регистрации |
| Реферальный бонус | +100 токенов рефералу, +50 реферреру, +10% от покупок |
| Промокоды | Настраиваемые из админки |

## 🔐 Безопасность

- Telegram initData HMAC-SHA256 валидация
- JWT токены с expiration (7d)
- Role-based access (user / premium / admin / super_admin)
- Rate limiting (global + per-endpoint)
- API ключи в env переменных
- Helmet middleware
- Input validation (class-validator whitelist)
- MongoDB injection prevention (Mongoose)

## 📊 Текущее состояние

| Компонент | Статус |
|-----------|--------|
| Архитектура | ✅ Спроектирована |
| Схемы БД | ✅ Готовы |
| Auth module | ✅ Реализован |
| Users module | ✅ Реализован |
| AI Providers module | ✅ Реализован (4 провайдера) |
| Chat module | ✅ Реализован (SSE streaming) |
| Generation module | ✅ Реализован (Bull queues + WS) |
| Billing module | ✅ Реализован (3 платёжки) |
| Admin module | ✅ Реализован |
| Referral module | ✅ Реализован |
| Favorites module | ✅ Реализован |
| Support module | ✅ Реализован |
| Analytics module | ✅ Реализован |
| WebSocket gateway | ✅ Реализован |
| Docker | ✅ Готов |
| Frontend интеграция | 🔄 В процессе |
| Тестирование | ❌ Не начато |
| Деплой | ❌ Не начат |

## 📖 Детальные контексты модулей

Для глубокого погружения в конкретный модуль запроси файл:

| Файл | Описание |
|------|----------|
| [`context/01-auth.md`](context/01-auth.md) | Авторизация Telegram + JWT |
| [`context/02-users.md`](context/02-users.md) | Пользователи, баланс, роли |
| [`context/03-ai-providers.md`](context/03-ai-providers.md) | AI провайдеры, fallback, модели |
| [`context/04-chat.md`](context/04-chat.md) | Текстовый чат с контекстом, SSE |
| [`context/05-generation.md`](context/05-generation.md) | Генерация медиа, очереди, polling |
| [`context/06-billing.md`](context/06-billing.md) | Биллинг, оплата, подписки, промокоды |
| [`context/07-admin.md`](context/07-admin.md) | Админка, дашборд, управление |
| [`context/08-referral.md`](context/08-referral.md) | Реферальная система |
| [`context/09-favorites.md`](context/09-favorites.md) | Избранное |
| [`context/10-support.md`](context/10-support.md) | Система поддержки |
| [`context/11-analytics.md`](context/11-analytics.md) | Аналитика и трекинг |
| [`context/12-websocket.md`](context/12-websocket.md) | WebSocket real-time |
| [`context/13-security.md`](context/13-security.md) | Безопасность, guards, rate-limiting |
| [`context/14-deployment.md`](context/14-deployment.md) | Docker, деплой, инфраструктура |

---

> **Для Claude:** Когда пользователь даёт тебе этот файл — ты полностью понимаешь проект. Если нужны детали по конкретному модулю, попроси пользователя прислать соответствующий файл из `/context/`. Все исходники уже написаны, стек: NestJS + MongoDB + Redis + Bull + Socket.IO.