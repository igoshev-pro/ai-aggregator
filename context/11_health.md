📦 Контекст: Backend (NestJS) — Блок 8: Health Module

🗂️ Структура модуля


src/modules/health/
├── health.module.ts
└── health.controller.ts
🔗 Зависимости модуля

Typescript

HealthModule imports: []   // нет внешних зависимостей
// @InjectConnection() резолвится из глобального MongooseModule в AppModule
// Нет guards — эндпоинт публичный
📡 API Эндпоинты


GET /health    проверка состояния сервиса   [публичный, без JWT]
📤 Ответ

Typescript

{
  status: 'ok',                        // всегда 'ok' если сервис отвечает
  timestamp: '2024-01-01T00:00:00Z',   // ISO строка
  uptime: 12345.678,                   // секунды с запуска процесса
  mongo: 'connected' | 'disconnected', // readyState === 1 → connected
  memory: {
    rss:  '150 MB',   // Resident Set Size (физическая память)
    heap: '80 MB',    // heapUsed (V8 heap)
  }
}
⚠️ Замеченные проблемы

🟡 Средние

Всегда возвращает HTTP 200 и status: 'ok' — даже если MongoDB отключена. mongo: 'disconnected' приходит в теле ответа, но HTTP статус остаётся 200. Балансировщики и healthcheck системы (k8s liveness/readiness probe) интерпретируют 200 как "сервис здоров" и продолжают направлять трафик на нерабочий инстанс.

Нет проверки Redis/Bull — очередь генераций критически важна, но её состояние не проверяется.

🟢 Минорные

Нет проверки внешних зависимостей — состояние AI-провайдеров, S3/storage не отражены.

memory.rss и memory.heap — строки с единицами — '150 MB' неудобно парсить мониторингу. Лучше возвращать числа в байтах или MB как number.

Весь код продублирован в сообщении — controller и module присутствуют дважды.


