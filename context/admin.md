📋 Контекст задачи

Цель

Полноценная админка внутри Spichki AI для:

Управления моделями (главное) — UI-параметры, pricingMatrix, capabilities, цены
Пользователи — баланс, бан, роли
Промокоды — создание/деактивация
Аналитика — дашборд, ревеню, генерации
Провайдеры — toggle активности
Доступ

Только пользователи с Telegram ID из .env (ADMIN_TG_IDS=6737328081,123456789).

При логине бэк автоматически выставляет role: ADMIN таким юзерам. На фронте — кнопка «Админка» в профиле появляется только у них.

Технологии

Бэк: NestJS, MongoDB, JWT, уже есть AdminController + AdminService
Фронт: Next.js (app router), Zustand для state, кастомные хуки (useUser, useAuth), Telegram WebApp SDK, lucide-react иконки
Стили: BEM-классы (profile-page__header, fade-in fade-in--1) — кастомный CSS, не Tailwind
❓ Вопросы которые мне нужны для точного кода

🔧 Бэкенд

B1. Где хранится role у пользователя?

В коде вижу subscriptionPlan, isBanned, но не вижу как role попадает в JWT.

Покажи:

src/modules/users/schemas/user.schema.ts (целиком)
src/modules/auth/auth.service.ts (метод где создаётся JWT — login/validateUser)
src/common/guards/roles.guard.ts
src/common/decorators/roles.decorator.ts
src/common/interfaces/index.ts (где UserRole enum)
B2. Структура моделей в БД

Покажи: src/modules/ai-providers/schemas/aimodel.schema.ts (или как у тебя называется схема для коллекции aimodels).

Особенно интересует: есть ли уже поля uiParameters, pricingMatrix, inputCapabilities, defaultParams?

B3. Что умеет AiProvidersService.updateModel()?

Покажи: src/modules/ai-providers/ai-providers.service.ts — методы getAllModels, updateModel, getAllProviders, updateProvider.

Сейчас в контроллере updateModel принимает только {isActive, tokenCost, isPremium, sortOrder} — этого мало для редактирования матриц. Нужно расширить.

B4. Есть ли уже эндпоинт для генерации /calculate-price и /ui-config?

Чтобы переиспользовать его в админке для preview цены.

Покажи: src/modules/generation/generation.controller.ts (только методы ui-config и calculate-price).

B5. .env подход

Какой вариант выбираем для админов:

A: ADMIN_TG_IDS=6737328081,123456789 в .env → при логине бэк проверяет и проставляет role: 'admin' в БД (автомиграция)
B: Просто хардкод в .env, в БД ничего не меняем, а в RolesGuard дополнительная проверка по списку TG ID
Я бы выбрал A — чище, можно потом через UI «Super Admin» назначать новых админов.

🎨 Фронт

F1. Где переменные окружения?

Покажи:

.env.local (или .env) фронта — какие там переменные (NEXT_PUBLIC_API_URL и т.д.)
src/lib/api/index.ts (или где-то рядом — endpoints, apiClient)
F2. Стор аутентификации

Покажи: src/stores/authStore.ts (или useAuthStore).

Особенно: какие поля хранит, есть ли там user.role?

F3. Хук useUser

Покажи: src/hooks/useUser.ts целиком.

Где появляется role, telegramId юзера?

F4. Хуки useAuth, useModels, useBilling

Покажи:

src/hooks/useAuth.ts
src/hooks/useModels.ts
src/hooks/useBilling.ts
Нужно понять паттерн как делаются API-вызовы (axios? fetch? react-query?).

F5. Где CSS живёт?

Вижу классы profile-page__header, fade-in, profile-menu-item. Это:

A: Один большой globals.css со всем
B: Модули CSS per-component (ProfilePage.module.css)
C: Что-то типа SCSS partials в src/styles/
Если можешь — покажи структуру папки src/styles/ или фрагмент globals.css с .profile-page классами. Я буду использовать тот же паттерн чтобы админка выглядела единообразно.

F6. Где определяется DesktopSidebar и BottomNav?

В SpichkiApp вижу activeNav: 'feed' | 'models' | 'create' | 'chats' | 'favorites' | 'profile'.

Нужно понять — где добавлять иконку «Админка»:

В DesktopSidebar (десктоп левая панель)
В BottomNav (мобильная нижняя панель)
Или не добавлять туда вообще, а только в профиле кнопка «Перейти в админку» (для админов)?
Я бы выбрал последнее: доп. секция «Админ» в ProfilePage + отдельный роут /admin (без BottomNav, со своим layout).

🗂 План реализации (после ответов на вопросы)

Phase 1: Бэкенд (фундамент)


✅ Уже есть: AdminController, AdminService, RolesGuard, JwtAuthGuard
🆕 Добавить:
  ├─ .env: ADMIN_TG_IDS=6737328081
  ├─ AuthService.login() — автоматически set role=ADMIN если в списке
  ├─ AdminController:
  │   ├─ GET    /admin/models/:slug          ← одна модель целиком
  │   ├─ PATCH  /admin/models/:slug/full     ← обновить ВСЁ (uiParameters, pricingMatrix...)
  │   ├─ POST   /admin/models                ← создать новую
  │   ├─ DELETE /admin/models/:slug          ← удалить
  │   └─ POST   /admin/models/:slug/test-price ← тестовый расчёт
  └─ AdminService — соответствующие методы
Phase 2: Фронт (страницы)


src/components/admin/
  ├─ AdminPage.tsx              ← главная (роутер табов)
  ├─ AdminDashboard.tsx         ← статистика (использует /admin/dashboard)
  ├─ AdminModelsList.tsx        ← таблица всех моделей
  ├─ AdminModelEditor.tsx       ← редактор одной модели
  ├─ AdminUsersList.tsx         ← пользователи
  ├─ AdminPromoCodesPage.tsx    ← промокоды
  └─ components/
      ├─ UIParametersBuilder.tsx     ← билдер uiParameters
      ├─ PricingMatrixEditor.tsx     ← редактор pricingMatrix
      ├─ PricePreview.tsx            ← live-preview цены
      └─ JsonEditor.tsx              ← fallback для сложных случаев

src/hooks/
  └─ useAdmin.ts                ← все admin API-вызовы

src/stores/
  └─ adminStore.ts              ← (опционально) кэш админских данных
Phase 3: Интеграция


✅ Доступ:
  ├─ В useUser: добавить isAdmin (computed: user.role === 'admin')
  ├─ В ProfilePage: секция «🛡 Админ-панель» только для isAdmin
  └─ В SpichkiApp: новый page 'admin' с защитой
💡 Что я предлагаю как MVP (минимум полезного)

Цель MVP — за 1 итерацию получить рабочую админку именно для моделей (это твоя боль сейчас с Veo).


✅ MVP включает:
  1. .env-based admin check (бэк + фронт)
  2. Кнопка «Админка» в профиле (только для админов)
  3. Страница /admin → таблица всех моделей
  4. Клик на модель → редактор:
     • Базовые поля (slug, name, isActive, isPremium, fixedCostPerGeneration)
     • uiParameters (визуальный билдер: добавить/удалить/изменить)
     • pricingMatrix (таблица с conditions+price)
     • inputCapabilities (чекбоксы)
     • [Test Price] — preview расчёта
     • [Save] [Cancel]
  5. Готово — теперь можешь править Veo и любые другие модели через UI

⏸ Откладываем (Phase 2-3):
  • Дашборд
  • Пользователи
  • Промокоды
  • Аналитика
  • Создание новых моделей
🎯 Что мне нужно от тебя ПРЯМО СЕЙЧАС

Скинь по возможности всё что попросил, но критично нужно (без этого код будет в слепую):

🔴 Must-have (бэк):

user.schema.ts (целиком)
auth.service.ts (как генерируется JWT, метод login)
roles.guard.ts + roles.decorator.ts + enum UserRole
Схема модели: aimodel.schema.ts (главное!)
ai-providers.service.ts — методы getAllModels, updateModel
🔴 Must-have (фронт):

useAuthStore (содержимое стора)
useUser.ts (хук)
src/lib/api/index.ts (или где у тебя apiClient, ENDPOINTS)
Кусок globals.css с классами .profile-page, .profile-section (чтобы понять CSS-паттерн)
🟡 Nice-to-have:

useAuth.ts, useModels.ts
.env.example фронта и бэка
generation.controller.ts (методы ui-config и calculate-price)
DesktopSidebar.tsx, BottomNav.tsx (на случай если решим добавить иконку)
🤔 Ответы на 5 простых вопросов

Пока ты собираешь файлы — ответь на 5 быстрых вопросов чтобы я точнее спроектировал:

Подход к админам:

A) ADMIN_TG_IDS в .env + автоматическая выдача роли в БД при логине ✅ (рекомендую)
B) Только проверка TG ID в guard, БД не трогаем
C) Уже есть пользователи с role=ADMIN в БД, .env не нужен
MVP scope — делаем сразу только редактор моделей или полный пакет (модели + юзеры + промокоды + аналитика)?

A) Только модели (рекомендую — выпустим за раз) ✅
B) Всё сразу (несколько итераций)
UI редактора параметров:

A) Визуальный билдер (формы, кнопки +/-) — красиво но кода больше ✅
B) JSON-editor (textarea с валидацией) — быстро и грязно
C) Гибрид: визуальный + кнопка «Edit as JSON» для продвинутого ✅✅ (рекомендую)
Роут админки:

A) Внутри SpichkiApp как page 'admin' (без отдельного URL)
B) Отдельная страница /admin (Next.js app router, свой layout) ✅ (рекомендую — чище)
Где открывать вход в админку:

A) Только секция в ProfilePage (для админов) ✅ (рекомендую)
B) Также иконка в DesktopSidebar + BottomNav
C) Скрытая (например клик 5 раз на лого)
📨 Скидывай файлы + ответы — и я готовлю код полностью под твою архитектуру, без догадок и переделок 🚀

📋 ОБНОВЛЁННЫЙ КОНТЕКСТ

✅ Что я уже знаю

🔵 Бэкенд (что есть)

Компонент	Статус	Заметка
AdminController	✅ есть	Базовые эндпоинты для users/providers/models/promo/analytics
AdminService	✅ есть	Логика дашборда, пользователей, аналитики
RolesGuard	✅ есть	Проверяет user.role против @Roles() декоратора
JwtAuthGuard	✅ есть	Используется везде
User schema	✅ есть	Имеет role: UserRole, telegramId
AIModel schema	✅ отличная	slug, name, displayName, uiParameters, pricingMatrix, inputCapabilities, defaultParams, limits, capabilities, providerMappings, isActive, isPremium, sortOrder, fixedCostPerGeneration, supportsVision, type (text/image/video/audio)
AuthService.buildAuthResponse()	✅ есть	Кладёт role в JWT и в ответ юзеру
Generation endpoints	✅ есть	calculate-price, ui-config — переиспользуем в админке
🟢 Фронт (что есть)

Компонент	Статус	Заметка
useAuthStore	✅ есть (persist)	token, isReady
useUserStore	✅ есть	UserProfile уже с `role: 'user'
useUser() хук	✅ есть	refetch, refreshBalance
useAuth() хук	✅ есть	TG widget login
apiClient	✅ axios + JWT интерсептор	
ENDPOINTS	✅ есть	Нужно добавить admin-эндпоинты
ProfilePage	✅ есть	Туда добавим секцию «🛡 Админка» (для админов)
DesktopSidebar / BottomNav	✅ есть	Не трогаем
Стили (BEM, glass, fade-in)	✅ есть	Делаю в этом стиле
SpichkiApp	✅ есть	Главный роутер Page. Туда добавим 'admin'
app/layout.tsx	✅ есть	Один роут / → SpichkiApp
🎯 Решения по архитектуре (ты подтвердил)

✅ A — ADMIN_TG_IDS в .env + автоматическая выдача роли ADMIN в БД при логине
✅ Делаем всё сразу: модели + юзеры + промокоды + аналитика + адаптив (mobile + desktop + miniapp)
✅ Гибрид: визуальный редактор + кнопка «Edit as JSON» fallback
✅ Отдельная страница /admin (Next.js app router, свой layout)
✅ Кнопка «Админка» только в ProfilePage для админов
🔍 Замечание по архитектуре

Я заметил, что у тебя SpichkiApp рендерится прямо в HomePage (/) без app-router-страниц. То есть это SPA внутри Next.js.

Поэтому для админки есть 2 варианта:

Вариант X: Отдельная страница /admin (полноценный Next.js роут со своим layout)

✅ Чище, изолированно
✅ Свой URL — можно делиться ссылкой
❌ Дублирование некоторых вещей (TelegramProvider, auth)
Вариант Y: Внутри SpichkiApp как page: 'admin' (как сейчас сделаны profile/topup/etc)

✅ Использует существующую инфраструктуру (auth, sidebar)
✅ Меньше кода
✅ Гладко работает в Telegram Mini App
❌ Длинный URL не сделать
Моя рекомендация: Вариант Y — внутри SpichkiApp как новая Page. Это сильно проще, и для админки нам не нужен отдельный URL (есть кнопка в профиле). Telegram Mini App тоже не любит лишние роуты.

➡️ Если согласен — иду этим путём. Если хочешь именно /admin URL — скажи, переделаю.

🗺 ПОЛНЫЙ ПЛАН РЕАЛИЗАЦИИ

Phase 1: Бэкенд

1.1 Конфиг и автоматическая выдача роли


📁 src/modules/auth/admin-bootstrap.service.ts  🆕
  └─ Сервис который при логине:
     1) Парсит ADMIN_TG_IDS из .env
     2) Парсит SUPER_ADMIN_TG_IDS из .env
     3) Если у юзера telegramId в этих списках — повышает роль

📁 src/modules/auth/auth.service.ts  ✏️
  └─ В buildAuthResponse() / authenticateWithTelegram() вызывает 
     AdminBootstrapService.syncRole(user) перед сборкой JWT
1.2 Расширение AdminController/AdminService


📁 src/modules/admin/admin.controller.ts  ✏️
  Добавить:
  ├─ GET    /admin/models/:slug          ← одна модель целиком
  ├─ PATCH  /admin/models/:slug/full     ← полное обновление (uiParameters + pricingMatrix + всё)
  ├─ POST   /admin/models                ← создать новую модель
  ├─ DELETE /admin/models/:slug          ← удалить (или isActive=false?)
  ├─ POST   /admin/models/:slug/clone    ← клонировать
  └─ POST   /admin/models/:slug/test-price ← preview расчёта

📁 src/modules/admin/admin.service.ts  ✏️
  Добавить соответствующие методы
  
📁 src/modules/admin/dto/  🆕
  ├─ update-model-full.dto.ts
  └─ create-model.dto.ts
1.3 Доп. эндпоинты которых не хватает


📁 src/modules/admin/admin.controller.ts  ✏️
  ├─ GET /admin/transactions             ← последние транзакции
  ├─ GET /admin/generations              ← все генерации (список с фильтром)
  └─ GET /admin/users/:id                ← детали юзера
Phase 2: Фронт

2.1 Endpoints + админский API-хук


📁 src/lib/api/endpoints.ts  ✏️
  Добавить блок ADMIN_*

📁 src/hooks/useAdmin.ts  🆕
  ├─ useAdminDashboard()
  ├─ useAdminModels()
  ├─ useAdminModel(slug)
  ├─ useAdminUsers()
  ├─ useAdminPromoCodes()
  └─ useAdminAnalytics()
2.2 Компоненты админки


📁 src/components/admin/  🆕
  ├─ AdminPage.tsx              ← главный роутер с табами (Dashboard/Models/Users/Promo/Analytics)
  ├─ AdminDashboard.tsx         ← stat cards (users/revenue/generations)
  ├─ models/
  │   ├─ AdminModelsList.tsx    ← таблица всех моделей + фильтры
  │   ├─ AdminModelEditor.tsx   ← главный редактор модели
  │   ├─ UIParametersBuilder.tsx  ← билдер uiParameters[]
  │   ├─ PricingMatrixEditor.tsx  ← редактор pricingMatrix[]
  │   ├─ ModelBasicFields.tsx     ← name/slug/type/isActive/isPremium
  │   ├─ ModelLimitsEditor.tsx    ← limits + defaultParams + capabilities
  │   ├─ InputCapabilitiesEditor.tsx ← acceptsImages/maxInputImages
  │   ├─ PricePreview.tsx         ← live preview через /test-price
  │   └─ JsonEditor.tsx           ← fallback "edit raw JSON"
  ├─ users/
  │   ├─ AdminUsersList.tsx
  │   ├─ AdminUserDetail.tsx
  │   └─ AdjustBalanceModal.tsx
  ├─ promo/
  │   ├─ AdminPromoCodes.tsx
  │   └─ CreatePromoModal.tsx
  ├─ analytics/
  │   ├─ AdminAnalyticsPage.tsx
  │   ├─ RevenueChart.tsx        ← (recharts? или простой SVG?)
  │   └─ GenerationsChart.tsx
  └─ shared/
      ├─ AdminTabs.tsx           ← переключение разделов
      ├─ AdminTable.tsx          ← переиспользуемая таблица
      └─ AdminEmptyState.tsx
2.3 Интеграция в существующее приложение


📁 src/components/SpichkiApp.tsx  ✏️
  └─ Добавить page: 'admin' + navigateTo('admin') + защита isAdmin
  
📁 src/components/ProfilePage.tsx  ✏️
  └─ Секция "🛡 Админ-панель" видна только если user.role в ['admin', 'super_admin']

📁 src/stores/user.store.ts  ✏️
  └─ Selector isAdmin() для удобства

📁 src/app/globals.css  ✏️
  └─ Добавить стили .admin-* в едином BEM-стиле как остальное
❓ ЧТО ЕЩЁ НУЖНО ОТ ТЕБЯ

Чтобы код не имел "дыр" и компилировался с первой попытки, мне нужно 5 вещей:

🔴 1. Enum UserRole (критично)

В user.schema.ts ты используешь:

Typescript

@Prop({ type: String, enum: UserRole, default: UserRole.USER })
role: UserRole;
А я в AdminController вижу:

Typescript

@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
Покажи: содержимое src/common/interfaces/index.ts (или где определён UserRole enum). Точные значения важны ('admin' vs 'ADMIN'?).

Я сделаю как у тебя.

🔴 2. AiProvidersService.updateModel() — что он умеет

Сейчас в AdminService.updateModel() вызывается:

Typescript

async updateModel(slug: string, updates: any) {
  return this.aiProvidersService.updateModel(slug, updates);
}
Покажи: метод updateModel(slug, updates) в src/modules/ai-providers/ai-providers.service.ts.

Если он принимает только узкий набор полей — надо будет расширить или сделать обходной путь напрямую через Model<AIModel>.

🔴 3. JwtPayload interface

В AuthService.buildAuthResponse есть:

Typescript

const payload: JwtPayload = {
  sub: user._id.toString(),
  telegramId: user.telegramId || undefined,
  email: user.email || undefined,
  authProvider: user.authProvider || AuthProvider.TELEGRAM,
  role: user.role,
};
Покажи JwtPayload (скорее всего в src/common/interfaces/). Хочу убедиться что role там есть — иначе RolesGuard не сработает.

🟡 4. .env.example (или подскажи переменные)

Чтобы выдать тебе правильную инструкцию: какой формат у тебя в .env бэка?

Покажи .env.example или просто скажи названия твоих переменных (MONGODB_URI, JWT_SECRET, TELEGRAM_BOT_TOKEN...). Я добавлю в том же стиле:

Env

ADMIN_TG_IDS=6737328081,123456789
SUPER_ADMIN_TG_IDS=6737328081
🟡 5. admin.module.ts (модуль)

Покажи: src/modules/admin/admin.module.ts.

Нужно понять что у тебя там в imports/providers/exports чтобы правильно зарегистрировать новый AdminBootstrapService и расширения.

💡 Бонус: 3 уточняющих вопроса

Эти вопросы влияют на UX/UI админки. Просто скажи A/B/C:

Q1. Удаление моделей

A) Реальное удаление (DELETE из MongoDB) — опасно, нельзя откатить
B) Мягкое удаление (просто isActive = false) — безопаснее ✅ (рекомендую)
C) Обе кнопки: «Деактивировать» и «Удалить навсегда»
Q2. Управление providerMappings (какой провайдер обрабатывает запросы)

A) Редактировать в админке прямо в UI (это сложнее)
B) В админке только показывать, для редактирования — JSON режим ✅ (рекомендую)
C) Скрыть совсем в админке (только через mongosh)
Q3. Аналитика — графики

A) Полноценные графики на recharts (~50KB добавится) ✅ красиво но тяжело
B) Простые SVG-bar-charts своими руками — легче, без зависимостей ✅ (рекомендую)
C) Только цифры в карточках (без графиков пока)
📦 Что я выдам после ответов

Один большой PR-style ответ разбитый на части:


[1/6] Backend: ADMIN_TG_IDS + auto-role bootstrap
[2/6] Backend: расширенный AdminController + новые DTO
[3/6] Frontend: endpoints + хуки useAdmin
[4/6] Frontend: AdminPage + Dashboard + Sidebar/Tabs
[5/6] Frontend: AdminModelsList + AdminModelEditor (главное!)
[6/6] Frontend: Users + Promo + Analytics + CSS
Каждая часть будет:

✅ Готовый файл целиком (copy-paste и работает)
✅ С комментариями где что
✅ В твоём BEM-стиле + glass + fade-in
✅ Адаптив (mobile/desktop/miniapp) через те же media-queries
🎯 Резюме: что мне выслать

Минимум чтобы я начал писать код:

✅ Содержимое src/common/interfaces/index.ts (или хотя бы enum UserRole)
✅ Метод updateModel(slug, updates) из ai-providers.service.ts
✅ Названия переменных в .env бэка (или сам .env.example)
✅ Ответы на Q1, Q2, Q3 (одной строкой)
Желательно но не критично:
5. JwtPayload интерфейс
6. admin.module.ts

📨 Скидывай — и я пишу полностью рабочий код в 6 сообщениях подряд 🚀