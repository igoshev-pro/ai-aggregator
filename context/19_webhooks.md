📦 Контекст: Backend (NestJS) — Блок 16: Webhooks Module

🗂️ Структура модуля


src/modules/webhooks/
├── webhooks.module.ts
└── webhooks.controller.ts
🔗 Зависимости модуля

Typescript

WebhooksModule imports:  (пусто)
WebhooksModule exports:  (пусто)

WebhooksController injects:
  Logger (NestJS built-in)

// Нет зависимостей от других модулей
// Нет Guards, нет Auth
// Нет сервисного слоя
📡 API Эндпоинты


POST /webhooks/kie-callback    принять webhook от KIE AI    [без auth]
🔄 Логика POST /webhooks/kie-callback

Typescript

async kieCallback(@Body() body: any)

// 1. Логирует первые 500 символов JSON тела
// 2. Возвращает { success: true }
// 3. Никакой бизнес-логики не выполняет

// Комментарий в коде:
// "Просто принимаем и логируем. Основная логика через polling."
// → KIE AI интеграция использует polling (активный опрос),
//   а не event-driven webhook подход
// → Этот эндпоинт — заглушка/placeholder
🔑 Контекст KIE AI (из других блоков)

Typescript

// KIE AI — сервис генерации изображений/видео (Блок 7: AiProvidersModule)
// Используется в: ImageGenerationService, VideoGenerationService
// Polling реализован в: AiProvidersService (kiePolling или аналог)

// Webhook URL регистрируется при создании задачи в KIE:
//   payload.webhook_url = `${process.env.APP_URL}/webhooks/kie-callback`
// Но поскольку логика через polling — webhook URL либо не передаётся,
// либо передаётся "на всякий случай"
⚠️ Замеченные проблемы

🔴 Критичные

Нет аутентификации и верификации подписи — эндпоинт открыт без какой-либо проверки. Любой может отправить POST /webhooks/kie-callback с произвольным телом. Если в будущем сюда добавить бизнес-логику (обработка результатов генерации, начисление/списание токенов) — это станет критической уязвимостью. Webhook-провайдеры (KIE, Stripe, GitHub и др.) предоставляют X-Signature или X-Webhook-Secret для верификации. Нужен WebhookGuard с проверкой HMAC-подписи или shared secret уже сейчас, пока эндпоинт — заглушка.

@Body() body: any без size limit — NestJS/Express по умолчанию ограничивает body размером 100kb (json body parser). Если глобально установлен больший лимит — злоумышленник может отправить большой payload, который будет полностью распакован и сериализован в JSON.stringify(body) перед логированием. Нужен явный limit через @Body() pipe или на уровне middleware для /webhooks/*.

🟡 Средние

Эндпоинт — заглушка без реальной логики — комментарий "Основная логика через polling" означает, что webhook зарегистрирован (или может быть зарегистрирован в KIE API), но результат его вызова игнорируется. Это архитектурная несогласованность: либо использовать webhook-driven подход (убрать polling, обрабатывать здесь), либо не регистрировать webhook URL в KIE вообще. Сейчас KIE дёргает эндпоинт вхолостую при каждом завершении задачи.

Логирование JSON.stringify(body).substring(0, 500) — логируется сырое тело запроса от внешнего сервиса. Тело может содержать sensitive данные (URL результата, ID пользователя, metadata). При утечке логов — утечка данных. Нужна sanitization перед логированием: логировать только безопасные поля (taskId, status, timestamp).

Нет обработки ошибок — контроллер не оборачивает логику в try/catch. Если JSON.stringify(body) бросит (циклические ссылки, Symbol-ключи) — NestJS вернёт 500. Для webhook-эндпоинта это критично: KIE пометит доставку как failed и начнёт retry. Нужен try/catch с гарантированным возвратом { success: true }.

Нет идемпотентности — KIE (и большинство webhook-провайдеров) гарантирует "at least once" доставку: один webhook может прийти несколько раз (network retry, timeout). Когда логика появится — нужна проверка на дубликат по taskId / eventId.

🟢 Минорные

Нет @ApiTags и Swagger документации — все остальные контроллеры проекта имеют @ApiTags, @ApiBearerAuth, @ApiOperation. Webhook-контроллер выпадает из документации API.

Модуль не экспортирует ничего — нормально для контроллер-модуля, но стоит зафиксировать явно.

