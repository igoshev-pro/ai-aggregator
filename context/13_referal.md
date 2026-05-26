📦 Контекст: Backend (NestJS) — Блок 10: Referral Module

🗂️ Структура модуля


src/modules/referral/
├── referral.module.ts
├── referral.controller.ts
├── referral.service.ts
└── schemas/
    ├── referral.schema.ts
    └── withdrawal.schema.ts
🔗 Зависимости модуля

Typescript

ReferralModule imports:
  MongooseModule: [Referral, Withdrawal]
  forwardRef → UsersModule

exports:
  ReferralService

// Вызывается извне:
//   BillingService → markReferralPurchase()
//   UsersService   → recordReferral() (при регистрации)
📡 API Эндпоинты (публичные — для пользователя)


GET  /referral/stats        легаси статистика             [JWT]
GET  /referral/info         полный блок для ReferralPage  [JWT]
POST /referral/withdraw     создать заявку на вывод       [JWT]
GET  /referral/withdrawals  история заявок пользователя   [JWT]
Админ-методы (только в сервисе, нет в контроллере)

Typescript

adminApproveWithdrawal(withdrawalId, adminId, adminNote?)
adminMarkPaid(withdrawalId, adminId, adminNote?)
adminRejectWithdrawal(withdrawalId, adminId, adminNote?)
adminGetAllWithdrawals(status?, page?, limit?)
adminGetWithdrawalSummary()
adminGetTopReferrers(limit?)
// ⚠️ Все admin-методы существуют в сервисе, но нет AdminController
//    и нет проверки роли adminId. Вызов возможен только через другой
//    контроллер который передаст нужный adminId.
🗄️ Схемы

Referral

Typescript

{
  referrerId: ObjectId   // ref: User, required, indexed
  referredId: ObjectId   // ref: User, required
  bonusEarned: number    // default: 0, накапливается через $inc
  hasPurchased: boolean  // default: false
  firstPurchaseAt?: Date

  Индексы:
    { referrerId: 1 }          // одиночный (явный)
    { referredId: 1 } UNIQUE   // один пользователь — один реферрер
    ⚠️ Одиночный индекс { referrerId: 1 } создаётся дважды:
       @Prop({ index: true }) + ReferralSchema.index({ referrerId: 1 })
}
Withdrawal

Typescript

{
  userId: ObjectId        // ref: User, required, indexed
  amount: number          // required, min: 100 (в спичках)
  amountRub: number       // required, min: 100 (=amount, 1 спичка = 1₽)
  processedBy?: ObjectId  // ref: User (admin)
  method: WithdrawalMethod  // CARD | SBP | CRYPTO
  requisites: string      // required, хранится в открытом виде
  status: WithdrawalStatus  // PENDING | APPROVED | REJECTED | PAID
  adminNote: string       // default: ''
  processedAt?: Date
  createdAt, updatedAt    // timestamps

  Индексы:
    { userId: 1, createdAt: -1 }
    { status: 1, createdAt: -1 }
    ⚠️ Одиночный @Prop({ index: true }) на userId избыточен —
       покрывается составным { userId: 1, createdAt: -1 }
}
💸 Флоу создания заявки на вывод


1. Валидация amount (isFinite, min/max)
2. Валидация method (enum check — дублирует DTO валидацию)
3. Валидация requisites (length + validateRequisitesByMethod)
4. Проверка активных заявок: findOne({ userId, status: PENDING|APPROVED })
   ⚠️ Race condition: два одновременных запроса оба пройдут проверку
      Нет атомарной защиты (нет unique индекса на активную заявку)

5. reserveCashbackForWithdrawal(userId, amount)
   ← атомарный $inc в UsersService (уменьшает cashbackBalance)

6. withdrawal.save()
   При ошибке → refundCashback(userId, amount) [компенсация]
   При ошибке refundCashback → CRITICAL лог, ручная обработка

7. return { id, amount, amountRub, method, status, createdAt }
   ⚠️ requisites НЕ возвращаются в ответе (правильно)
🔄 Флоу отклонения заявки (adminRejectWithdrawal)


1. findById(withdrawalId)
2. Проверка статуса: только PENDING или APPROVED
3. w.status = REJECTED → w.save()  ← сначала меняем статус (защита от двойного возврата)
4. refundCashback(userId, amount)
   При ошибке → CRITICAL лог + adminNote += '⚠️ REFUND FAILED'

// Порядок правильный: статус меняется ДО возврата денег
// Если refund упал — деньги не вернулись, но статус REJECTED
// adminNote помечается для ручной обработки
🤖 resolveBotUsername()

Typescript

// Приоритет:
// 1. env: TG_BOT_USERNAME || TELEGRAM_BOT_USERNAME || BOT_USERNAME
// 2. Telegram API: GET https://api.telegram.org/bot{TOKEN}/getMe
//    timeout: 5000ms (AbortController)
//    token из: TG_BOT_TOKEN || TELEGRAM_BOT_TOKEN || BOT_TOKEN
// 3. Fallback: 'UNKNOWN_BOT'

// Кэш: in-memory, TTL 1 час
// invalidateBotUsernameCache() — публичный метод для сброса кэша

// ⚠️ При масштабировании (несколько инстансов) — кэш не шарится,
//    каждый инстанс делает свой запрос к Telegram API при старте
// ⚠️ Вызывается при каждом getReferralStats() и getReferralInfo()
//    Первый вызов после TTL делает HTTP-запрос к Telegram API в контексте
//    пользовательского запроса → добавляет latency до 5 секунд
📊 getReferralInfo() — ответ

Typescript

{
  referralCode: string
  referralLink: string       // https://t.me/{botUsername}?start=ref_{code}
  botUsername: string

  referralCount: number      // из user.referralCount (денормализовано)
  activeReferrals: number    // computed: referrals.filter(hasPurchased).length
  totalEarned: number        // из user.referralEarnings (денормализовано)

  cashbackBalance: number    // из user.cashbackBalance
  cashbackEarnedTotal: number // из user.cashbackEarnedTotal
  pendingWithdrawal: number  // aggregate по PENDING+APPROVED выводам
  availableForWithdrawal: number  // алиас cashbackBalance

  minWithdrawal: 100
  maxWithdrawal: 100000

  referrals: [{              // limit: 50
    id, firstName, username, photoUrl, joinedAt, earned, hasPurchased
  }]
}

// ⚠️ activeReferrals считается из первых 50 записей (limit: 50)
//    При >50 рефералах activeReferrals будет занижен
// ⚠️ availableForWithdrawal = cashbackBalance, но
//    cashbackBalance уже уменьшен при reserveCashbackForWithdrawal.
//    pendingWithdrawal показывается отдельно — фронт должен сам считать
//    "реальный" баланс. Это может запутать пользователя.
🔒 validateRequisitesByMethod()

Typescript

// CARD:
//   digitsOnly = req.replace(/\s|-/g, '')
//   /^\d{16,19}$/.test(digitsOnly)
//   ⚠️ Удаляет только пробелы и дефисы.
//      Если пользователь введёт '4111 1111 1111 1111 extra' →
//      digitsOnly = '4111111111111111extra' → тест провалится (не только цифры)
//      Это корректное поведение, но сообщение об ошибке не объясняет почему

// SBP:
//   /^(\+?7|8)\d{10}$/.test(digitsOnly)
//   ⚠️ После replace(/\s|-/g) строка '+7 999 123-45-67' → '+79991234567'
//      Паттерн: (+?7|8)\d{10} — ожидает ровно 11 символов
//      '+79991234567' → 12 символов → тест провалится
//      Нужно: /^(\+?7|8)\d{10}$/.test(req.replace(/[\s\-\(\)]/g, ''))
//      И проверять длину после очистки

// CRYPTO:
//   Только проверка req.length < 4 (дублирует общую проверку выше)
//   Нет валидации формата адреса
🏦 Маскировка реквизитов (maskRequisites)

Typescript

// CARD:   '**** **** **** 1234'  — последние 4 цифры
// SBP:    '*** *** 5678'         — последние 4 цифры
// CRYPTO: '...abcd'              — последние 4 символа
// ⚠️ Для CARD маска не учитывает что номер мог быть изначально
//    введён с пробелами (хранится в БД как '4111 1111 1111 1234')
//    → last = '1234' (правильно), но маска показывает '**** **** **** 1234'
//    что выглядит корректно
// ⚠️ Для CRYPTO адреса длиной <= 4 символов — возвращается сам адрес
⚠️ Замеченные проблемы

🔴 Критичные

Race condition в createWithdrawal — findOne({ status: PENDING|APPROVED }) → reserveCashbackForWithdrawal → save() не атомарны. Два одновременных запроса оба пройдут проверку активных заявок, оба зарезервируют кэшбек, оба создадут Withdrawal. У пользователя будет двойное резервирование и две активные заявки. Нужен атомарный findOneAndUpdate с условием или unique sparse индекс на { userId, status: 'pending' }.

Админ-методы без защиты роли — adminApproveWithdrawal, adminRejectWithdrawal, adminMarkPaid, adminGetAllWithdrawals не вызываются из контроллера (нет AdminController в этом модуле). Если они вызываются из AdminModule — нужно убедиться что AdminModule проверяет роль. Если нет — любой может вызвать их через DI.

SBP валидация падает на корректных номерах — req.replace(/\s|-/g, '') для '+7 (999) 123-45-67' даст '+7(999)12345-67' (скобки не удаляются), и регекс /^(\+?7|8)\d{10}$/ вернёт false. Пользователь с правильным номером получит ошибку валидации.

🟡 Средние

activeReferrals считается только из первых 50 — getReferralInfo загружает .limit(50) рефералов, затем referrals.filter(hasPurchased).length. Пользователь с 200 рефералами получит неверный activeReferrals. Нужен отдельный countDocuments({ hasPurchased: true }).

resolveBotUsername добавляет latency к пользовательским запросам — первый вызов после истечения TTL делает HTTP-запрос к Telegram API (до 5 секунд таймаута) прямо в контексте getReferralStats() или getReferralInfo(). Нужен прогрев кэша при старте приложения или отдельный фоновый refresh.

Денормализация referralCount/referralEarnings — getReferralInfo возвращает referralCount из user.referralCount (денормализованное поле), но activeReferrals считает из реальных документов Referral. Два источника истины могут расходиться при ошибках записи.

Реквизиты хранятся в открытом виде — requisites (номер карты, телефон) в MongoDB без шифрования. При утечке БД — платёжные данные пользователей компрометируются.

REFERRAL_SIGNUP_BONUS записывается в bonusEarned сразу при регистрации — bonusEarned: REFERRAL_SIGNUP_BONUS устанавливается при recordReferral(), ещё до первой покупки. Это противоречит семантике поля (bonusEarned — сколько принёс реферал). При первой покупке $inc: { bonusEarned: rounded } прибавляется поверх уже существующих 10 спичек.

🟢 Минорные

Двойной индекс на referrerId — @Prop({ index: true }) и ReferralSchema.index({ referrerId: 1 }) создают два одинаковых индекса в MongoDB.

Валидация method в сервисе дублирует DTO — if (!Object.values(WithdrawalMethod).includes(method)) в createWithdrawal() повторяет @IsEnum(WithdrawalMethod) из DTO. При валидном DTO этот код никогда не выполнится.

adminMarkPaid разрешает PENDING → PAID минуя APPROVED — status !== APPROVED && status !== PENDING → можно пометить оплаченной заявку которую ещё не одобрили. Это может быть намеренным, но нарушает предполагаемый флоу PENDING → APPROVED → PAID.

CreateWithdrawalDto определён прямо в controller файле — DTO класс объявлен в referral.controller.ts вместо отдельного файла dto/create-withdrawal.dto.ts. Нарушает конвенцию проекта.