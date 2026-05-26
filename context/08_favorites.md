📦 Контекст: Backend (NestJS) — Блок 7: Favorites Module

🗂️ Структура модуля


src/modules/favorites/
├── favorites.module.ts
├── favorites.controller.ts
├── favorites.service.ts
└── schemas/
    └── favorite.schema.ts
🔗 Зависимости модуля

Typescript

FavoritesModule imports:
  MongooseModule: [Favorite]

exports:
  FavoritesService
// Простой автономный модуль — нет forwardRef, нет внешних зависимостей
📡 API Эндпоинты


POST /favorites/toggle   добавить/убрать из избранного   [JWT]
GET  /favorites          список избранного               [JWT]
🗄️ Схема: Favorite

Typescript

{
  userId: ObjectId      // ref: User, required, indexed
  type: string          // 'generation' | 'conversation' | 'model' (не enum — свободная строка)
  itemId: string        // ID элемента (строка, не ObjectId — может быть любым)
  title?: string
  previewUrl?: string
  metadata: {}          // произвольные данные, default: {}
  createdAt, updatedAt  // timestamps
}

Индекс:
  { userId: 1, type: 1, itemId: 1 }  UNIQUE
  // Гарантирует что один пользователь не добавит один элемент дважды
  // Одиночный индекс { userId: 1 } тоже есть (@Prop index: true) —
  // он избыточен, т.к. составной UNIQUE уже покрывает userId
🔧 FavoritesService

toggleFavorite()

Typescript

toggleFavorite(userId, type, itemId, metadata?)

// Алгоритм:
// 1. findOne({ userId, type, itemId })
// 2. Если найдено → findByIdAndDelete → return { isFavorite: false }
// 3. Если нет → создать новый документ → return { isFavorite: true }

// metadata записывается дважды:
//   title: metadata?.title        ← отдельное поле схемы
//   previewUrl: metadata?.previewUrl ← отдельное поле схемы
//   metadata: metadata            ← весь объект целиком (включая title, previewUrl)
// Итого title и previewUrl хранятся в двух местах документа
getFavorites()

Typescript

getFavorites(userId, type?, page = 1, limit = 20)

// filter = { userId }
// если type передан → filter.type = type
// sort: createdAt DESC
// Возвращает: { favorites, pagination: { page, limit, total, pages } }
isFavorite()

Typescript

isFavorite(userId, type, itemId): Promise<boolean>
// countDocuments({ userId, type, itemId }) > 0
// Используется внешними модулями (GenerationModule и т.д.)
// ⚠️ Не используется внутри самого модуля
📥 Контроллер

POST /favorites/toggle

Typescript

// body: { type: string, itemId: string, title?: string, previewUrl?: string }
// Передаёт body целиком как metadata — включая сами поля type и itemId
// Итого metadata = { type, itemId, title?, previewUrl? }
// ⚠️ type и itemId попадают и в metadata, хотя они уже отдельные поля
GET /favorites

Typescript

// Query: type?, page?, limit?
// page и limit приходят как string из Query → передаются в сервис как string
// Сервис использует их в арифметике (page - 1) * limit
// JS неявное приведение string → number работает, но:
// ⚠️ '0abc' * 1 = NaN → skip = NaN → MongoDB вернёт все документы
⚠️ Замеченные проблемы

🟡 Средние

Race condition в toggleFavorite — findOne → delete/create не атомарно. При двух одновременных запросах оба могут найти existing = null, оба попытаются создать — один упадёт с duplicate key E11000 (UNIQUE индекс спасёт данные, но вернёт 500 вместо корректного ответа). Нужен findOneAndDelete или upsert паттерн.

type — свободная строка без валидации — любая строка принимается как тип. 'GENERATION', 'gen', 'генерация' создадут разные записи для одного элемента. Нужен enum или whitelist.

metadata дублирует поля — { type, itemId, title, previewUrl } попадают в metadata полностью плюс отдельно в title/previewUrl. При запросе GET /favorites клиент получает данные в двух местах.

page/limit без преобразования типов — @Query('page') page = 1 даёт string из HTTP запроса. parseInt или +page не вызываются. (page - 1) * limit в сервисе работает через неявное приведение, но 'abc' → NaN → skip = NaN.

🟢 Минорные

itemId как string, не ObjectId — принимает любую строку. Нет проверки что itemId реально существует в соответствующей коллекции. Можно добавить в избранное несуществующую генерацию.

Дублирующийся одиночный индекс — @Prop({ index: true }) на userId создаёт индекс { userId: 1 }, который полностью покрывается составным { userId: 1, type: 1, itemId: 1 }. Двойной overhead на запись.

Нет DELETE эндпоинта — только toggle. Невозможно явно удалить избранное зная что оно уже добавлено, без риска случайно его добавить снова (при race condition).

NotFoundException импортируется но не используется — import { Injectable, NotFoundException } в сервисе. NotFoundException нигде не бросается.

Нет лимита на количество избранных — пользователь может добавить неограниченное количество записей. При большой нагрузке — рост коллекции без контроля.

Код продублирован в сообщении — весь модуль (схема, контроллер, модуль, сервис) присутствует в сообщении дважды. В реальном коде один экземпляр каждого файла.