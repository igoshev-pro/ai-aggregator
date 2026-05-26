📦 Контекст: Backend (NestJS) — Блок 6: AI Providers Module

🗂️ Структура модуля


src/modules/ai-providers/
├── ai-providers.module.ts
├── ai-providers.controller.ts
├── ai-providers.service.ts
├── dto/
│   └── model-access.dto.ts
├── providers/
│   ├── base-provider.abstract.ts
│   ├── openrouter.provider.ts        (text + image via /images/generations)
│   ├── openrouter-image.provider.ts  (image via /chat/completions + modalities)
│   ├── evolink.provider.ts           (GPT/Claude/image/video/audio)
│   ├── kie.provider.ts               (MJ/Flux/Suno/ElevenLabs/Kling/Runway/Hailuo)
│   ├── replicate.provider.ts         (image/video/audio, polling)
│   └── provider-registry.service.ts  (init + seed + healthcheck)
└── schemas/
    ├── model.schema.ts    (AIModel — MongoDB)
    └── provider.schema.ts (Provider — MongoDB)
🔗 Зависимости модуля

Typescript

AiProvidersModule imports:
  MongooseModule: [AIModel, Provider]
  forwardRef → BillingModule

exports:
  AiProvidersService
  ProviderRegistryService
  MongooseModule  // ← экспортирует схемы, чтобы AdminModule мог их использовать
⚠️ forwardRef с BillingModule — цикличная зависимость. AiProvidersService → BillingService (preview-цена), BillingService → AiProvidersService (расчёт стоимости).

🏗️ Абстракция провайдера (BaseProvider)

Typescript

abstract class BaseProvider {
  protected slug: string;
  protected config: ProviderConfig;  // { apiKey, baseUrl, timeout?, headers? }

  abstract generateText(request): Promise<GenerationResult>
  abstract generateTextStream(request): AsyncGenerator<StreamChunk>
  abstract generateImage(request): Promise<GenerationResult>
  abstract generateVideo(request): Promise<GenerationResult>
  abstract generateAudio(request): Promise<GenerationResult>
  abstract checkTaskStatus(taskId): Promise<TaskStatusResult>
  abstract healthCheck(): Promise<boolean>
}
Интерфейсы запросов

Typescript

// Мультимодальное сообщение (vision-support)
ChatMessage {
  role: string
  content: string | any[]   // string = legacy, any[] = OpenAI multimodal
  imageUrls?: string[]      // упрощённый формат — провайдер сам конвертирует
}

TextGenerationRequest { model, messages: ChatMessage[], maxTokens?, temperature?, topP?, stream? }
ImageGenerationRequest { model, prompt, negativePrompt?, width?, height?, aspectRatio?,
                         resolution?, quality?, outputFormat?, steps?, seed?, numImages?,
                         style?, inputUrls? }
VideoGenerationRequest { model, prompt, imageUrl?, duration?, fps?, resolution?,
                         aspectRatio?, style?, negativePrompt?, seed? }
AudioGenerationRequest { model, prompt, style?, duration?, instrumental?,
                         voiceId?, text?, language? }
Интерфейсы ответов

Typescript

GenerationResult {
  success: boolean
  data?: { content?, urls?, taskId?, metadata? }
  usage?: { inputTokens?, outputTokens?, totalTokens? }
  error?: { code, message, retryable: boolean }
  responseTimeMs: number
  providerSlug: string
}

StreamChunk {
  content: string
  done: boolean
  usage?: { inputTokens?, outputTokens? }
  error?: string
}

TaskStatusResult {
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress?: number   // 0-100
  resultUrls?: string[]
  error?: string
  eta?: number        // секунды
}
🤖 Провайдеры

1. OpenRouterProvider (slug: 'openrouter')

Назначение: Текстовые модели + обычная image generation через /images/generations


Text: POST /chat/completions (OpenAI-compatible)
Image: POST /images/generations
Поддерживаемые модели (из seed):

GPT-OSS 120B, GPT-4o, GPT-4o-mini
Claude Haiku 4.5 (через OR прокси)
DeepSeek V3.2, Grok 4, Grok 4.1 Fast
Perplexity Sonar
Vision: ✅ buildOpenAIContent() — стандартный OpenAI multimodal формат

Typescript

// Multimodal content:
[{ type: 'text', text }, { type: 'image_url', image_url: { url } }]
Особенности:

Заголовки: HTTP-Referer: 'https://your-app.com', X-Title: 'AI Aggregator'
Параметр top_p поддерживается (в отличие от Evolink)
checkTaskStatus → сразу возвращает completed (синхронный провайдер)
2. OpenRouterImageProvider (slug: 'openrouter' — тот же slug!)

Назначение: Генерация изображений через /chat/completions с modalities: ['image', 'text']

⚠️ КРИТИЧНО: Использует тот же slug 'openrouter' что и OpenRouterProvider. В ProviderRegistryService они регистрируются под разными ключами Map: 'openrouter' и 'openrouter-image'. Но в БД (providers collection) оба пишут в запись с slug='openrouter' — последний перезапишет первого в syncProvidersToDB().

Typescript

// Три варианта извлечения URL из ответа:
// 1: message.images[].image_url.url или .url
// 2: content[].type === 'image_url' → .image_url.url
// 3: content строка начинается с 'data:image' (base64)
Поддерживаемые модели (из seed):

openai/gpt-5-image
Не поддерживает: text, video, audio

3. EvolinkProvider (slug: 'evolink')

Назначение: GPT/Claude/DeepSeek (text) + async image/video/audio

Базовый URL: https://api.evolink.ai/v1 (из конфига, уже с /v1)

Text Generation


GPT/DeepSeek: POST /chat/completions  (OpenAI-compatible)
Claude:       POST /messages          (Anthropic Messages API)
Определение Claude-модели по префиксам:

Typescript

const CLAUDE_MODEL_PREFIXES = [
  'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5',
  'claude-sonnet-4-5', 'claude-opus-4-1', 'claude-opus-4-5', 'claude-sonnet-4-'
]
Claude Messages API — специфика

Typescript

// convertToClaudeMessages():
// 1. system messages → отдельный параметр `system` (плоский текст)
// 2. Несколько подряд идущих сообщений одной роли → объединяются
// 3. Первое сообщение ОБЯЗАНО быть от 'user' → если assistant — добавляем '...'
// 4. Пустой массив → заглушка { role: 'user', content: 'Hello' }
// 5. temperature ограничена max 1.0 (у OpenAI max 2.0)
// 6. max_tokens обязателен (у Anthropic нет дефолта)

// Claude vision format:
// Картинки идут ПЕРЕД текстом (рекомендация Anthropic)
[{ type: 'image', source: { type: 'url', url } }, { type: 'text', text }]
Evolink Image API

Typescript

POST /images/generations
// Поле 'size' вместо width/height:
// '1:1', '2:3', '3:2' или '1024x1024', '1024x1536', etc.
// Всегда возвращает async task { id, status }
Evolink Video API

Typescript

POST /videos/generations
// Специальные билдеры:
// kling-v3-image-to-video → buildKlingI2VBody() → поле image_start (обязательное)
// kling-v3-motion-control → buildKlingMotionBody() → image_urls + video_urls
// Остальные → buildVideoBody() → стандартный формат
// resolution маппится в поле quality
Evolink Task Polling

Typescript

GET /tasks/{task_id}
// Response: { id, status, progress, results[], error, task_info: { estimated_time } }
// results[] — массив URL результатов (ВАЖНО: поле называется results, не resultUrls!)
Evolink Status Mapping


queued/pending → 'pending'
running/processing → 'processing'
completed/succeeded → 'completed'
failed/error → 'failed'
Evolink Health Check


GET /credits  — лёгкий эндпоинт для проверки
4. KieProvider (slug: 'kie')

Базовый URL: https://api.kie.ai (без /v1)

Особенность: Разные эндпоинты для разных типов контента

KIE Image API

Typescript

POST /api/v1/jobs/createTask
// body: { model: kieModelId, input: { prompt, aspect_ratio, resolution/quality, ... } }
// response: { code: 200, data: { taskId } }
Маппинг aspect_ratio:

Typescript

toAspectRatio(width, height) // вычисляет GCD и возвращает строку '16:9', '1:1' и т.д.
KIE Image Model Params (KIE_MODEL_PARAMS):

Model	aspectRatios	resolutions	extras
flux-2/flex-text-to-image	7 опций	1K, 2K	-
flux-2/flex-image-to-image	+auto	1K, 2K	input_urls, max 8
seedream/5-lite-*	8 опций	basic, high	quality вместо resolution
google/imagen4*	5 опций	-	negativePrompt, seed
nano-banana-2	15 опций	1K, 2K, 4K	image_input, max 14, outputFormat
nano-banana-pro	11 опций	1K, 2K, 4K	image_input, max 8, outputFormat
mj_txt2img	7 опций	1K, 2K	mode (fast/relax/turbo)
mj_img2img	7 опций	1K, 2K	input_urls, max 8
KIE Video API

Typescript

// Два типа API:
POST /api/v1/jobs/createTask   // большинство моделей
POST /api/v1/runway/generate   // только runway

// VIDEO_MODEL_MAP содержит конфиги для:
// sora-2-text-to-video/image-to-video (nFrames: 10/15)
// kling-3.0/video, kling-3.0/motion-control (durations 3-15)
// runway (durations 5/10, Runway API)
// hailuo/* (durations 6/10, опционально image, resolution)
Авто-переключение модели по наличию изображения:

Typescript

// Если пришёл slug text-to-video, но есть imageUrl → переключается на image-to-video
// И наоборот. Аналогично для hailuo/sora.
// kling-3.0 работает как t2v так и i2v через одну модель
KIE Audio API

Три разных эндпоинта в зависимости от модели:

Typescript

// ElevenLabs:
POST /api/v1/jobs/createTask
// Модели: audio-isolation, sound-effect-v2, speech-to-text,
//         text-to-dialogue-v3, text-to-speech-multilingual-v2, text-to-speech-turbo-2-5

// Suno:
POST /api/v1/generate
// Модели: suno-v3/v4/v4_5/v5, ai-music-api/generate*
// Маппинг в KIE версии: V4, V4_5, V4_5PLUS, V4_5ALL, V5

// Lyrics:
POST /api/v1/lyrics  // отдельный метод generateLyrics()
ElevenLabs model-specific validation:

audio-isolation + speech-to-text — требуют audio_url
sound-effect-v2 — требует text
text-to-dialogue-v3 — парсит диалог из строки "Имя: текст" или принимает массив, max 5000 символов
text-to-speech-* — требуют text, принимают voice, stability, similarity_boost
KIE Task Status Routing

Typescript

// Определение типа по taskId:
// 1. isRunway: taskId.includes('runway') || UUID формат → /api/v1/runway/status
// 2. taskId.startsWith('task_elevenlabs_') → Jobs API + специальный парсер resultJson
// 3. Остальные → Jobs API → если ошибка 'recordInfo is null' → пробуем Suno API
//    Если Jobs вернул completed но нет URLs → пробуем Suno API

// checkJobsTaskStatus:
// POST /api/v1/jobs/recordInfo?taskId=...
// Парсит URLs из 15+ возможных полей (resultUrls, output, result, images, videos,
//   url, image_url, video_url, audio_url, data.urls, data.url, resultJson)

// checkSunoTaskStatus:
// GET /api/v1/generate/record-info?taskId=...
// States: PENDING → pending, TEXT_SUCCESS/FIRST_SUCCESS → processing, SUCCESS → completed
// Ищет URLs в response.sunoData[].audioUrl и data[].audio_url

// checkRunwayTaskStatus:
// GET /api/v1/runway/status?taskId=...
// States: waiting/queued → pending, running → processing, succeeded → completed

// getLyricsTaskStatus:
// GET /api/v1/lyrics/record-info?taskId=...
// States: PENDING, SUCCESS, *_FAILED
KIE Text Models

Typescript

// Только Gemini модели через специальные эндпоинты
private static readonly KIE_TEXT_MODELS = {
  'gemini-3.1-pro': '/gemini-3.1-pro/v1/chat/completions',
  'gemini-3-flash': '/gemini-3-flash/v1/chat/completions',
}
// Остальные модели → NOT_IMPLEMENTED
KIE Health Check

Typescript

// Использует заведомо несуществующий taskId — если API вернул HTTP ответ (любой) → healthy
GET /api/v1/jobs/recordInfo?taskId=health_check_test
// Если статус есть в ответе → return true (даже если code != 200)
// Если network error → return false
5. ReplicateProvider (slug: 'replicate')

Назначение: Image/Video/Audio через Replicate API

Typescript

POST /predictions  // для всех типов
GET  /predictions/:id  // polling
Особенности:

Иногда возвращает status: 'succeeded' синхронно (не нужно поллинг)
Progress из логов: parseProgress() — ищет \d+% в строке логов
Text generation: не поддерживается (возвращает UNSUPPORTED)
Конфиг baseUrl игнорируется — хардкодит https://api.replicate.com/v1
🗄️ ProviderRegistryService

Инициализация (onModuleInit)


1. initializeProviders() — создаёт провайдеры из конфига
2. syncProvidersToDB()   — upsert в коллекцию providers
3. seedDefaultModels()   — seed/migration моделей в коллекцию ai_models
Map провайдеров


'openrouter'       → OpenRouterProvider
'openrouter-image' → OpenRouterImageProvider  ← ключ НЕ совпадает с slug!
'evolink'          → EvolinkProvider
'kie'              → KieProvider
'replicate'        → ReplicateProvider
getProvidersForModel(modelSlug)

Typescript

// Алгоритм:
// 1. Найти модель в БД (isActive: true)
// 2. Отфильтровать mapping'и с isActive: true
// 3. Отсортировать по priority (возрастающий)
// 4. Для каждого mapping проверить Provider в БД (isActive: true)
// 5. Получить провайдер из Map
// → [{ provider: BaseProvider, modelId: string }]
⚠️ Для каждого mapping делается отдельный запрос к БД (providerModel.findOne). При большом количестве провайдеров — N запросов вместо одного.

Seed стратегия (split-write)


$set (ВСЕГДА обновляется):
  name, displayName, description, type, capabilities,
  providerMappings, limits, defaultParams

$setOnInsert (только при первом создании):
  slug, sortOrder, isActive, isPremium, tokensPerDollar, minTokenCost,
  tokenCost, costPerMillionInputTokens, costPerMillionOutputTokens,
  fixedCostPerGeneration, pricingMatrix, uiParameters, inputCapabilities, stats

ONE-TIME MIGRATION (один раз для существующих моделей без pricingMatrix/uiParameters):
  Добавляет pricingMatrix, uiParameters, inputCapabilities если они пустые
⚠️ rawResult: true + lastErrorObject.upserted — определяет был ли insert или update. Использует @ts-ignore (нестандартный для Mongoose способ).

Health Check Cron

Typescript

@Cron('0 */5 * * * *')  // каждые 5 минут
healthCheckAll() {
  // Параллельно проверяет все провайдеры
  // При выздоровлении: логирует '✅ Provider X recovered'
  // При 1-й и каждой 10-й ошибке: логирует предупреждение
  // Обновляет healthStatus в MongoDB
}
🔌 AiProvidersService

Fallback логика (executeWithFallback)

Typescript

// Перебирает провайдеры по приоритету:
// 1. Если result.success → возвращает, обновляет stats
// 2. Если result.error.retryable → продолжает к следующему
// 3. Если result.error.retryable === false → возвращает сразу (не пробует дальше)
// 4. Если исключение → логирует, продолжает
// После всех провайдеров → возвращает lastError или ALL_PROVIDERS_FAILED
⚠️ generateLyrics включён в union type метода, но KieProvider.generateLyrics не является методом BaseProvider — вызов через provider[method] сработает только для KieProvider и упадёт для остальных.

generateTextStream (streaming с fallback)

Typescript

// Аналогичная логика но через AsyncGenerator
// Определяет ошибку в чанке через chunk.error или chunk.content.startsWith('Error:')
// При ошибке — break из цикла, переходит к следующему провайдеру
// Если все упали → yield { content: '', done: true, error: lastError }
checkModelAccess()

Typescript

// Логика доступа:
// isPremium = false → hasAccess: true (всем)
// isPremium = true, includedInPlans = [] → доступна PRO/UNLIMITED/PLUS/ULTIMATE
// isPremium = true, includedInPlans = [...] → только если userPlan входит в список

// Определение requiredPlan:
// ULTIMATE (если нет PLUS в списке) → UNLIMITED (если нет PRO) → PLUS (дефолт)
⚠️ includedInPlans содержит строки ('pro', 'unlimited'), а userPlan — enum (SubscriptionPlan.PRO = 'pro'). Сравнение через includes работает правильно т.к. enum values = строки.

⚠️ getAvailableModelsForUser() — делает N запросов checkModelAccess() последовательно в цикле for...of. Для списка из 40+ моделей — медленно.

📊 AIModel Schema (MongoDB)

Ценовые поля — две системы

Новая система (🔥 за 1M токенов модели):


pricePerMillionInputTokens   🔥 за 1M входных токенов модели
pricePerMillionOutputTokens  🔥 за 1M выходных токенов модели
avgTokensPerRequest          средняя длина запроса (дефолт 1500)
providerCostPerMillionInput  $ у провайдера (справочно, не влияет на списание)
providerCostPerMillionOutput $ у провайдера (справочно)
Deprecated (для обратной совместимости):


costPerMillionInputTokens    $ (BillingService использует как fallback)
costPerMillionOutputTokens   $ (BillingService использует как fallback)
tokensPerDollar              курс (дефолт 30, deprecated)
minTokenCost                 минимум (дефолт 0.01, deprecated)
tokenCost                    старое поле
Media модели:


fixedCostPerGeneration  $ за генерацию (fallback если pricingMatrix не совпал)
pricingMatrix[]         { conditions, costInTokens, costInDollars, label? }
UIParameter типы

Typescript

type: 'select' | 'toggle' | 'boolean' | 'number' | 'text'
    | 'image-upload' | 'audio-upload' | 'video-upload'

// visibleWhen: { mode: ['fast', 'turbo'] } — условная видимость
// affectsPrice: true — BillingService использует это поле для подбора pricingMatrix
InputCapabilities

Typescript

{
  acceptsImages?: boolean
  acceptsFiles?: boolean
  acceptsAudio?: boolean
  acceptsVideo?: boolean
  acceptsVideos?: boolean  // алиас (kling-motion использует это)
  maxInputImages?: number
  maxFileSize?: number     // MB
  acceptedMimeTypes?: string[]
}
⚠️ acceptsVideo и acceptsVideos — два разных поля для одного смысла. Проверять нужно оба.

Индексы


slug: unique (автоматически)
{ type: 1, isActive: 1, sortOrder: 1 }: составной
📡 API Эндпоинты (/models)


GET /models              список активных моделей + preview-цены
GET /models/:slug        детали модели + preview + pricingMatrix
GET /models/:slug/pricing полная цена (через billingService.getModelPricing)
GET /models/:slug/preview-cost  только avg/min/max 🔥 (для бейджа в чате)
GET /models/:slug/estimate?params=JSON  оценка с конкретными параметрами
⚠️ /estimate принимает params как JSON-строку в query параметре — неудобно и ненадёжно. При ошибке парсинга тихо игнорируется (params = undefined).

⚠️ Все эндпоинты закрыты JwtAuthGuard — нет публичного доступа к списку моделей. Если фронт загружает модели до авторизации — нужен @SetMetadata('isPublic', true).

🎯 Каталог моделей (seed) — 40+ моделей

Текстовые (14 моделей)

slug	провайдер	isPremium
gpt-oss-120b	openrouter	-
claude-haiku-4.5	openrouter	-
deepseek-v3.2	openrouter	-
grok-4.1-fast	openrouter	-
grok-4	openrouter	✅ pro/unlimited
perplexity-sonar	openrouter	-
gpt-5.4	evolink	✅ unlimited
claude-opus-4.6	evolink	✅ unlimited
claude-sonnet-4.6	evolink	✅ pro/unlimited
deepseek-v4	evolink	- (isActive: false!)
gemini-3.1-pro	kie	-
gemini-3-flash	kie	-
gpt-4o	openrouter + evolink	-
gpt-4o-mini	openrouter + evolink	-
Изображения (10 моделей)

slug	провайдер	inputImages
gpt-5-image	openrouter-image	✅ max 4
gpt-image-1.5-lite	evolink	✅ max 4
midjourney	kie + evolink	✗
midjourney-img2img	kie	✅ max 1
seedream-5-lite	kie + evolink	✗
imagen-4	kie + evolink	✗
flux-2	kie	✗
flux-2-img2img	kie	✅ max 8
nano-banana-2	kie + evolink	✅ max 14
nano-banana-pro	kie	✅ max 8
Видео (11 моделей)

slug	провайдер	isPremium
veo-3.1-fast	evolink	-
veo-3.1-pro	evolink	✅ pro/unlimited
sora-2-pro	evolink	✅ unlimited
sora-2	kie	-
sora-2-img2vid	kie	-
kling-3.0	kie + evolink	-
kling-3.0-img2vid	kie + evolink	-
kling-3.0-motion	evolink	-
runway	kie + evolink(inactive)	-
hailuo-2.3-standard	kie + evolink(inactive)	-
hailuo-2.3-pro	kie	-
Аудио (7 моделей)

slug	провайдер
suno-v4	kie (ai-music-api/generate)
elevenlabs-tts-turbo	kie
elevenlabs-tts-multilingual	kie
elevenlabs-dialogue	kie
elevenlabs-isolation	kie
elevenlabs-stt	kie
elevenlabs-sfx	kie
⚠️ Замеченные проблемы

🔴 Критичные

openrouter-image slug коллизия — оба провайдера пишут в запись slug='openrouter' в БД через syncProvidersToDB(). Второй перезапишет первого. В памяти (Map) работает корректно.

executeWithFallback + generateLyrics — метод generateLyrics есть только у KieProvider, не в BaseProvider. Вызов provider['generateLyrics']() для OpenRouterProvider вернёт undefined() → TypeError.

getAvailableModelsForUser — последовательный for...of + N запросов к БД на 40+ моделей. Блокирует на каждой итерации.

deepseek-v4 — в seed providerMappings[0].isActive: false. getProvidersForModel() фильтрует неактивные маппинги → модель недоступна несмотря на isActive: true.

🟡 Средние

Seed $setOnInsert vs новые поля — схема имеет pricePerMillionInputTokens, pricePerMillionOutputTokens, но seed пишет только costPerMillionInputTokens. Новые ценовые поля = 0 у всех моделей в БД.

Vision capability неявная — supportsVision: false по дефолту в схеме. Seed не устанавливает supportsVision: true для vision-моделей (gpt-4o, claude-*). Фронт получает supportsVision: false для всех.

getProvidersForModel N+1 — отдельный providerModel.findOne() на каждый маппинг. Лучше один find({ slug: { $in: slugs }, isActive: true }) с последующим Map-lookup.

/models эндпоинты требуют JWT — нет публичного доступа к каталогу моделей. Фронт не может показать список моделей на лендинге или до логина.

/estimate params через query — GET /models/:slug/estimate?params={"mode":"turbo"} — JSON в URL неудобен, ломается при спецсимволах. Логичнее POST /models/:slug/estimate с body.

checkModelAccess + deprecated планы — проверяет PRO и UNLIMITED в premiumPlans, но seed-данные моделей хранят 'pro', 'unlimited' в includedInPlans. После полного перехода на новые планы эта логика станет мёртвым кодом.

ReplicateProvider игнорирует baseUrl — хардкодит https://api.replicate.com/v1 несмотря на то что конфиг передаёт baseUrl. Нельзя переопределить через конфиг.

EvolinkProvider stream error handling дублирован — один и тот же блок try/catch для чтения стрима ошибки скопирован 3 раза (OpenAI stream, Claude stream, внешний catch). Нужен хелпер.

🟢 Минорные

KieProvider isClaudeModel() — метода нет, Claude не поддерживается KIE. Определение Claude происходит только в EvolinkProvider.

KieProvider.toAspectRatio() — возвращает '1:1' если width или height = 0/undefined. Корректно, но нет валидации на нечисловые значения.

ProviderRegistryService не является NestJS-провайдером с @Injectable() — файл provider-registry.service.ts находится в папке providers/ но импортируется как обычный провайдер NestJS. Работает, но путает структуру.

buildModelsCatalog() — 1000+ строк в одном методе — весь каталог в одном методе. Сложно обслуживать при добавлении моделей.

supportsVision vs capabilities: ['vision'] — два разных способа обозначить vision поддержку. Схема имеет supportsVision: boolean, seed пишет capabilities: ['vision', ...]. Нет синхронизации между ними.

KieProvider ElevenLabs text-to-dialogue-v3 голоса — парсит строку "Имя: текст" и использует имя как voice ID. Если у пользователя имя не совпадает с реальным voice ID ElevenLabs — API вернёт ошибку. Нет валидации допустимых голосов.

📋 Сводная карта провайдер → модель → эндпоинт


openrouter:
  text  → POST /chat/completions (OpenAI)
  image → POST /images/generations

openrouter-image:
  image → POST /chat/completions (modalities: ['image','text'])

evolink (baseUrl уже /v1):
  text (GPT/DS) → POST /chat/completions
  text (Claude) → POST /messages
  image         → POST /images/generations → taskId (async)
  video         → POST /videos/generations → taskId (async)
  audio         → POST /audio/generations  → taskId (async)
  poll          → GET  /tasks/{taskId}

kie (baseUrl без /v1):
  image     → POST /api/v1/jobs/createTask
  video     → POST /api/v1/jobs/createTask  (или /api/v1/runway/generate)
  audio EL  → POST /api/v1/jobs/createTask
  audio Suno→ POST /api/v1/generate
  audio lyr → POST /api/v1/lyrics
  text Gem  → POST /gemini-3.1-pro/v1/chat/completions
  poll jobs → GET  /api/v1/jobs/recordInfo?taskId=
  poll suno → GET  /api/v1/generate/record-info?taskId=
  poll run  → GET  /api/v1/runway/status?taskId=
  poll lyr  → GET  /api/v1/lyrics/record-info?taskId=

replicate:
  image/video/audio → POST /predictions → GET /predictions/:id
