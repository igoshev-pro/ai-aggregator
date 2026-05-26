📦 Контекст: Backend (NestJS) — Блок 12: Support Module

🗂️ Структура модуля


src/modules/support/
├── support.module.ts
├── support.controller.ts
├── support.service.ts
└── schemas/
    └── ticket.schema.ts
🔗 Зависимости модуля

Typescript

SupportModule imports:
  MongooseModule: [Ticket]

exports:
  SupportService

// Нет зависимостей от других модулей приложения
// Нет UsersModule, нет NotificationsModule
// Нет Telegram-уведомлений при создании тикета
📡 API Эндпоинты

Пользовательские (JWT)


POST /support/tickets              создать тикет           [JWT]
GET  /support/tickets              список моих тикетов     [JWT]
POST /support/tickets/:id/message  добавить сообщение      [JWT]
Админские (только в сервисе, нет в контроллере)

Typescript

getAllTickets(status?, page?, limit?)   // populate userId
closeTicket(ticketId)
addMessage(userId, ticketId, content, role: 'support')
// ⚠️ Нет AdminController — все admin-методы недоступны через HTTP
// ⚠️ Нет RolesGuard — если AdminController появится, нужна проверка роли
🗄️ Схема Ticket

Typescript

{
  userId: ObjectId          // ref: User, required
  subject: string           // required
  messages: [{              // embedded array
    role: 'user' | 'support'
    content: string
    createdAt: Date         // default: Date.now
  }]
  status: string            // 'open'|'in_progress'|'resolved'|'closed', default: 'open'
  priority: string          // 'low'|'medium'|'high', default: 'medium'
  assignedTo: string        // ⚠️ string, не ObjectId — нет ref: 'User'
  resolvedAt?: Date
  createdAt, updatedAt      // timestamps

  Индексы:
    { userId: 1 }                    // из @Prop({ index: true }) — одиночный
    { userId: 1, status: 1 }         // составной (покрывает одиночный выше)
    { status: 1, priority: -1 }      // для сортировки в admin

  ⚠️ Одиночный индекс { userId: 1 } избыточен —
     покрывается составным { userId: 1, status: 1 }

  ⚠️ status и priority объявлены как string, не enum TypeScript.
     Mongoose enum валидирует на уровне БД, но TypeScript не защищает
     от передачи произвольной строки в сервисе
}
🔧 SupportService — методы

createTicket()

Typescript

async createTicket(userId: string, subject: string, message: string)

// Создаёт тикет с первым сообщением role: 'user'
// status: 'open' (default), priority: 'medium' (default)
// return: полный Mongoose document

// ⚠️ Нет валидации subject и message (длина, пустота)
// ⚠️ Нет ограничения на кол-во открытых тикетов от одного пользователя
// ⚠️ Нет уведомления администратору/поддержке о новом тикете
// ⚠️ Возвращает сырой Mongoose document с __v, _id, всеми полями
getUserTickets()

Typescript

async getUserTickets(userId: string, page = 1, limit = 10)

// find({ userId }) .sort({ createdAt: -1 }) .skip().limit()
// return: { tickets, pagination: { page, limit, total, pages } }

// ⚠️ page и limit из Query-параметров приходят как строки ('1', '10')
//    getUserTickets(userId, '2', '5') → skip = ('2'-1)*'5' = NaN
//    Нужно явное приведение: +page, +limit или @Type(() => Number) в DTO
// ⚠️ Нет верхнего ограничения limit — можно запросить limit=100000
// ⚠️ messages возвращаются целиком внутри каждого тикета —
//    при 1000 сообщений в тикете это большой payload для списка
addMessage()

Typescript

async addMessage(
  userId: string,
  ticketId: string,
  content: string,
  role: 'user' | 'support' = 'user'
)

// 1. findById(ticketId)
// 2. Если role === 'user': проверка ticket.userId === userId
// 3. ticket.messages.push({ role, content, createdAt })
// 4. Если role === 'support' && status === 'open': status = 'in_progress'
// 5. ticket.save()

// ⚠️ Если role === 'support': проверка userId НЕ выполняется
//    Любой аутентифицированный пользователь может вызвать addMessage
//    с role='support' (если контроллер позволит) и написать от имени саппорта

// ⚠️ Контроллер вызывает addMessage без параметра role (default: 'user')
//    Это безопасно для текущего контроллера, но метод публично принимает role
//    Если AdminController добавит эндпоинт — нужна проверка роли caller'а

// ⚠️ Нет проверки статуса тикета:
//    можно добавлять сообщения в 'closed' и 'resolved' тикеты

// ⚠️ Нет валидации content (пустая строка, длина, XSS)
// ⚠️ Нет ограничения на кол-во сообщений в тикете
//    messages — embedded array в MongoDB документе (16MB лимит документа)

// ⚠️ Нет уведомления о новом сообщении (ни email, ни Telegram)
closeTicket()

Typescript

async closeTicket(ticketId: string)

// findByIdAndUpdate → status: 'closed', resolvedAt: new Date()
// ⚠️ Нет проверки текущего статуса (можно "закрыть" уже закрытый)
// ⚠️ Нет проверки прав — кто вызывает (userId не передаётся)
// ⚠️ Нет различия между 'resolved' и 'closed' (оба устанавливают 'closed')
//    Схема поддерживает 4 статуса, но closeTicket всегда ставит 'closed'
getAllTickets() — admin

Typescript

async getAllTickets(status?: string, page = 1, limit = 20)

// .populate('userId', 'firstName username telegramId')
// .sort({ priority: -1, createdAt: -1 })

// ⚠️ sort({ priority: -1 }) — priority это строка ('low', 'medium', 'high')
//    Строковая сортировка: 'medium' > 'low' > 'high' (лексикографически)
//    'high' окажется ПОСЛЕДНИМ, а не первым — обратный порядок приоритетов

// ⚠️ status фильтр принимает произвольную строку без валидации
// ⚠️ Нет верхнего ограничения limit
⚠️ Замеченные проблемы

🔴 Критичные

Любой пользователь может писать от имени support — addMessage() принимает role как параметр. Контроллер сейчас передаёт только role: 'user' (дефолт), но если в будущем добавить эндпоинт POST /support/tickets/:id/message?role=support без проверки — любой аутентифицированный пользователь сможет писать с ролью support. Параметр role должен определяться сервером на основе роли JWT, а не приниматься извне.

Сортировка по priority как строка — sort({ priority: -1 }) сортирует лексикографически: 'medium' > 'low' > 'high'. Тикеты с приоритетом 'high' будут отображаться последними в админке, а не первыми. Нужно числовое поле (priorityOrder: { high: 3, medium: 2, low: 1 }) или сортировка через $addFields с $switch.

page/limit из Query приходят как строки — @Query('page') page = 1 в NestJS без @Type(() => Number) и ParseIntPipe возвращает строку '2'. getUserTickets(userId, '2', '10') → skip = ('2' - 1) * '10' → JavaScript выполнит приведение неявно (skip = 10), но это ненадёжно и limit передаётся в Mongoose как строка '10', что Mongoose принимает, но это не гарантировано.

🟡 Средние

Нет проверки статуса тикета при добавлении сообщений — addMessage() не проверяет ticket.status. Пользователь может писать в closed и resolved тикеты. Нужна проверка if (ticket.status === 'closed') throw new BadRequestException(...).

messages — неограниченный embedded array — все сообщения хранятся внутри документа Ticket. Документ MongoDB ограничен 16MB. При активной переписке (1000+ сообщений) документ раздувается, getUserTickets возвращает полный массив messages для каждого тикета в списке.

Нет уведомлений — при создании тикета (createTicket) и новом сообщении (addMessage) нет уведомлений: ни Telegram-боту администраторам, ни пользователю об ответе саппорта. Без уведомлений саппорт не узнает о новых тикетах.

Нет валидации входных данных — subject, message, content принимаются без проверки длины и наличия. Пустая строка content: '' создаст сообщение. Нет class-validator DTO для body запросов (используется body: { subject: string; message: string } без декораторов).

Нет ограничения на кол-во открытых тикетов — пользователь может создать неограниченное количество тикетов (createTicket без проверки существующих открытых).

AdminController отсутствует — getAllTickets, closeTicket существуют в сервисе но недоступны через HTTP. Саппорт не может работать с тикетами через API.

assignedTo: string вместо ObjectId — поле assignedTo объявлено как string без ref: 'User'. Нет возможности populate, нет foreign key constraint на уровне Mongoose.

🟢 Минорные

Двойной индекс на userId — @Prop({ index: true }) создаёт { userId: 1 }, который полностью покрывается составным { userId: 1, status: 1 }. Два индекса вместо одного — лишняя нагрузка на запись.

status и priority как string — не используется TypeScript enum, что позволяет передать ticket.status = 'whatever' без ошибки компиляции. Валидация только на уровне Mongoose schema enum.

Возвращается сырой Mongoose document — createTicket и addMessage возвращают полный document с __v, _id, внутренними полями. Нет маппинга в DTO для консистентного API-контракта.

resolvedAt устанавливается только при closeTicket — статус 'resolved' существует в enum, но нет метода resolveTicket(). Переход в 'resolved' невозможен через текущий API.