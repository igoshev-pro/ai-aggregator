📦 Контекст: Backend (NestJS) — Блок 13: TelegramBot Module

🗂️ Структура модуля


src/modules/telegram-bot/
├── telegram-bot.module.ts
└── telegram-bot.update.ts
🔗 Зависимости модуля

Typescript

TelegramBotModule imports:
  TelegrafModule.forRootAsync    // глобальный Telegraf инстанс
  forwardRef → UsersModule
  forwardRef → ReferralModule

TelegramBotUpdate injects:
  ConfigService
  UsersService
  ReferralService
📡 Telegram команды


/start    регистрация / приветствие + реферальный флоу
/help     справка по командам
/balance  баланс токенов пользователя
/ref      реферальная ссылка и статистика
🔄 Флоу /start


1. ctx.from — получаем данные пользователя из Telegram
2. ctx.message?.text → payload = всё после '/start'
   ⚠️ @ts-ignore на доступ к message.text

3. Парсинг реферального кода:
   payload.startsWith('ref_') → referralCode = payload.replace('ref_', '').toUpperCase()

4. findByTelegramId(from.id) → определяем wasNew
   ⚠️ Два отдельных запроса к БД:
      - findByTelegramId (проверка существования)
      - findOrCreateByTelegram (создание/обновление)
   Race condition: между проверкой и созданием
   другой запрос может создать пользователя → wasNew будет неверным

5. findOrCreateByTelegram(tgUser, referralCode)
   UsersService:
     - привязывает referredBy
     - начисляет инвайтеру +10 bonusTokens

6. if (wasNew && referralCode && user.referredBy):
   recordReferral(user.referredBy, user._id)
   ⚠️ recordReferral идемпотентен (unique индекс на referredId) —
      дубликат не создастся, но лишний запрос к БД при гонке

7. Формирование приветствия + reply с кнопками
🔑 Конфигурация

Typescript

// TELEGRAM_BOT_TOKEN:
// Читается двумя способами — избыточность
config.get<string>('TELEGRAM_BOT_TOKEN') || process.env.TELEGRAM_BOT_TOKEN
// ConfigService.get() уже читает process.env, второй вариант лишний

// MINI_APP_URL — 4 источника:
this.config.get('MINI_APP_URL') ||
this.config.get('FRONTEND_URL') ||
process.env.MINI_APP_URL ||
process.env.FRONTEND_URL ||
''
// Аналогично — ConfigService покрывает process.env,
// последние два варианта избыточны
💬 Команды — детали

/balance

Typescript

// findByTelegramId(from.id) → ctx.reply с балансами
// tokenBalance, bonusTokens, cashbackBalance

// При любой ошибке catch → 'Сначала нажми /start'
// ⚠️ Перехватывает ВСЕ ошибки включая сетевые/БД
//    Пользователь видит одно сообщение для любой проблемы
// ⚠️ Нет логирования ошибок в catch блоке
/ref

Typescript

// findByTelegramId → getReferralInfo(user._id)
// getReferralInfo вызывает resolveBotUsername():
//   ⚠️ При первом вызове после TTL (1 час) — HTTP-запрос к Telegram API
//      В контексте обработки команды → latency до 5 секунд

// При любой ошибке → 'Сначала нажми /start'
// ⚠️ Аналогично /balance — нет логирования ошибок
/help

Typescript

// Статический текст, нет обращений к БД
// Список команд совпадает с реально зарегистрированными: /start, /balance, /ref, /help
🎁 Приветственное сообщение (wasNew = true)

Typescript

`🎁 Тебе начислено *9 спичек* на старт${
  referralCode && user.referredBy ? ' + бонус за приглашение' : ''
}!`

// ⚠️ Хардкод числа '9' — не берётся из константы или конфига
//    При изменении стартового бонуса в UsersService нужно менять
//    и это сообщение вручную. Сейчас стартовый бонус в UsersService = ?
//    (зависит от блока 3 — Users Module)

// ⚠️ Условие referralCode && user.referredBy:
//    referralCode — код из /start payload
//    user.referredBy — поле в документе пользователя
//    Если findOrCreateByTelegram не привязал реферера (невалидный код,
//    код не найден в БД) → referralCode есть, но user.referredBy пуст
//    → сообщение без бонуса (корректно)
//    Но если пользователь существовал (wasNew=false), это ветка
//    не выполняется — тоже корректно
🔘 Кнопки

Typescript

// Кнопка Mini App — только если miniAppUrl не пустой
if (miniAppUrl) {
  buttons.push([Markup.button.webApp('🚀 Открыть SPICHKI AI', miniAppUrl)])
}
// Кнопка поддержки — всегда
buttons.push([Markup.button.url('💬 Поддержка', 'https://t.me/spichki_support')])

// ⚠️ 'https://t.me/spichki_support' — хардкод ссылки поддержки
//    Не из конфига, изменение требует деплоя
// ⚠️ Если MINI_APP_URL не задан — пользователь видит только кнопку
//    поддержки, без возможности открыть Mini App
⚠️ Замеченные проблемы

🔴 Критичные

Race condition при определении wasNew — findByTelegramId + findOrCreateByTelegram — два последовательных запроса. Между ними другой инстанс (или повторный /start) может создать пользователя. wasNew будет true у первого вызова, но findOrCreateByTelegram вернёт существующего пользователя. Результат: recordReferral вызывается, но реферал уже был записан в findOrCreateByTelegram. Это безопасно (идемпотентность recordReferral), но wasNew=true → пользователь получит приветствие "новичка" и сообщение о начислении бонусов повторно. Нужно использовать { upsert: true } с возвратом upserted флага вместо двух запросов.

Хардкод '9 спичек' в приветствии — стартовый бонус зашит строкой '*9 спичек*'. Если в UsersService (findOrCreateByTelegram) величина стартового бонуса изменится — сообщение бота останется неверным, пользователи будут видеть устаревшую цифру.

🟡 Средние

@ts-ignore на доступ к ctx.message?.text — обход типизации Telegraf вместо корректной проверки типа контекста. В Telegraf v4 ctx.message имеет union тип. Правильное решение — типизированный NarrowedContext или явная проверка 'text' in ctx.message.

catch {} без логирования в /balance и /ref — ошибки БД или сети молча проглатываются, пользователь видит 'Сначала нажми /start' даже если он уже зарегистрирован. В логах нет следа проблемы. Нужен минимум this.logger.error() в catch.

resolveBotUsername() в /ref добавляет latency — первый вызов /ref после истечения TTL кэша (1 час) делает HTTP-запрос к Telegram API (getMe) с таймаутом 5 секунд прямо в контексте обработки команды. Пользователь ждёт до 5 секунд ответа на /ref (проблема описана в блоке 10).

ConfigService vs process.env — дублирование — в трёх местах читается одна переменная двумя способами: config.get('X') || process.env.X. ConfigService.get() уже читает process.env. Второй вариант избыточен и создаёт путаницу.

forwardRef для обоих модулей — forwardRef(() => UsersModule) и forwardRef(() => ReferralModule) используются для разрыва циклических зависимостей. Если цикла нет (TelegramBotModule не экспортируется в UsersModule или ReferralModule) — forwardRef не нужен и скрывает реальную структуру зависимостей.

🟢 Минорные

Хардкод ссылки поддержки — 'https://t.me/spichki_support' зашит в коде. При смене канала поддержки — нужен деплой. Должно быть в ConfigService (SUPPORT_URL).

buttons: any[] — потеря типизации кнопок Telegraf. Telegraf имеет типы InlineKeyboardButton — нужно использовать их.

(from as any).is_premium — поле is_premium не входит в официальные типы Telegraf (добавлено Telegram позже). Приведение через as any работает, но лучше расширить тип через interface или использовать опциональный ? с проверкой.