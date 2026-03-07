# 🤖 AI Providers Module — Детальный контекст

## Назначение
Ядро системы. Абстракция над внешними AI провайдерами. Реестр провайдеров, маппинг моделей, fallback chain, health checks.

## Файлы модуля
src/modules/ai-providers/
├── ai-providers.module.ts
├── ai-providers.controller.ts
├── ai-providers.service.ts
├── schemas/
│   ├── provider.schema.ts          # Провайдер (openrouter, evolink, etc)
│   └── model.schema.ts             # AI модель (gpt-4o, midjourney, etc)
├── providers/
│   ├── base-provider.abstract.ts   # Абстрактный класс + интерфейсы
│   ├── openrouter.provider.ts      # OpenRouter реализация
│   ├── evolink.provider.ts         # Evolink реализация
│   ├── kie.provider.ts             # KIE реализация
│   ├── replicate.provider.ts       # Replicate реализация
│   └── provider-registry.service.ts # Реестр + health check + seed
└── dto/
└── provider-config.dto.ts



## Архитектура Fallback
Запрос на модель "midjourney"
│
▼
┌─ Model.providerMappings (sorted by priority) ─┐
│  1. evolink  (priority: 1, isActive: true)     │
│  2. kie      (priority: 2, isActive: true)     │
└────────────────────────────────────────────────┘
│
▼
Provider 1 (evolink):
├── Healthy? → YES → Send request
│     ├── Success → return result ✅
│     └── Error (retryable: 429/5xx) → try next
└── Healthy? → NO (consecutiveErrors > 5) → skip
│
▼
Provider 2 (kie):
├── Send request
│     ├── Success → return result ✅
│     └── Error → ALL_PROVIDERS_FAILED ❌



## BaseProvider — абстрактный интерфейс

Каждый провайдер реализует:
```typescript
abstract class BaseProvider {
  generateText(request): Promise<GenerationResult>
  generateTextStream(request): AsyncGenerator<StreamChunk>
  generateImage(request): Promise<GenerationResult>
  generateVideo(request): Promise<GenerationResult>
  generateAudio(request): Promise<GenerationResult>
  checkTaskStatus(taskId): Promise<TaskStatusResult>
  healthCheck(): Promise<boolean>
}
Типы запросов

TextGenerationRequest

Typescript

{
  model: string;        // ID модели у провайдера
  messages: { role: string; content: string }[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stream?: boolean;
}
ImageGenerationRequest

Typescript

{
  model: string;
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  numImages?: number;
  style?: string;
}
VideoGenerationRequest

Typescript

{
  model: string;
  prompt: string;
  imageUrl?: string;      // img2video
  duration?: number;
  fps?: number;
  resolution?: string;
  aspectRatio?: string;
  style?: string;
  negativePrompt?: string;
}
AudioGenerationRequest

Typescript

{
  model: string;
  prompt: string;          // lyrics/description/text
  style?: string;
  duration?: number;
  instrumental?: boolean;
  voiceId?: string;        // ElevenLabs
  text?: string;           // TTS
  language?: string;
}
GenerationResult — единый формат ответа

Typescript

{
  success: boolean;
  data?: {
    content?: string;        // текст
    urls?: string[];         // медиа URL
    taskId?: string;         // для async polling
    metadata?: Record<string, any>;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  error?: {
    code: string;
    message: string;
    retryable: boolean;     // Ключевое поле для fallback
  };
  responseTimeMs: number;
  providerSlug: string;
}
Provider Schema (MongoDB)

Typescript

{
  slug: string;               // 'openrouter'
  name: string;
  baseUrl: string;
  isActive: boolean;          // Админ может выключить
  priority: number;
  healthStatus: {
    isHealthy: boolean;
    lastCheck: Date;
    responseTime: number;
    errorRate: number;
    consecutiveErrors: number;  // > 5 → skip в fallback
  };
  rateLimits: {
    requestsPerMinute: number;
    requestsPerDay: number;
  };
}
Model Schema (MongoDB)

Typescript

{
  slug: string;               // 'gpt-4o', уникальный
  name: string;
  displayName: string;
  description: string;
  icon: string;
  type: 'text' | 'image' | 'video' | 'audio';
  isActive: boolean;
  isPremium: boolean;
  sortOrder: number;
  tokenCost: number;
  providerMappings: [{        // Fallback chain
    providerId: ObjectId;
    providerSlug: string;
    modelId: string;          // ID у провайдера
    priority: number;
    isActive: boolean;
  }];
  defaultParams: { ... };
  limits: { ... };
  capabilities: string[];
  stats: {
    totalRequests: number;
    avgResponseTime: number;
    successRate: number;
  };
}
Health Check Cron

Запускается каждую минуту (@Cron(EVERY_MINUTE))
Вызывает healthCheck() для каждого провайдера
Обновляет healthStatus в MongoDB
При consecutiveErrors > 5 провайдер исключается из fallback
Seed моделей

При первом запуске (onModuleInit) если нет моделей в БД — автоматически создаются все 25+ моделей с маппингами на провайдеров.

API Endpoints

Method	Path	Auth	Description
GET	/models	✅ JWT	Все модели (?type=text)
GET	/models/:slug	✅ JWT	Детали модели
Добавление нового провайдера

Создать new-provider.provider.ts extends BaseProvider
Реализовать все абстрактные методы
Добавить в ProviderRegistryService.initializeProviders()
Добавить env переменные
Добавить маппинги в seed моделей