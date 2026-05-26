<!-- context/04-chat.md -->
# 💬 Chat Module — Детальный контекст

## Назначение
Текстовый чат с контекстом. Хранение истории разговоров, SSE стриминг ответов, управление чатами.

## Файлы модуля
src/modules/chat/
├── chat.module.ts
├── chat.controller.ts
├── chat.service.ts
└── schemas/
├── conversation.schema.ts
└── message.schema.ts



## Схемы данных

### Conversation
```typescript
{
  userId: ObjectId → User;
  modelSlug: string;           // Модель чата
  title: string;               // Авто-генерация из первого сообщения
  isPinned: boolean;
  isArchived: boolean;
  messageCount: number;
  totalTokensUsed: number;
  systemPrompt: string;        // Кастомный system prompt
  settings: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
  };
  lastMessageAt: Date;
}
Message

Typescript

{
  conversationId: ObjectId → Conversation;
  userId: ObjectId → User;
  role: 'user' | 'assistant' | 'system';
  content: string;
  imageUrls: string[];          // Для vision-моделей
  modelSlug: string;
  providerSlug: string;
  usage: { inputTokens, outputTokens, totalTokens };
  responseTimeMs: number;
  tokensCost: number;
  isError: boolean;
  errorMessage: string;
  isStreaming: boolean;         // true пока стримится
}
Поток отправки сообщения

Non-streaming (POST /chat/send)


1. Validate model exists & is active
2. Check user balance ≥ tokenCost
3. Get or create conversation
4. Save user message to DB
5. Build context (system prompt + last 20 messages + current)
6. Call aiProvidersService.generateText() with fallback
7. On success:
   - Deduct tokens via billingService
   - Save assistant message
   - Update conversation (messageCount, title, lastMessageAt)
   - Increment dailyGenerations
8. Return { message, conversation }
SSE Streaming (POST /chat/stream)


1-5. Same as above
6. Set response headers:
   - Content-Type: text/event-stream
   - Cache-Control: no-cache
   - Connection: keep-alive
7. Create placeholder assistant message (isStreaming: true)
8. Send event: conversation { id, title }
9. Send event: message_start { messageId }
10. For each chunk from aiProvidersService.generateTextStream():
    - Send event: text_delta { content }
11. On complete:
    - Deduct tokens
    - Update assistant message (content, isStreaming: false)
    - Send event: message_end { messageId, usage, tokensCost }
12. Send event: done {}
13. Close response
SSE Event Format


event: conversation
data: {"id":"...","title":"Новый чат"}

event: message_start
data: {"messageId":"..."}

event: text_delta
data: {"content":"Привет"}

event: text_delta
data: {"content":"! Как "}

event: message_end
data: {"messageId":"...","usage":{"inputTokens":50,"outputTokens":120},"tokensCost":3}

event: done
data: {}
Контекстное окно

Максимум 20 последних сообщений из чата
Исключаются ошибочные и streaming сообщения
System prompt вставляется первым
Текущее сообщение пользователя добавляется последним
Auto-title

При первом сообщении в чате (messageCount ≤ 2) заголовок генерируется из первых 50 символов сообщения пользователя.

API Endpoints

Method	Path	Auth	Description
GET	/chat/conversations	✅	Список чатов (paginated)
GET	/chat/conversations/:id/messages	✅	Сообщения чата
POST	/chat/send	✅	Отправка без стрима
POST	/chat/stream	✅	Отправка с SSE стримом
DELETE	/chat/conversations/:id	✅	Удалить чат + сообщения
PUT	/chat/conversations/:id/rename	✅	Переименовать
PUT	/chat/conversations/:id/pin	✅	Закрепить/открепить
Зависимости

AiProvidersModule — генерация текста
UsersModule — проверка баланса
BillingModule — списание токенов