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

🔥 Шикарно, скриншоты дали полную картину! Теперь я понимаю реальную модель. Зафиксирую:

✅ Финальная архитектура (на основе скринов)

Тарифы (Plans) — 4 штуки + Free

Тариф	Цена/мес	Спички	Доступ к моделям
Free	0 ₽	50 (при регистрации)	Ограниченный
Basic	450 ₽	150	Ограниченный
Plus	990 ₽	330 + бонусы	Полный + 3 безлимитные модели (10/час, 60/сутки)
Max	2490 ₽	830 + 50 в подарок	Полный + 3 безлимитные модели
Ultimate	5990 ₽	1997 + 220 в подарок	Полный + 6 безлимитных моделей
Безлимитные модели в тарифах

Это модели, доступные бесплатно (без списания спичек) с rate-limit (10 запросов/час, 60/сутки). У каждого тарифа свой список таких моделей.

Курс

1 спичка = 3 ₽ (или $X в USD) — хранится в Settings, редактируется админом.

Пакеты спичек (отдельно от подписок)

Юзер может докупать спички пачками — например, «500 спичек за 1500 ₽». Тоже редактируются админом.

📐 Структура сущностей в БД (буду создавать)


1. AIModel          — модели (gpt-oss-120b, DeepSeek и т.д.)
2. Plan             — тарифы (Free, Basic, Plus, Max, Ultimate)
3. TokenPackage     — пакеты спичек на докупку
4. Settings         — глобальные настройки (курс, бонус регистрации)
5. User             — уже есть (tokenBalance, bonusTokens, planId, planExpiresAt)
❓ Финальные уточнения (последние, обещаю)

1. Списание спичек — округление

При запросе списываем inputTokens × priceIn + outputTokens × priceOut. Получается дробь, например 0.47 спички.

Ты сказал «А — дробные». Уточню: сколько знаков после запятой показывать юзеру?

A) Целое в UI, дробное в БД: баланс 19 (а в БД 19.347)
B) 1 знак: баланс 19.3
C) 2 знака: баланс 19.34
На скрине у тебя написано «Баланс 19 🔥» — выглядит как целое. Подтверди вариант A?

2. Безлимитные модели в тарифе — где хранить лимиты?

Вариант, который вижу из скрина: «10/час, 60/сутки» — одинаковый для всех безлимитных моделей в тарифе.

A) Лимит хранится в тарифе (Plan):

Js

Plan {
  unlimitedModels: [
    { modelId: 'gpt-oss-120b', requestsPerHour: 10, requestsPerDay: 60 },
    { modelId: 'deepseek-v3.2', requestsPerHour: 10, requestsPerDay: 60 },
  ]
}
B) Лимит общий на тариф:

Js

Plan {
  unlimitedModels: ['gpt-oss-120b', 'deepseek-v3.2'],
  unlimitedLimits: { requestsPerHour: 10, requestsPerDay: 60 }
}
B проще, A гибче (можно одной модели дать 10/час, другой 20/час). Что выбираешь?

3. Что показывать в карточке тарифа (поля)

Вижу на скрине: «Генерация 275 изображений», «Генерация 55 видео», «Генерация 82 песен». Это расчётные значения (спички ÷ цена), или захардкоженные числа, которые админ вводит вручную?

A) Расчётные — у каждой генерации (текст/картинка/видео/песня) есть «средняя цена», числа считаются автоматом: 330 спичек ÷ 1.2 спички за картинку = 275

B) Ручные — админ просто пишет в карточке тарифа: "275 изображений, 55 видео, 82 песни" как маркетинговый текст

Что выбираешь?

4. Подписка и докупка — как комбинируются?

У юзера есть тариф Plus (330 спичек/мес). Спички закончились через 2 недели. Что дальше?

A) Можно докупить пакет спичек, они добавятся к балансу. В конце месяца — обновляется до 330 (старые сгорают)
B) Можно докупить, и купленные не сгорают (живут отдельно от подписочных)
C) Купленные складываются и не сгорают, подписочные обновляются каждый месяц

Какая модель ближе?

Ответь на 1–4 (можно коротко: 1-A, 2-B, 3-A, 4-C) — и я сразу запрошу нужные файлы (схемы User, AIModel, существующие Plan/Subscription если есть, AdminController, AdminService). 🎯

📋 КОНТЕКСТ ПРОЕКТА: SPICHKI AI — Админка

🏗️ Архитектура проекта

Монорепо:

ai-aggregator/ — Backend (NestJS + MongoDB/Mongoose)
ai-miniapp/ — Frontend (Next.js + React, Telegram Mini App + Web)
Текущее состояние админки:

✅ Backend: базовая AdminModule есть (controller + service + module)
❌ Frontend: админки нет, нужно создавать с нуля
💰 ЭКОНОМИКА (зафиксировано окончательно)

Внутренняя валюта

Спички 🔥 (в UI) = tokens (в коде)
Хранятся в User.tokenBalance (купленные) + User.bonusTokens (бонусные) + User.cashbackBalance (реф. кэшбек 10%)
В БД дробные (Number), в UI округляются до целых
Не сгорают ни купленные, ни бонусные при обновлении подписки
Курс

1 спичка = 3 ₽ (захардкожен tokenPriceRub: 3 в BillingService)
1 $ = 75 ₽ (захардкожено RUB_TO_USD_RATE = 75)
⚠️ TODO в Части 4: вынести в коллекцию Settings, редактировать из админки
Списание приоритет

Сейчас в коде используется суммарно tokenBalance + bonusTokens. Логика списания внутри UsersService.deductTokens (нужно посмотреть отдельно при работе с балансом).

🤖 МОДЕЛИ (AIModel)

Схема уже сложная и продуманная:

Поле	Назначение
slug, name, displayName, description, icon	Базовая инфа
type	text / image / video / audio
isActive, isPremium, supportsVision	Флаги
sortOrder	Порядок отображения
costPerMillionInputTokens / costPerMillionOutputTokens	Цены в долларах за 1M токенов (для text)
fixedCostPerGeneration	Цена в $ за 1 ген. (для media, fallback)
tokensPerDollar	Курс конвертации $ → спички (по умолчанию 30, в text — 100 в коде)
minTokenCost	Минимум 1 спичка
providerMappings	Маппинг на провайдеров (Provider → providerSlug → modelId)
pricingMatrix	🔥 Матрица цен для media — массив правил {conditions, costInTokens, costInDollars, label}
uiParameters	Описание UI формы генерации (select/toggle/number, options, visibleWhen)
inputCapabilities	Что принимает на вход (images, files, audio, video)
defaultParams, limits, capabilities, stats	Прочее
⚠️ Важный нюанс: pricingMatrix и uiParameters — это сердце media-генерации. Их редактирование в админке = главная задача Части 2.

📦 ПОДПИСКИ (Subscription + SUBSCRIPTION_PLANS)

Сейчас тарифы захардкожены в коде в BillingService:

Basic 450₽ → 150 спичек, без бесплатных моделей
Plus 990₽ → 330 спичек + 3 бесплатных text модели (10/час, 60/сутки)
Max 2490₽ → 830 + 50 бонус + 3 безлимитных text
Ultimate 5990₽ → 1997 + 220 бонус + 6 моделей (text безлимит, image с лимитами)
⚠️ TODO в Части 3: перенести SUBSCRIPTION_PLANS из кода в БД (новая схема Plan), редактируемые из админки.

Бесплатные модели в плане:

Ts

freeModels: [
  { modelSlug, displayName, hourlyLimit, dailyLimit }  // null = безлимит
]
Deprecated planы (миграция):

PRO → PLUS
UNLIMITED → ULTIMATE
💸 ПАКЕТЫ ТОКЕНОВ

Тоже захардкожены в коде:

100/300/700/1500/5000 спичек за 99/249/499/899/2499 ₽
⚠️ TODO в Части 3: перенести в БД (новая схема TokenPackage).

🎟️ ПРОМОКОДЫ (PromoCode)

Уже есть, методы в BillingService:

createPromoCode, applyPromoCode, getAllPromoCodes, deactivatePromoCode
Поля: code, description, bonusTokens, discountPercent, maxUses, expiresAt, usedByUsers[]
💳 ТРАНЗАКЦИИ (Transaction)

Полная история операций. Типы (TransactionType):

DEPOSIT — пополнение
GENERATION — списание за генерацию
SUBSCRIPTION — оплата подписки
PROMO_CODE — бонус по промокоду
REFERRAL_BONUS — кэшбек 10%
REFUND — возврат
ADMIN_ADJUSTMENT — ручная корректировка админом
Поля включают: inputTokens, outputTokens, costInDollars, costInTokens, metadata.

💸 ПЛАТЁЖНЫЕ ПРОВАЙДЕРЫ

В коде уже подключены:

YookassaProvider (RUB)
CryptomusProvider (крипта)
StarsProvider (Telegram Stars)
FreedomPayProvider (RUB, KZT)
TochkaProvider (RUB, банк Точка)
HeleketProvider (крипта)
Все обрабатываются webhook'ами в BillingService.

👮 РОЛИ (UserRole)

USER — обычный юзер
ADMIN — может всё, кроме создания AI-моделей
SUPER_ADMIN — может всё
Защита: JwtAuthGuard + RolesGuard + @Roles(...) декоратор.

✅ ЧТО УЖЕ ЕСТЬ В АДМИНКЕ (backend)

AdminController (/admin/*) с эндпоинтами:

GET /dashboard — статистика
GET /users + PUT /users/:id/role + PUT /users/:id/ban + POST /users/:id/adjust-balance
GET /providers + PUT /providers/:slug
GET /models + PUT /models/:slug — ⚠️ только обновление, нет CREATE/DELETE!
GET /promo-codes + POST /promo-codes + DELETE /promo-codes/:code
GET /analytics/revenue + GET /analytics/generations + GET /analytics/models
❌ ЧТО НУЖНО ДОБАВИТЬ (TODO по частям)

Часть 2: CRUD моделей (текущая)

✅ POST /admin/models — создать модель (только SUPER_ADMIN)
✅ DELETE /admin/models/:slug — soft delete
✅ Расширить PUT /admin/models/:slug — редактирование всех полей (pricingMatrix, uiParameters, цены, лимиты)
✅ DTO с валидацией
✅ Frontend: страница /admin/models со списком + формой создания/редактирования
Часть 3: Тарифы и пакеты в БД

Новая схема Plan + CRUD
Новая схема TokenPackage + CRUD
Миграция данных из захардкоженных констант
Frontend: страницы /admin/plans, /admin/packages
Часть 4: Settings (глобальные настройки)

Новая схема Settings (курс рубля, курс спички, бонус регистрации)
Frontend: страница /admin/settings
Часть 5: Расширенная админка пользователей

Просмотр транзакций юзера
История генераций юзера
Реферальное дерево
Управление подпиской (выдать вручную)
Часть 6: Аналитика и графики (фронт)

Дашборд с графиками (revenue, генерации по дням, топ моделей)
Использует уже готовые эндпоинты GET /admin/analytics/*
Часть 7: Layout админки + навигация (фронт)

Sidebar, header, защита роутов от не-админов
Локация: предположительно ai-miniapp/src/app/admin/
🎯 ПРИОРИТЕТ И ПОРЯДОК

Предлагаю такой порядок выполнения:

Часть 2 — Модели (CRUD на backend + UI) ← СТАРТУЕМ С НЕЁ
Часть 7 — Layout админки (чтобы было куда встроить страницу моделей)
Часть 3 — Тарифы + пакеты в БД
Часть 4 — Settings
Часть 5 — Пользователи (детальный просмотр)
Часть 6 — Графики/аналитика
❓ ВОПРОСЫ ПЕРЕД СТАРТОМ ЧАСТИ 2

Прежде чем писать код, 3 финальных уточнения:

1. Куда класть админку на фронте?

Вижу структуру ai-miniapp/src/app/ (Next.js App Router). Создавать ai-miniapp/src/app/admin/... как отдельный раздел? Или будет отдельное приложение (например ai-admin/)?

Рекомендую: в том же ai-miniapp под /admin/* — проще авторизация, общий API-клиент, общие компоненты UI. Согласен?

2. UI библиотека

Вижу папку components/ui — это shadcn/ui? Какой подход к стилизации (Tailwind?)? Какие компоненты уже есть (Button, Input, Modal, Table)?

Кинь скрин содержимого components/ui или просто скажи «shadcn, всё стандартное».

3. Перед стартом части 2 — начать с layout (Часть 7) или сразу страница моделей?

A) Сначала Часть 7 (layout админки, sidebar, защита роутов) — потом Часть 2 встроится красиво
B) Сразу Часть 2 (модели) — layout сделаем минималистичный, добьём позже

Я бы шёл по A — иначе будем переделывать. Что выбираешь?

После твоих ответов на 1-3 — стартуем код. 🚀

