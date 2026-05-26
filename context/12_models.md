📦 Контекст: Backend (NestJS) — Блок 9: Models Module

🗂️ Структура модуля


src/modules/models/
├── models.module.ts
├── models.controller.ts
└── models.service.ts
🔗 Зависимости модуля

Typescript

ModelsModule imports:
  MongooseModule: [AIModel]         // схема из ai-providers
  forwardRef → AiProvidersModule    // ⚠️ импортируется, но НЕ используется в сервисе
  forwardRef → UsersModule          // ⚠️ импортируется, но НЕ используется в сервисе

exports:
  ModelsService
⚠️ Оба forwardRef импорта — мёртвые зависимости. ModelsService работает только с AIModel напрямую через Mongoose. AiProvidersService и UsersService нигде не инжектируются.

📡 API Эндпоинты


GET /models            список доступных моделей   [JWT]
GET /models/:slug      детали конкретной модели   [JWT]
🔐 Логика доступа

roleToSubscriptionPlan()

Typescript

// Маппинг role → SubscriptionPlan из JWT payload
'premium'                     → SubscriptionPlan.PRO
'admin' | 'super_admin'       → SubscriptionPlan.UNLIMITED
всё остальное (включая null)  → SubscriptionPlan.FREE
Фильтрация по плану

Typescript

// isPremium: false → доступна всем

// isPremium: true, includedInPlans: [] (не задан)
//   → доступна только PRO и UNLIMITED

// isPremium: true, includedInPlans: ['pro', 'unlimited']
//   → доступна только если plan входит в массив
//   ⚠️ Сравнение через includedPlans.includes(userPlan)
//      SubscriptionPlan — enum. Если значения enum не совпадают
//      с тем что записано в БД — фильтрация молча не работает
🗄️ ModelDto — публичный контракт

Typescript

interface ModelDto {
  slug: string
  name: string           // displayName || name
  displayName: string
  type: GenerationType
  provider: string       // вычисляется из providerMappings или slug
  description: string
  cost: number           // расчётная стоимость для UI
  minCost: number        // minTokenCost из схемы
  isActive: boolean
  isPremium: boolean
  capabilities: string[]
  limits?: {
    maxInputTokens?, maxOutputTokens?, maxResolution?, maxDuration?
  }
  defaultParams?: {
    temperature?, maxTokens?, width?, height?
  }
}
💰 Логика расчёта cost в mapToDto()

Typescript

// Начальное значение:
let cost = model.minTokenCost

// TEXT модели:
//   avgCostPerMillion = (costPerMillionInputTokens + costPerMillionOutputTokens) / 2
//   cost = Math.max(minTokenCost, Math.ceil(avgCostPerMillion))
//   ⚠️ avgCostPerMillion — стоимость за МИЛЛИОН токенов, не за тысячу.
//      Комментарий "за ~1000 токенов" не соответствует коду.
//      Реальная стоимость в ~1000х больше чем показывается UI.

// MEDIA модели:
//   cost = Math.max(minTokenCost, Math.ceil(fixedCostPerGeneration * tokensPerDollar))

// Финальный fallback:
//   cost = cost || model.tokenCost || 1
//   ⚠️ model.tokenCost — поле, которого нет в схеме AIModel из блока 2.
//      Обращение к несуществующему полю вернёт undefined → cost = 1 (дефолт)
🏷️ Логика определения провайдера

getProviderName()

Typescript

// 1. providerMappings[0].providerSlug → formatProviderName()
// 2. Fallback → guessProviderBySlug(model.slug)
// ⚠️ Берётся ПЕРВЫЙ маппинг — порядок важен, но sortOrder маппингов не гарантирован
formatProviderName()

Typescript

// Словарь: openrouter, evolink, kie, replicate
// Если providerSlug не в словаре → guessProviderBySlug(providerSlug)
// ⚠️ На вход уходит providerSlug, а не model.slug
//    guessProviderBySlug проверяет slug.includes('gpt') и т.д.
//    providerSlug обычно 'openrouter', 'kie' — не содержит имён моделей
//    → вернёт 'AI' для неизвестных провайдеров
guessProviderBySlug()

Typescript

// 20+ проверок через slug.includes()
// Порядок проверок важен: slug 'sora-2' → попадёт в OpenAI (sora)
// slug 'dall-e-3' → попадёт в OpenAI (dall)
// ⚠️ Хрупкая логика — любое изменение нейминга сломает маппинг
// ⚠️ Нет кэширования — вызывается для каждой модели при каждом запросе
⚠️ Замеченные проблемы

🔴 Критичные

Неверный расчёт cost для TEXT моделей — avgCostPerMillion — это средняя стоимость за миллион токенов. Math.ceil(avgCostPerMillion) без деления на 1000 показывает пользователю стоимость в ~1000 раз завышенную относительно комментария "за ~1000 токенов". Если costPerMillionInputTokens = 10 и costPerMillionOutputTokens = 30 → avgCostPerMillion = 20 → cost = 20. Это 20 токенов за МИЛЛИОН символов (слишком дёшево), или 20 токенов за 1000 (слишком дорого) — зависит от того какие числа реально хранятся в БД, но комментарий и код противоречат друг другу.

Доступ к недоступным моделям через прямой запрос — getAvailableModels фильтрует модели по плану, но getModelBySlug при model = null кидает NotFoundException. Фронт не может различить "модель не существует" и "модель недоступна для вашего плана". Оба случая дают 404.

🟡 Средние

Мёртвые зависимости в модуле — AiProvidersModule и UsersModule импортируются через forwardRef, но ни один сервис из них не используется. Лишняя нагрузка на DI-контейнер и усложнение графа зависимостей.

model.tokenCost — несуществующее поле — fallback cost || model.tokenCost || 1 обращается к полю которого нет в AIModel схеме (из блока 2). Всегда будет undefined, финальный cost всегда будет 1 если предыдущие расчёты дали 0.

Фильтрация по плану: сравнение enum со значением из БД — includedPlans.includes(userPlan). userPlan — значение TypeScript enum SubscriptionPlan. Если в MongoDB хранится строка 'pro', а SubscriptionPlan.PRO = 'PRO' (uppercase) — сравнение вернёт false и все premium модели будут недоступны всем пользователям.

getAvailableModels фильтрует в памяти — find({ isActive: true }) загружает все модели, затем filter() в JS отсеивает недоступные. При 500+ моделях это неэффективно. Фильтр по плану можно включить в MongoDB запрос.

Нет кэширования — список моделей читается из MongoDB при каждом запросе. Данные меняются редко (при деплое/обновлении моделей). Нет Redis-кэша или in-memory TTL.

userId в getModels не используется — @CurrentUser('sub') userId извлекается из JWT, но в метод getAvailableModels не передаётся. Поле объявлено, но мёртвое.

🟢 Минорные

guessProviderBySlug — хрупкий slug matching — slug.includes('nano') вернёт 'Community' для любой модели с "nano" в названии (gemini-nano, gpt-4-nano). Нет приоритета специфичных паттернов над общими.

providerMappings[0] без sortOrder — берётся первый маппинг как "основной" провайдер, но порядок документов в массиве не гарантирован при обновлении схемы через Mongoose.

mapToDto не возвращает uiParameters и pricingMatrix — поля есть в AIModel схеме (используются в getModelUIConfig из GenerationModule), но в ModelDto не включены. Фронт должен делать второй запрос (/generation/models/:slug/ui-config) для получения конфигурации формы.

Дублирование кода getModelUIConfig — похожая логика чтения модели есть в GenerationService.getModelUIConfig(). Два разных эндпоинта (GET /models/:slug и GET /generation/models/:slug/ui-config) возвращают частично пересекающиеся данные.

Весь код продублирован в сообщении — все три файла присутствуют дважды.