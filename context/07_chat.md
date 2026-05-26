📦 Контекст: Backend (NestJS) — Блок 6: Chat Module

🗂️ Структура модуля


src/modules/chat/
├── chat.module.ts
├── chat.controller.ts
├── chat.service.ts
└── schemas/
    ├── conversation.schema.ts
    └── message.schema.ts
🔗 Зависимости модуля

Typescript

ChatModule imports:
  MongooseModule: [Conversation, Message, AIModel]
  forwardRef → AiProvidersModule   (AiProvidersService, ProviderRegistryService)
  forwardRef → UsersModule         (UsersService)
  forwardRef → BillingModule       (BillingService)

exports:
  ChatService
⚠️ Все три внешних модуля через forwardRef — признак циклических зависимостей. ProviderRegistryService инжектируется но нигде не используется в коде сервиса.

📡 API Эндпоинты


GET  /chat/conversations                список бесед            [JWT]
GET  /chat/conversations/:id/messages   сообщения беседы        [JWT]
DELETE /chat/conversations/:id          удалить беседу          [JWT]
PUT  /chat/conversations/:id/rename     переименовать           [JWT]
PUT  /chat/conversations/:id/pin        закрепить/открепить     [JWT]
POST /chat/send                         отправить (без стрима)  [JWT, throttle 10/60s]
POST /chat/stream                       отправить (SSE стрим)   [JWT, throttle 10/60s]
🗄️ Схемы MongoDB

Conversation

Typescript

{
  userId: ObjectId        // ref: User, required, indexed
  modelSlug: string       // required — модель беседы (фиксируется при создании)
  title: string           // default: 'Новый чат'
  isPinned: boolean       // default: false
  isArchived: boolean     // default: false
  messageCount: number    // default: 0 — счётчик (+2 за каждый обмен)
  totalTokensUsed: number // default: 0 — суммарный usage.totalTokens
  systemPrompt?: string
  settings: {
    temperature?: number
    maxTokens?: number
    topP?: number         // поле есть в схеме, но никогда не записывается
  }
  lastMessageAt?: Date
  createdAt, updatedAt    // timestamps
}

Индексы:
  { userId: 1, createdAt: -1 }
  { userId: 1, isPinned: -1, lastMessageAt: -1 }  ← основной для списка
Message

Typescript

{
  conversationId: ObjectId  // ref: Conversation, required, indexed
  userId: ObjectId          // ref: User, required
  role: 'user' | 'assistant' | 'system'  // required
  content: string           // required если !isStreaming, default: ''
  imageUrls: string[]       // default: []
  modelSlug?: string
  providerSlug?: string
  inputTokens: number       // default: 0
  outputTokens: number      // default: 0
  usage?: {                 // дублирует inputTokens/outputTokens
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
  responseTimeMs?: number
  tokensCost: number        // default: 0
  isError: boolean          // default: false
  errorMessage?: string
  isStreaming: boolean      // default: false — true для placeholder
  createdAt, updatedAt
}

Индекс:
  { conversationId: 1, createdAt: 1 }  ← для истории (ASC порядок)
⚠️ Дублирование данных: inputTokens, outputTokens — отдельные поля И внутри объекта usage. При сохранении записываются оба варианта.

⚠️ required: function() { return !this.isStreaming; } — условный required через функцию. В Mongoose 7+ это работает при валидации схемы, но this указывает на document только при validate(), не при save() с отключённой валидацией.

💬 SendMessageDto

Typescript

interface SendMessageDto {
  conversationId?: string  // если не указан — создаётся новая беседа
  modelSlug: string        // required
  content: string          // required
  imageUrls?: string[]     // для vision моделей
  systemPrompt?: string    // переопределяет системный промпт беседы
  temperature?: number
  maxTokens?: number
}
⚠️ Нет валидации через class-validator — @Body() dto: SendMessageDto без ValidationPipe. Нет защиты от пустого content, невалидных imageUrls, отрицательных temperature.

🔄 Флоу sendMessage (non-streaming)


1. getModelBySlug(modelSlug)
   ⚠️ модель ищется без проверки isActive

2. Vision validation:
   - model.supportsVision (через as any — не типизировано)
   - inputCapabilities.maxInputImages || 4

3. checkSufficientBalance(userId, modelSlug)
   ← getModelPreviewCost() → minCostInTokens
   totalBalance = tokenBalance + bonusTokens
   ⚠️ cashbackBalance НЕ учитывается (в отличие от BillingService)

4. getConversationWithAccess || createConversation

5. Сохранить userMessage (role: 'user')

6. buildContext(conversation, dto)
   ← последние 20 сообщений (isError: false, isStreaming: false)
   ← системный промпт (dto.systemPrompt || conversation.systemPrompt)
   ← добавляет текущее dto.content как последнее user сообщение
   ⚠️ текущее сообщение дублируется: уже сохранено в БД И добавляется в конец контекста

7. aiProvidersService.generateText(modelSlug, { messages, maxTokens, temperature })

8. При ошибке: сохранить errorMessage + throw BadRequestException

9. billingService.chargeForGeneration(userId, modelSlug, 'text', conversationId,
                                      inputTokens, outputTokens)

10. Сохранить assistantMessage с usage/cost данными

11. conversation.messageCount += 2
    conversation.totalTokensUsed += usage.totalTokens
    conversation.lastMessageAt = new Date()
    Если messageCount <= 2 → generateTitle(dto.content)
    await conversation.save()

12. usersService.incrementDailyGenerations(userId)
🌊 Флоу streamMessage (SSE)


SSE события в порядке отправки:
  conversation    → { id, title }
  message_start   → { messageId } (placeholder в БД)
  text_delta      → { content } × N чанков
  error           → { message } (при ошибке — прерывает)
  message_end     → { messageId, usage, tokensCost }
  done            → {} (отправляется контроллером в любом случае)
Стейт-машина стрима


isStreaming=true placeholder создаётся в БД ПЕРЕД стримом

УСПЕХ (success && fullContent):
  → chargeForGeneration()
  → assistantMessage.content = fullContent, isStreaming=false
  → conversation обновляется
  → incrementDailyGenerations

ОШИБКА (!success):
  → messageModel.findByIdAndDelete(assistantMessage._id)
  → messageEnd отправляется с tokensCost=0
  ⚠️ messageEnd отправляется ДАЖЕ при ошибке — messageId указывает
     на удалённый документ

ЧАСТИЧНЫЙ КОНТЕНТ (success=false, но fullContent не пустой):
  ⚠️ Не обрабатывается отдельно — при success=false чистится весь placeholder
     даже если было накоплено 500 символов
Особенности контроллера streamMessage

Typescript

// @Post('stream') с @Res() — NestJS не управляет ответом
// Заголовки SSE:
//   Content-Type: text/event-stream
//   Cache-Control: no-cache, no-transform
//   Connection: keep-alive
//   X-Accel-Buffering: no   ← отключает nginx буферизацию

// done всегда отправляется (в finally-подобном блоке ПОСЛЕ try/catch)
// ⚠️ Если catch в контроллере сработает — done отправится ПОСЛЕ error события
🏗️ Вспомогательные методы

checkSufficientBalance()

Typescript

// Логика:
// 1. user.tokenBalance + user.bonusTokens → totalBalance
//    ⚠️ cashbackBalance игнорируется
// 2. getModelPreviewCost(modelSlug) → preview.minCostInTokens
// 3. required = Math.max(preview.minCostInTokens, 0.01)
// 4. if totalBalance < required → { ok: false }
// При ошибке getModelPreviewCost → fallback: required = 0.01
buildContext()

Typescript

// maxContextMessages = 20 (хардкоден)
// Запрос: isError: false, isStreaming: false, sort: createdAt DESC, limit 20
// Разворачивает в ASC порядок
// Добавляет системный промпт в начало (из dto или conversation)
// Добавляет dto.content как ПОСЛЕДНЕЕ сообщение

// ⚠️ Дублирование: dto.content уже сохранён в userMessage (шаг 5),
//    он же войдёт в следующий buildContext вызов через историю,
//    И добавляется явно в конец → при следующем запросе будет дважды
//    ← Нет: история фильтруется по БД до ТЕКУЩЕГО запроса, т.к. save случается
//       перед buildContext. Итого в контексте: история (включая только что сохранённое
//       userMessage) + явно добавленный dto.content = дубль последнего user сообщения
createConversation()

Typescript

// Создаёт беседу с modelSlug, systemPrompt, settings
// lastMessageAt = new Date() при создании
// title = 'Новый чат' (дефолт из схемы)
// title обновляется ПОСЛЕ первого ответа (messageCount <= 2)
// ⚠️ createConversation публичный — может быть вызван извне
generateTitle()

Typescript

// Берёт первые 50 символов content, убирает \n
// Никакого AI-генерируемого заголовка — просто обрезка запроса
getConversationWithAccess()

Typescript

// findById → проверка userId → NotFoundException / ForbiddenException
// ⚠️ Нет проверки ObjectId валидности перед findById
//    → невалидный id выбросит CastError от Mongoose вместо NotFoundException
📊 Ограничения и лимиты

Typescript

// Throttle: 10 запросов / 60 секунд на /send и /stream
// maxContextMessages: 20 (хардкоден в buildContext)
// MIN_REQUIRED_BALANCE: 0.01 🔥
// Пагинация conversations: дефолт 20/страница
// Пагинация messages: дефолт 50/страница (sort: DESC, reversed to ASC)
⚠️ Замеченные проблемы

🔴 Критичные

Дублирование последнего user сообщения в контексте — userMessage сохраняется в БД (await userMessage.save()), затем buildContext() читает историю включая только что сохранённое сообщение, И явно добавляет dto.content в конец. Итог: последнее сообщение пользователя отправляется провайдеру дважды. Модель видит: [..., user: "вопрос", user: "вопрос"].

checkSufficientBalance не учитывает cashbackBalance — totalBalance = tokenBalance + bonusTokens. В BillingService баланс = tokenBalance + bonusTokens + cashbackBalance. Пользователь с cashback может получить отказ несмотря на достаточный реальный баланс.

message_end отправляется с ID удалённого документа — при ошибке стрима findByIdAndDelete(assistantMessage._id) удаляет placeholder, но message_end всё равно отправляется с этим messageId. Фронт получает ID несуществующего сообщения.

🟡 Средние

ProviderRegistryService инжектируется но не используется — есть в конструкторе, нет ни одного вызова в коде. Мёртвая зависимость.

Нет валидации DTO — SendMessageDto без class-validator. content: '', temperature: -1, maxTokens: 0, imageUrls: ['not-a-url'] — всё пройдёт до провайдера.

getConversationWithAccess не валидирует ObjectId — невалидный conversationId (например 'abc') вызовет CastError: Cast to ObjectId failed вместо NotFoundException. Вернёт 500 вместо 404.

model.supportsVision через as any — (model as any).supportsVision обходит типизацию. Если поле переименуют/уберут — ошибка будет тихой (undefined → falsy → все запросы с картинками заблокируются).

messageCount <= 2 как условие первого сообщения — при concurrent запросах в новую беседу messageCount может быть 4 уже при первом сохранении. Заголовок не будет установлен. Надёжнее проверять messageCount === 0 ДО += 2.

Нет лимита на content длину — пользователь может отправить 100KB текста. Контекст отправится провайдеру, спишется за реальное количество токенов.

getMessages сортирует DESC + reverse — sort({ createdAt: -1 }).limit(50).reverse(). При пагинации страница 2 даст сообщения 51-100 в обратном порядке. Для корректной пагинации нужен ASC sort с правильным skip.

sendMessage не атомарен — если chargeForGeneration упадёт после generateText(), токены провайдеру потрачены, ответ пользователю не дан, списания нет. Обратного пути нет.

🟢 Минорные

Дублирование vision validation — одинаковый блок кода в sendMessage и streamMessage. Нужен приватный метод validateVisionRequest().

Conversation.settings.topP — поле есть в схеме, но никогда не записывается (не передаётся в createConversation). Мёртвое поле.

assistantMessage.providerSlug = (model as any).providerSlug — в стриме берётся из объекта модели, а не из ответа провайдера. Может быть неверным если модель маршрутизируется динамически.

conversation.totalTokensUsed += usage.totalTokens || 0 — при повторном запросе в ту же беседу значение накапливается корректно, но поле нигде не используется в бизнес-логике. Только для статистики UI.

Нет защиты от одновременных запросов в одну беседу — два параллельных streamMessage в один conversationId создадут два placeholder, оба обновят messageCount, итоговый счётчик будет неверным.


