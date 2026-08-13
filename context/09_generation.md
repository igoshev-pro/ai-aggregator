📦 Контекст: Backend (NestJS) — Блок 5: Generation Module

🗂️ Структура модуля


src/modules/generation/
├── generation.module.ts
├── generation.controller.ts
├── generation.service.ts
├── generation.gateway.ts
├── dto/
│   ├── calculate-price.dto.ts
│   └── image-generation.dto.ts   (содержит Image + Video + Audio DTOs)
├── queues/
│   └── generation.consumer.ts
└── schemas/
    └── generation.schema.ts
🔗 Зависимости модуля

Typescript

GenerationModule imports:
  MongooseModule: [Generation, AIModel]
  BullModule: queue 'generation' (attempts: 3, backoff: exponential 3s,
                                  removeOnComplete: 50, removeOnFail: 20)
  JwtModule.registerAsync (только секрет, без expiresIn)
  forwardRef → AiProvidersModule
  forwardRef → UsersModule
  forwardRef → BillingModule     (даёт PricingService)
  StorageModule

exports:
  GenerationService
  GenerationGateway
📡 API Эндпоинты


POST /generation/image                  создать генерацию изображения  [JWT, throttle 5/60s]
POST /generation/video                  создать генерацию видео        [JWT, throttle 3/60s]
POST /generation/audio                  создать генерацию аудио        [JWT, throttle 5/60s]
POST /generation/calculate-price        preview цены                   [JWT, без throttle]
GET  /generation/models/:slug/ui-config конфиг модели для UI           [JWT]
GET  /generation/status/:id             статус генерации               [JWT]
GET  /generation/history                история генераций              [JWT]
GET  /generation/favorites              избранные генерации            [JWT]
PUT  /generation/:id/favorite           переключить избранное          [JWT]
🗄️ Схема: Generation

Typescript

{
  userId: ObjectId          // ref: User, required, indexed
  type: GenerationType      // IMAGE | VIDEO | AUDIO
  modelSlug: string         // required
  status: GenerationStatus  // PENDING | PROCESSING | COMPLETED | FAILED
  prompt: string            // required
  negativePrompt?: string
  params: {                 // type: Object — все параметры провайдера
    // IMAGE
    width?, height?, aspectRatio?, resolution?, quality?, outputFormat?
    steps?, seed?, numImages?, style?, inputUrls?, mode?, version?
    // VIDEO
    imageUrl?, imageUrls?, videoUrls?, duration?, sound?, stable?
    removeWatermark?, promptOptimizer?, waterMark?, style?
    // AUDIO Suno
    operation?, title?, instrumental?, customMode?, audioUrl?
    // AUDIO ElevenLabs
    voiceId?, language?, stability?, similarity?, speed?, loop?
    promptInfluence?, dialogue?
    // EXTRA
    [key: string]: any
  }
  resultUrls: string[]      // URL результатов (S3 или провайдер)
  storageUrls: string[]     // постоянные URL в S3
  storageKeys: string[]     // ключи S3 для удаления
  savedToStorage: boolean
  resultContent?: string
  taskId?: string           // ID задачи у провайдера (для async)
  providerSlug?: string
  progress: number          // 0-100
  eta?: number
  inputTokens: number       // от провайдера
  outputTokens: number      // от провайдера
  totalProviderTokens: number
  costInDollars: number     // стоимость у провайдера
  tokensCost: number        // стоимость в наших токенах (списано при старте)
  pricingBreakdown: {       // аудит какое правило сработало
    modelSlug, modelName, type, rule?, params, costInTokens, costInDollars, fallback
  } | null
  isRefunded: boolean       // защита от двойного рефанда
  billingRecorded: boolean  // защита от дублирования транзакции
  startedAt?, completedAt?, responseTimeMs?
  errorMessage?: string
  retryCount: number
  isFavorite: boolean
  metadata: {}
}

Индексы:
  { userId: 1, createdAt: -1 }
  { userId: 1, type: 1, createdAt: -1 }
  { status: 1, taskId: 1 }
  { userId: 1, isFavorite: 1, createdAt: -1 }
💰 Флоу создания генерации (общий для Image/Video/Audio)


1. getModelBySlug(modelSlug)
   ← aiProvidersService
   Результат используется только для defaultParams
   ⚠️ Нет проверки isActive модели в GenerationService
      (в отличие от PricingService где isActive проверяется)

2. pricingService.calculatePrice(modelSlug, priceParams)
   → costInTokens, costInDollars, breakdown

3. validateBalance(userId, costInTokens)
   ← user.tokenBalance + user.bonusTokens
   ⚠️ cashbackBalance НЕ учитывается

4. generation.save() — создать запись со статусом PENDING

5. usersService.deductTokens(userId, costInTokens, 'generation_reserve')
   ← АТОМАРНО списывает с баланса

6. generationQueue.add('process-generation', jobData, opts)
   → Bull Queue (Redis)

7. return { generationId, status: 'PENDING', tokensCost, costInDollars, pricingBreakdown }
⚠️ Критически важно: между шагами 4 (save) и 5 (deduct) нет транзакции. Если deductTokens упадёт — генерация создана в БД, токены не списаны, задача не добавлена в очередь. Генерация зависнет в PENDING навсегда.

⚠️ Между шагами 5 (deduct) и 6 (queue.add) — то же: токены списаны, но задача не поставлена. Нет механизма компенсации.

🔄 GenerationConsumer (Bull Worker)

Основной обработчик: @Process('process-generation')


Queue settings:
  attempts: 3 (default), backoff: exponential 3s
  VIDEO: attempts: 2, backoff: 5s
  timeout: IMAGE/AUDIO 300s, VIDEO 600s

Flow:
  1. updateGeneration → PROCESSING, startedAt
  2. WS: generation:status { PROCESSING }
  3. aiProvidersService.generate{Image|Video|Audio}(modelSlug, request)

  Sync result (нет taskId или есть URLs):
    4. saveToStorage(urls) → S3
    5. updateGeneration → COMPLETED + resultUrls + storageUrls + storageKeys
    6. recordSuccessfulGeneration(generationId) → billing transaction
    7. WS: generation:completed

  Async result (есть taskId, нет URLs):
    4. pollTaskUntilComplete(...)

  При ошибке любого шага:
    → updateGeneration({ errorMessage })
    → throw (Bull делает retry или финальный fail)
    ⚠️ НЕ делать refund здесь — только в @OnQueueFailed после всех попыток
@OnQueueFailed() — финальная обработка ошибок

Typescript

// Проверяет: job.attemptsMade >= job.opts.attempts
// Если не финальный fail → warn и return

// Финальный fail:
//   1. updateGeneration → FAILED + completedAt
//   2. refundGeneration(generationId) — идемпотентно через isRefunded
//   3. WS: generation:failed { refunded: true }

// ⚠️ job.attemptsMade — количество ЗАВЕРШЁННЫХ попыток
//    При attempts=3: после 3-й попытки attemptsMade=3, opts.attempts=3 → isFinalFailure=true ✓
//    При attempts=1: после 1-й попытки attemptsMade=1, opts.attempts=1 → isFinalFailure=true ✓
pollTaskUntilComplete (async polling)

Typescript

// maxAttempts = 120, pollInterval = 5000ms → максимум 10 минут
// maxConsecutiveFailures = 3

// При каждом poll:
//   checkTaskStatus(providerSlug, taskId)
//   status === 'completed' → saveToStorage + updateGeneration + recordBilling + WS
//   status === 'failed' → consecutiveFailures++, если >= 3 → throw
//   status === другой → consecutiveFailures = 0 (продолжаем ждать)
//   ошибка poll запроса → consecutiveFailures++, если >= 3 → throw

// ⚠️ После завершения pollTaskUntilComplete (return или throw)
//    handleGeneration возвращает undefined или бросает исключение.
//    При throw → Bull сделает retry → новый handleGeneration → новый pollTaskUntilComplete
//    → новый poll цикл для того же taskId (дубликат опроса возможен при retry)

// ⚠️ При успехе: recordSuccessfulGeneration защищена billingRecorded
//    Но saveToStorage вызовется снова при retry → дублирование файлов в S3
saveToStorage

Typescript

// Параллельный download + upload для всех URLs (Promise.all)
// При ошибке: возвращает пустые массивы, НЕ бросает
// → resultUrls fallback к providerUrls (временным ссылкам провайдера)
// ⚠️ providerUrls могут протухнуть (у многих провайдеров TTL 24-72ч)
🔔 GenerationGateway (WebSocket)

Typescript

@WebSocketGateway({
  cors: { origin: '*' },   // ⚠️ все origins
  namespace: '/generation',
  transports: ['websocket', 'polling'],
})

// Auth при подключении:
//   token из handshake.auth.token || Authorization header
//   jwtService.verify(token, { secret: JWT_SECRET })
//   При ошибке → client.disconnect()

// In-memory mapping:
//   userSockets: Map<userId, Set<socketId>>
//   ⚠️ При горизонтальном масштабировании (несколько инстансов)
//      Map не шарится → событие может уйти не на тот инстанс

// Rooms:
//   'user:{userId}'          — личная комната пользователя
//   'generation:{id}'        — комната конкретной генерации

// Events из клиента:
//   generation:subscribe   → client.join('generation:{id}')
//   generation:unsubscribe → client.leave('generation:{id}')

// Events из сервера:
//   generation:status      → { generationId, status }
//   generation:progress    → { generationId, progress, eta, status }
//   generation:completed   → { generationId, status, resultUrls, resultContent, responseTimeMs }
//   generation:failed      → { generationId, status, errorMessage, refunded }
🎯 GenerationService — ключевые методы

validateBalance()

Typescript

// user.tokenBalance + user.bonusTokens < cost → BadRequestException
// ⚠️ cashbackBalance игнорируется (как и в ChatService)
// ⚠️ Race condition: validateBalance → deductTokens не атомарны.
//    Между проверкой и списанием другой запрос может потратить токены.
//    deductTokens в UsersService должен иметь собственную защиту ($inc + условие >= 0)
refundGeneration()

Typescript

// Идемпотентность: if (!generation || generation.isRefunded) return
// Бесплатные генерации: if (tokensCost <= 0) → isRefunded=true, return
// Последовательность:
//   1. usersService.refundTokens(userId, tokensCost)
//   2. billingService.recordRefund(userId, tokensCost, description, generationId)
//   3. generation.isRefunded = true; save()
// ⚠️ Не атомарно: если save() упадёт после refundTokens → повторный refund возможен
recordSuccessfulGeneration()

Typescript

// Идемпотентность: if (generation.billingRecorded) return
// Вызывает billingService.recordMediaGeneration()
//   → записывает транзакцию (tokensCost уже списан deductTokens)
//   → НЕ списывает токены повторно
// После успеха: updateOne({ billingRecorded: true })
// ⚠️ Между check billingRecorded и updateOne — окно для дубля при concurrent retry
//    Нужен findOneAndUpdate с условием billingRecorded: false
getModelUIConfig()

Typescript

// findOne({ slug, isActive: true }) — только активные модели
// Возвращает: slug, name, displayName, description, icon, type, isPremium,
//             capabilities, uiParameters, inputCapabilities, pricingMatrix,
//             minTokenCost, defaultParams, limits
// ⚠️ Нет JWT guard для этого эндпоинта — любой авторизованный пользователь видит
//    pricingMatrix с costInDollars (внутренние данные о стоимости провайдера)
📋 DTOs

ImageGenerationDto

Typescript

modelSlug: string     // required
prompt: string        // required, нет MaxLength
negativePrompt?
width?, height?, aspectRatio?, resolution?, quality?, outputFormat?
steps?, seed?, numImages?, style?
inputUrls?: string[]
mode?: string         // 'normal' | 'fast' | 'turbo' (Midjourney)
version?: string      // 'normal' | 'pro' (Flux)
// ⚠️ mode и version — @IsString() без @IsIn([...]) → любая строка пройдёт валидацию
// ⚠️ нет MaxLength на prompt → огромный prompt уйдёт к провайдеру
VideoGenerationDto

Typescript

modelSlug, prompt (@MaxLength(10000)), negativePrompt?
imageUrl?, imageUrls?, videoUrls?, referenceImages?, audioUrls?
duration?: @Min(1) @Max(600)   // 600 — из-за Topaz (апскейл до 10 мин видео)
aspectRatio?, resolution?, mode?, quality?, sound?, stable?
removeWatermark?, waterMark?, promptOptimizer?, style?
generateAudio?, resizeMode?, watermark?, generationType?
multiShots?, multiPrompt?, klingElements?   // Kling 3.0
cfgScale?, nsfwChecker?                     // Kling 2.5
fixedLens?                                  // Seedance 1.5
webSearch?, refVideoSeconds? (@Max(60))     // Seedance 2/2.5
firstFrameUrl?, lastFrameUrl?, returnLastFrame?, outputFormat?  // Seedance 2.5
// ⚠️ prompt обязателен даже для Topaz, где промпт не используется —
//    фронт шлёт пустую строку (проходит @IsString, нет @IsNotEmpty)
// ⚠️ ЛЮБОЕ новое поле нужно добавить в ТРЁХ местах generation.service:
//    priceParams (если влияет на цену) → generation.params → queue request.
//    Иначе поле молча теряется по пути к провайдеру.
AudioGenerationDto

Typescript

modelSlug, prompt (@MaxLength(5000))
style?, duration? (@Min(1) @Max(300)), instrumental?, customMode?
operation?: string   // generate/extend/boost/cover/persona/stems/instrumental/lyrics/video
title?, voiceId?, language?
stability?, similarity?: @Min(0) @Max(1)
speed?: @Min(0.25) @Max(4)
loop?, promptInfluence?: @Min(0) @Max(1)
audioUrl?
dialogue?: DialogueLineDto[]  // @ValidateNested + @Type
negativeTags?, vocalGender?, styleWeight?, weirdnessConstraint?, audioWeight?
textLength?                   // посимвольная тарификация ElevenLabs
exampleDialogue? (@MaxLength(120))  // Gemini Omni Audio
CalculatePriceDto

Typescript

modelSlug: string    // required
params?: Record<string, any>  // @IsObject() — нет ограничений на содержимое
// ⚠️ calculate-price доступен без throttle
//    → можно делать бесконечные запросы для price discovery
⚠️ Замеченные проблемы

🔴 Критичные

Неатомарный флоу создания генерации — generation.save() → deductTokens() → queue.add() — три отдельные операции. Сбой между любыми двумя оставляет систему в рассогласованном состоянии:

save OK, deduct FAIL → генерация в PENDING, токены не списаны, задача не создана
deduct OK, queue FAIL → токены списаны, задача не создана, генерация в PENDING навсегда
Race condition в recordSuccessfulGeneration — findById → проверка billingRecorded → recordMediaGeneration → updateOne({ billingRecorded: true }). При Bull retry оба процесса пройдут проверку одновременно и запишут дублирующую транзакцию. Нужен атомарный findOneAndUpdate({ billingRecorded: false }, { $set: { billingRecorded: true } }) ДО записи транзакции.

pollTaskUntilComplete при Bull retry создаёт дубль S3 файлов — если poll завершился ошибкой и Bull делает retry → новый handleGeneration → новый poll → при успехе saveToStorage вызывается повторно. billingRecorded защищает транзакцию, но не S3 загрузку.

PENDING генерации без механизма восстановления — нет cron/cleanup для генераций, зависших в PENDING (из-за краша воркера, ошибки queue.add и т.д.). Пользователь теряет токены без refund.

🟡 Средние

validateBalance не учитывает cashbackBalance — tokenBalance + bonusTokens без cashbackBalance. Аналогично ChatService (блок 6).

Нет проверки isActive при создании генерации — aiProvidersService.getModelBySlug() может вернуть неактивную модель. PricingService проверяет isActive, но генерация всё равно создаётся.

WS Gateway не масштабируется горизонтально — userSockets: Map<string, Set<string>> in-memory. При нескольких инстансах событие от Consumer уйдёт только на инстанс, где Map знает о клиенте. Нужен Redis adapter для Socket.IO.

CORS WebSocket: origin: '*' — принимает подключения с любого домена.

mode/version в DTOs без IsIn — @IsString() без @IsIn(['normal', 'fast', 'turbo']). Невалидный режим дойдёт до провайдера.

Audio requestPayload дублирует поля — voiceId и voice, language и language_code, similarity и similarity_boost, audioUrl и audio_url, promptInfluence и prompt_influence. Каждый параметр отправляется дважды в разных форматах. При добавлении нового провайдера сложно понять какое поле нужно.

getModelUIConfig раскрывает costInDollars — провайдерская стоимость видна всем авторизованным пользователям через pricingMatrix.

🟢 Минорные

model из getModelBySlug нигде не используется в generateAudio — переменная присваивается, но ни одно поле не читается (в отличие от generateImage/Video где берутся defaultParams).

calculatePrice без throttle — публичный эндпоинт для price discovery без ограничений частоты.

retryCount в схеме не обновляется — поле есть, но updateGeneration при retry не инкрементирует retryCount. Bull отслеживает попытки внутри, но в Generation схеме счётчик всегда 0.

totalProviderTokens в схеме никогда не записывается — поле объявлено, но ни один из методов не устанавливает значение.

Весь код продублирован в сообщении — все файлы встречаются дважды. Контекст не меняется.


