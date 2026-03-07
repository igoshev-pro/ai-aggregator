<!-- context/05-generation.md -->
# 🎨 Generation Module — Детальный контекст

## Назначение
Генерация медиа-контента: изображения, видео, аудио. Очереди Bull для async обработки, WebSocket для real-time обновлений статуса.

## Файлы модуля
src/modules/generation/
├── generation.module.ts
├── generation.controller.ts
├── generation.service.ts
├── generation.gateway.ts            # WebSocket Gateway
├── schemas/
│   └── generation.schema.ts
├── queues/
│   └── generation.consumer.ts       # Bull Queue Consumer
└── dto/
├── image-generation.dto.ts
├── video-generation.dto.ts
└── audio-generation.dto.ts



## Generation Schema
```typescript
{
  userId: ObjectId;
  type: 'text' | 'image' | 'video' | 'audio';
  modelSlug: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  prompt: string;
  negativePrompt: string;
  params: {
    width, height, steps, seed, numImages, style,
    aspectRatio, duration, fps, resolution, imageUrl,
    instrumental, voiceId, language
  };
  resultUrls: string[];
  resultContent: string;
  taskId: string;                // Для async polling
  providerSlug: string;
  progress: number;              // 0-100
  eta: number;                   // seconds
  tokensCost: number;
  isRefunded: boolean;
  startedAt: Date;
  completedAt: Date;
  responseTimeMs: number;
  errorMessage: string;
  retryCount: number;
  metadata: {};
  isFavorite: boolean;
}
Поток генерации (Image/Video/Audio)


1. POST /generation/image { modelSlug, prompt, params }
2. Validate model & balance
3. Create Generation record (status: PENDING)
4. Deduct tokens (reserve)
5. Add job to Bull Queue:
   - Image: priority 2, timeout 5min, 3 attempts
   - Video: priority 3, timeout 10min, 2 attempts
   - Audio: priority 2, timeout 10min, 3 attempts
6. Return { generationId, status: 'pending' }

=== Bull Consumer picks up job ===

7. Update status → PROCESSING
8. WebSocket: generation:status { PROCESSING }
9. Call AI Provider (with fallback chain)
10. Result types:
    a. Sync (URLs ready):
       - Update → COMPLETED, save URLs
       - WS: generation:completed
    b. Async (taskId returned):
       - Start polling loop (every 5s, max 120 attempts = 10min)
       - Each poll: WS generation:progress { progress, eta }
       - On complete: update → COMPLETED, save URLs
       - WS: generation:completed
11. On failure:
    - Update → FAILED
    - Refund tokens
    - WS: generation:failed { errorMessage, refunded: true }
Bull Queue Configuration

Typescript

{
  name: 'generation',
  defaultJobOptions: {
    removeOnComplete: 50,    // Keep last 50
    removeOnFail: 20,
    attempts: 3,             // Overridden per type
    backoff: {
      type: 'exponential',
      delay: 2000            // 2s, 4s, 8s
    }
  }
}
Polling Strategy


interval: 5 seconds
maxAttempts: 120 (= 10 minutes max)
each poll:
  - GET /tasks/{taskId} from provider
  - Map status: queued/pending → pending, running → processing, etc.
  - Update progress & ETA in DB
  - Send WebSocket update
  - If completed → save URLs, break
  - If failed → throw error, break
  - If timeout → throw timeout error
Rate Limits per Endpoint


POST /generation/image:  5 req/min
POST /generation/video:  3 req/min
POST /generation/audio:  5 req/min
API Endpoints

Method	Path	Auth	Rate	Description
POST	/generation/image	✅	5/min	Генерация изображения
POST	/generation/video	✅	3/min	Генерация видео
POST	/generation/audio	✅	5/min	Генерация аудио
GET	/generation/status/:id	✅	—	Статус генерации
GET	/generation/history	✅	—	История (?type=image)
GET	/generation/favorites	✅	—	Избранные
PUT	/generation/:id/favorite	✅	—	Toggle favorite
Refund Policy

Если генерация завершается ошибкой → токены автоматически возвращаются на tokenBalance пользователя + создаётся транзакция REFUND.

Зависимости

AiProvidersModule — вызов провайдеров
UsersModule — проверка/списание баланса
BillingModule — запись транзакций, рефанды
Bull Queue — обработка в фоне
GenerationGateway — WebSocket уведомления