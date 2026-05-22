📖 ЧАСТЬ 1: Где сейчас смотреть и менять

🗂 Только одно место — MongoDB

Всё (UI-параметры + цены + capabilities) хранится в одном документе на модель в коллекции aimodels.

В коде фронта ничего хардкодить не нужно — фронт читает всё из API.

🔍 Шаг 1: Подключись к БД

Bash

ssh root@188.214.35.68

docker exec -it ai-mongo mongosh \
  -u admin -p 'superSecureMongoPass_Change_This_123' \
  --authenticationDatabase admin \
  ai-aggregator
🔍 Шаг 2: Полезные команды для просмотра

A) Список всех моделей с базовой информацией

Javascript

db.aimodels.find(
  {},
  { slug: 1, name: 1, type: 1, fixedCostPerGeneration: 1, isActive: 1, _id: 0 }
).sort({ type: 1, slug: 1 }).toArray()
B) Сгруппировать по типу (text/image/video/audio)

Javascript

db.aimodels.aggregate([
  { $group: { 
      _id: "$type", 
      count: { $sum: 1 }, 
      models: { $push: "$slug" } 
  }}
]).toArray()
C) Все видео-модели полностью

Javascript

db.aimodels.find({ type: "video" }).toArray()
D) Конкретная модель целиком

Javascript

db.aimodels.findOne({ slug: "sora-2-pro" })
E) Только UI и цены конкретной модели (компактно)

Javascript

db.aimodels.findOne(
  { slug: "sora-2-pro" },
  { 
    slug: 1, 
    fixedCostPerGeneration: 1,
    uiParameters: 1, 
    pricingMatrix: 1, 
    inputCapabilities: 1, 
    defaultParams: 1,
    _id: 0 
  }
)
F) Найти модели БЕЗ матрицы цен (кандидаты на наполнение)

Javascript

db.aimodels.find(
  { 
    type: "video",
    $or: [
      { pricingMatrix: { $exists: false }},
      { pricingMatrix: { $size: 0 }}
    ]
  },
  { slug: 1, fixedCostPerGeneration: 1, _id: 0 }
).toArray()
G) Найти модели БЕЗ UI-параметров

Javascript

db.aimodels.find(
  { 
    $or: [
      { uiParameters: { $exists: false }},
      { uiParameters: { $size: 0 }}
    ]
  },
  { slug: 1, type: 1, _id: 0 }
).toArray()

✏️ Шаг 3: Шаблоны для изменения

Шаблон 1: Изменить flat-цену

Javascript

db.aimodels.updateOne(
  { slug: "veo-3.1-fast" },
  { $set: { fixedCostPerGeneration: 35 }}
)
Шаблон 2: Полная замена UI-параметров и матрицы

Javascript

db.aimodels.updateOne(
  { slug: "MODEL_SLUG" },
  {
    $set: {
      fixedCostPerGeneration: 32,
      defaultParams: {
        aspectRatio: "16:9",
        duration: 8
      },
      uiParameters: [
        {
          key: "duration",
          label: "Длительность",
          type: "select",
          affectsPrice: true,
          defaultValue: 8,
          options: [
            { value: 4, label: "4 сек (16🔥)" },
            { value: 6, label: "6 сек (24🔥)" },
            { value: 8, label: "8 сек (32🔥)" }
          ]
        },
        {
          key: "aspectRatio",
          label: "Соотношение",
          type: "select",
          affectsPrice: false,
          defaultValue: "16:9",
          options: [
            { value: "16:9", label: "Горизонталь" },
            { value: "9:16", label: "Вертикаль" }
          ]
        }
      ],
      pricingMatrix: [
        { conditions: { duration: 4 }, costInTokens: 16, label: "4 секунды" },
        { conditions: { duration: 6 }, costInTokens: 24, label: "6 секунд" },
        { conditions: { duration: 8 }, costInTokens: 32, label: "8 секунд" },
        { costInTokens: 32, label: "Стандарт (catch-all)" }
      ]
    }
  }
)
Шаблон 3: Только обновить цену в правиле

Javascript

db.aimodels.updateOne(
  { slug: "sora-2-pro", "pricingMatrix.conditions.duration": 15 },
  { $set: { "pricingMatrix.$.costInTokens": 300 }}
)
Шаблон 4: Дописать новое правило

Javascript

db.aimodels.updateOne(
  { slug: "sora-2-pro" },
  { 
    $push: { 
      pricingMatrix: { 
        conditions: { duration: 20 }, 
        costInTokens: 400, 
        label: "20 секунд" 
      }
    }
  }
)
📋 Шаг 4: Полный аудит всего что есть

Один скрипт чтобы получить состояние всей БД:

Bash

docker exec -it ai-mongo mongosh \
  -u admin -p 'superSecureMongoPass_Change_This_123' \
  --authenticationDatabase admin \
  ai-aggregator \
  --quiet \
  --eval '
    JSON.stringify(
      db.aimodels.find({}, {
        slug: 1,
        name: 1,
        type: 1,
        provider: 1,
        isActive: 1,
        fixedCostPerGeneration: 1,
        uiParameters: 1,
        pricingMatrix: 1,
        inputCapabilities: 1,
        defaultParams: 1,
        _id: 0
      }).sort({type: 1, slug: 1}).toArray(),
      null, 2
    )
  ' > all-models.json

# Скачать на локалку
scp root@188.214.35.68:~/all-models.json ./
После этого у тебя на маке файл all-models.json со всеми моделями и их настройками. Можно открыть в VS Code и наглядно увидеть что где есть, а где пусто.

🗺 Шаг 5: Чек-лист по моделям

После аудита сделай таблицу:

Slug	Type	uiParameters	pricingMatrix	Цена	Статус
sora-2-pro	video	✅ duration, aspectRatio	✅ 3 правила	200/280	✅ Готово
sora-2	video	✅	✅	100/150	✅ Готово
veo-3.1-fast	video	❌ пусто	❌ пусто	32 flat	⚠️ Наполнить
veo-3.1-pro	video	❌ пусто	❌ пусто	65 flat	⚠️ Наполнить
kling-2.5-turbo-pro	video	✅	✅	...	✅ Готово
...					
И идёшь по строчке: «что плохо → пишу update».

🛠 ЧАСТЬ 2: Делаем админку

🎯 Концепция


┌────────────────────────────────────────────────────────────┐
│  Admin Panel (/admin/models)                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  [Список всех моделей]                               │  │
│  │  ├ Sora 2 Pro       [Edit] [Toggle Active]           │  │
│  │  ├ Sora 2           [Edit] [Toggle Active]           │  │
│  │  └ Veo 3.1 Fast     [Edit] [Toggle Active]           │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  [Редактор модели]                                   │  │
│  │  • Базовая инфа (name, slug, type, provider)         │  │
│  │  • UI Parameters (визуальный билдер)                 │  │
│  │  • Pricing Matrix (таблица правил)                   │  │
│  │  • Input Capabilities (чекбоксы)                     │  │
│  │  • [Preview как будет на фронте]                     │  │
│  │  • [Save] [Cancel]                                   │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
🏗 Архитектура

Бэкенд (NestJS) — добавить эндпоинты

Typescript

// src/admin/admin.controller.ts

@Controller('admin/models')
@UseGuards(AdminGuard)  // только role: admin
export class AdminModelsController {
  
  // GET /admin/models — список всех моделей
  @Get()
  async listAll() { ... }
  
  // GET /admin/models/:slug — одна модель целиком
  @Get(':slug')
  async getOne(@Param('slug') slug: string) { ... }
  
  // PATCH /admin/models/:slug — обновить
  @Patch(':slug')
  async update(@Param('slug') slug, @Body() dto: UpdateModelDto) { ... }
  
  // POST /admin/models — создать новую
  @Post()
  async create(@Body() dto: CreateModelDto) { ... }
  
  // DELETE /admin/models/:slug
  @Delete(':slug')
  async remove(@Param('slug') slug) { ... }
  
  // POST /admin/models/:slug/test-price — тестовый расчёт цены
  @Post(':slug/test-price')
  async testPrice(
    @Param('slug') slug, 
    @Body() params: Record<string, any>
  ) { ... }
}
Защита

Typescript

// src/auth/guards/admin.guard.ts
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx) {
    const user = ctx.switchToHttp().getRequest().user
    return user?.role === 'admin'
  }
}
В JWT уже есть role (видел в твоём токене "role":"user"). Нужно вручную в БД для своего пользователя поставить role: "admin":

Javascript

db.users.updateOne(
  { telegramId: 6737328081 },  // твой ID
  { $set: { role: "admin" }}
)
Фронтенд (Next.js) — страницы админки


src/app/admin/
├── layout.tsx              # Защита: только role=admin
├── page.tsx                # Дашборд: статистика
├── models/
│   ├── page.tsx            # Список моделей
│   ├── [slug]/page.tsx     # Редактор модели
│   └── new/page.tsx        # Создание новой
└── components/
    ├── ModelsList.tsx
    ├── ModelEditor.tsx
    ├── UIParametersBuilder.tsx   # Визуальный билдер параметров
    ├── PricingMatrixEditor.tsx   # Редактор матрицы цен
    └── PricePreview.tsx          # Тест расчёта в реальном времени
🎨 Скетч UI

Главный экран /admin/models


┌─────────────────────────────────────────────────────────────┐
│  📋 Все модели                            [+ Добавить]      │
│                                                             │
│  Фильтр: [Все] [Text] [Image] [Video] [Audio]               │
│  Поиск: [____________]                                      │
│                                                             │
│  ┌─────┬──────────────┬─────┬──────┬──────────────┬──────┐  │
│  │Type │Slug          │Цена │Mtx?  │UI?           │Active│  │
│  ├─────┼──────────────┼─────┼──────┼──────────────┼──────┤  │
│  │🎬   │sora-2-pro    │ 200 │✅ 3  │✅ 2 параметра│ ✅   │  │
│  │🎬   │sora-2        │ 100 │✅ 3  │✅ 2          │ ✅   │  │
│  │🎬   │veo-3.1-fast  │  32 │❌    │❌            │ ✅   │  │
│  │🎬   │veo-3.1-pro   │  65 │❌    │❌            │ ✅   │  │
│  │🎬   │kling-2.5-... │ 150 │✅ 4  │✅ 3          │ ✅   │  │
│  │🖼   │midjourney-v7 │   8 │❌    │✅ 4          │ ✅   │  │
│  │...                                                      │  │
│  └─────┴──────────────┴─────┴──────┴──────────────┴──────┘  │
└─────────────────────────────────────────────────────────────┘
Редактор /admin/models/sora-2-pro


┌─────────────────────────────────────────────────────────────┐
│  ← Назад    🎬 Sora 2 Pro (sora-2-pro)        [Save] [Test] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ▼ Базовая информация                                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Slug:      sora-2-pro            (readonly)          │   │
│  │ Name:      [Sora 2 Pro                            ]  │   │
│  │ Type:      [video ▾]   Provider: [OpenAI ▾]          │   │
│  │ Premium:   ☑   Active: ☑                              │   │
│  │ Базовая цена: [200] 🔥 (fallback)                     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ▼ UI Параметры                          [+ Добавить]       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  🎚 duration (select, влияет на цену)                │   │
│  │     Опции:                                           │   │
│  │     • [5  ] [5 сек (200🔥)         ] [×]              │   │
│  │     • [10 ] [10 сек (200🔥)        ] [×]              │   │
│  │     • [15 ] [15 сек (280🔥)        ] [×]              │   │
│  │     [+ опция]               Default: [5 ▾]    [Edit] │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │  📐 aspectRatio (select, не влияет на цену)          │   │
│  │     • 16:9 → Горизонталь                             │   │
│  │     • 9:16 → Вертикаль                               │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ▼ Матрица цен                          [+ Правило]         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ #  │ Условия           │ Цена 🔥 │ $    │ Label    │ │   │
│  │ 1  │ duration=15       │ [280]   │ 2.8  │15 секунд │ │   │
│  │ 2  │ duration=10       │ [200]   │ 2.0  │10 секунд │ │   │
│  │ 3  │ (catch-all)       │ [200]   │ 2.0  │Стандарт  │ │   │
│  │      [+ условие]                                   │ │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ▼ Capabilities                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ☑ Принимает изображения  Max: [1]                    │   │
│  │ ☐ Принимает видео                                     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ▼ 🧪 Тест цены                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ duration:    [15 ▾]                                  │   │
│  │ aspectRatio: [16:9 ▾]                                │   │
│  │ ────────────────────                                 │   │
│  │ Расчёт: 280 🔥 (правило: "15 секунд")                 │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
🚀 План внедрения админки (по этапам)

MVP (за 1-2 дня) — самое нужное

Бэкенд:

 AdminGuard (проверка role=admin)
 GET /admin/models — список
 GET /admin/models/:slug — одна
 PATCH /admin/models/:slug — обновить (any field)
Фронт:

 /admin/models — таблица всех моделей
 /admin/models/:slug — JSON-редактор (просто textarea с валидацией)
 Кнопка «Test Price» (вызывает существующий /calculate-price)
➡️ Уже на этом этапе ты сможешь редактировать всё через UI без mongosh.

v2 (ещё 2-3 дня) — UX-улучшения

 Визуальный билдер uiParameters (формы вместо JSON)
 Таблица для pricingMatrix (строки = правила)
 Live-preview цены при изменении параметров
 Создание новых моделей через wizard
v3 — расширения

 История изменений (audit log)
 Версионирование (откат изменений)
 Импорт/экспорт моделей JSON
 Клонирование модели
 Bulk operations (например «увеличить все цены на 10%»)
 A/B тесты цен
 Статистика использования каждой модели
💡 Альтернативы пока админки нет

Вариант A: NoSQL Booster / Studio 3T (GUI для MongoDB)

Платно, но удобно. Подключаешься по SSH-туннелю и редактируешь как Excel.

Bash

# SSH tunnel
ssh -L 27017:localhost:27017 root@188.214.35.68

# В Studio 3T подключаешься к localhost:27017
Вариант B: Mongo Compass (бесплатно)

То же самое, но от MongoDB Inc. Открываешь коллекцию, кликаешь по документу → редактируешь JSON.

Вариант C: VS Code + MongoDB extension

Бесплатное расширение MongoDB for VS Code. Подключаешься, редактируешь прямо в IDE.

Вариант D: JSON-файлы в репо + migration scripts


backend/src/seeds/models/
├── sora-2-pro.json
├── sora-2.json
├── veo-3.1-fast.json
└── ...
И один скрипт npm run seed:models который синхронизирует JSON → MongoDB. Плюс: модели под Git-контролем. Минус: нужен deploy при каждом изменении.

🎯 Моя рекомендация: пошаговый план

🥇 Сейчас (этот вечер):

Скачай MongoDB Compass (бесплатно, 5 минут)
Создай SSH-туннель к серверу
Подключись через Compass
Пройдись по моделям, проставь нужные данные через GUI
➡️ Это даст тебе полный контроль уже сегодня без написания кода.

🥈 Через неделю (когда поймёшь паттерн):

Сделай MVP админки (просто список + JSON-редактор)
Это ~200 строк кода на бэке + 300 на фронте
Я могу выдать готовый код
🥉 Через месяц:

Визуальные билдеры
История изменений
Аналитика
💬 Что хочешь сделать?

Выбери что нужно прямо сейчас:

1️⃣ «Дай скрипт для аудита всей БД»

→ Выдам команду, ты увидишь все модели в JSON-файле и поймёшь что где сломано.

2️⃣ «Покажи как подключиться через MongoDB Compass»

→ Пошаговая инструкция с SSH-туннелем, скриншотами, подключением.

3️⃣ «Давай делать админку MVP»

→ Выдам:

Бэк: admin.controller.ts + admin.service.ts + guard
Фронт: страницы /admin/models и /admin/models/[slug]
Готовая JSON-форма с валидацией
Test-price preview
4️⃣ «Сначала наполни Veo и другие пустые модели»

→ Выдам готовые mongosh-скрипты для всех проблемных моделей одним блоком.

5️⃣ «Сделай JSON-файлы в репо + миграции»

→ Выдам структуру + скрипт-сидер для бэка.

