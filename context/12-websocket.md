<!-- context/12-websocket.md -->
# 🔌 WebSocket (Generation Gateway) — Детальный контекст

## Назначение
Real-time уведомления о статусе генераций: прогресс, завершение, ошибки. Пользователь получает обновления мгновенно без polling.

## Файл
src/modules/generation/generation.gateway.ts



## Конфигурация
```typescript
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/generation',
  transports: ['websocket', 'polling'],
})
Подключение клиента

Из фронтенда (React/Next)

Typescript

import { io } from 'socket.io-client';

const socket = io('wss://api.example.com/generation', {
  auth: { token: jwtToken },
  transports: ['websocket', 'polling'],
});

// Подписка на все события пользователя (автоматическая по JWT)
socket.on('generation:status', (data) => {
  // { generationId, status: 'processing' }
});

socket.on('generation:progress', (data) => {
  // { generationId, progress: 45, eta: 30, status: 'processing' }
});

socket.on('generation:completed', (data) => {
  // { generationId, status: 'completed', resultUrls: [...] }
});

socket.on('generation:failed', (data) => {
  // { generationId, status: 'failed', errorMessage: '...', refunded: true }
});

// Подписка на конкретную генерацию (опционально)
socket.emit('generation:subscribe', { generationId: '...' });
socket.emit('generation:unsubscribe', { generationId: '...' });
Аутентификация

При подключении:

Извлекается JWT из client.handshake.auth.token или Authorization header
Верифицируется через JwtService
userId сохраняется в client.data.userId
Клиент присоединяется к комнате user:{userId}
Если невалидный токен → client.disconnect()
Внутренняя архитектура

Маппинг пользователей

Typescript

private userSockets = new Map<string, Set<string>>();
// userId → Set<socketId>
// Один пользователь может иметь несколько подключений
// (телефон + десктоп)
Комнаты (Rooms)


user:{userId}               — все сокеты пользователя
generation:{generationId}   — подписчики конкретной генерации
Методы отправки

Typescript

// Конкретному пользователю (все его устройства)
sendToUser(userId, event, data)

// Подписчикам генерации
sendToGeneration(generationId, event, data)

// Всем (maintenance и т.п.)
broadcast(event, data)

// Проверка онлайн
isUserOnline(userId): boolean
События

От сервера к клиенту

Event	Data	Когда
generation:status	{ generationId, status }	Смена статуса
generation:progress	{ generationId, progress, eta, status }	Обновление прогресса
generation:completed	{ generationId, status, resultUrls, resultContent?, responseTimeMs }	Завершение
generation:failed	{ generationId, status, errorMessage, refunded }	Ошибка
От клиента к серверу

Event	Data	Описание
generation:subscribe	{ generationId }	Подписка на генерацию
generation:unsubscribe	{ generationId }	Отписка
Кто вызывает Gateway


GenerationConsumer (Bull Queue)
    │
    ├── handleGeneration() — при смене статуса
    │     └── generationGateway.sendToUser(userId, 'generation:status', ...)
    │
    ├── pollTaskUntilComplete() — при обновлении прогресса
    │     └── generationGateway.sendToUser(userId, 'generation:progress', ...)
    │
    ├── on success
    │     └── generationGateway.sendToUser(userId, 'generation:completed', ...)
    │
    └── on failure
          └── generationGateway.sendToUser(userId, 'generation:failed', ...)
TODO

 Heartbeat / ping-pong для обнаружения мёртвых соединений
 Reconnection strategy на клиенте
 WebSocket для чата (typing indicator, new message push)
 WebSocket для биллинга (баланс обновился)
 Админский WebSocket namespace для live-дашборда
 Redis adapter для горизонтального масштабирования (несколько инстансов)