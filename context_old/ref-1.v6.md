📦 Контекст для доработки фронта генерации (для другого ИИ)

🎯 Задача

Сейчас на фронте есть чат с картинками (vision) — работает ✅.

Теперь нужно реализовать страницу генерации изображений с:

Динамическими настройками (mode, resolution, aspectRatio, quality и т.д.) — берутся из бэкенда
Загрузкой пользовательских картинок для img2img (через /api/v1/upload/image)
Real-time ценой в токенах (через /api/v1/generation/calculate-price)
Отправкой на генерацию через /api/v1/generation/image
🔌 Готовые эндпоинты бэкенда

1️⃣ Получение UI-конфига модели

Http

GET /api/v1/generation/models/:slug/ui-config
Authorization: Bearer <JWT>
Ответ:

Json

{
  "success": true,
  "data": {
    "slug": "midjourney",
    "displayName": "Midjourney",
    "uiParameters": [
      {
        "key": "mode",
        "label": "Режим генерации",
        "type": "select",
        "affectsPrice": true,
        "defaultValue": "fast",
        "options": [
          { "value": "relax", "label": "Relax (5🔥, ~5 мин)" },
          { "value": "fast",  "label": "Быстрый (12🔥, ~30 сек)" },
          { "value": "turbo", "label": "Турбо (22🔥, ~15 сек)" }
        ]
      },
      {
        "key": "aspectRatio",
        "label": "Соотношение сторон",
        "type": "select",
        "affectsPrice": false,
        "defaultValue": "1:1",
        "options": [
          { "value": "1:1",  "label": "Квадрат (1:1)" },
          { "value": "16:9", "label": "Горизонталь (16:9)" },
          { "value": "9:16", "label": "Вертикаль (9:16)" }
        ]
      }
    ],
    "pricingMatrix": [...],
    "inputCapabilities": {
      "acceptsImages": false,
      "maxInputImages": 0
    }
  }
}
2️⃣ Расчёт цены (debounce ~300ms на изменении)

Http

POST /api/v1/generation/calculate-price
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "modelSlug": "midjourney",
  "params": { "mode": "turbo", "aspectRatio": "16:9" }
}
Ответ:

Json

{
  "success": true,
  "data": {
    "costInTokens": 22,
    "costInDollars": 0.22,
    "fallback": false,
    "matchedRule": {
      "conditions": { "mode": "turbo" },
      "costInTokens": 22,
      "label": "Турбо режим"
    },
    "breakdown": { "rule": "Турбо режим", "params": { "mode": "turbo" } }
  }
}
3️⃣ Загрузка картинки (для img2img)

Http

POST /api/v1/upload/image
Authorization: Bearer <JWT>
Content-Type: multipart/form-data

file: <binary>
Ответ:

Json

{
  "success": true,
  "data": {
    "url": "https://s3.timeweb.cloud/ai-generations/uploads/<userId>/image/<uuid>.jpg",
    "key": "uploads/...",
    "size": 123456,
    "mimeType": "image/jpeg",
    "uploadedAt": "2026-05-21T..."
  }
}
✅ Этот эндпоинт уже используется в чате для vision — на фронте есть src/lib/api/upload.ts. Переиспользуем.
4️⃣ Старт генерации

Http

POST /api/v1/generation/image
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "modelSlug": "midjourney",
  "prompt": "a beautiful sunset",
  "mode": "turbo",
  "aspectRatio": "16:9",
  "inputImageUrls": ["https://s3.../uploaded.jpg"]  // опционально для img2img
}
Ответ:

Json

{
  "generationId": "...",
  "status": "pending",
  "tokensCost": 22,
  "costInDollars": 0.22,
  "pricingBreakdown": { ... }
}
Дальше — polling через GET /api/v1/generation/:id или WebSocket-уведомление.
📋 Типы параметров (uiParameters[].type)

Из текущих моделей встречаются:

type	Описание	Как рендерить
select	Выбор из options[]	Кнопки-чипы (мобильно) или dropdown
boolean	true/false (например sound, instrumental)	Toggle-switch
number	Число (например duration для аудио)	Slider или input
text	Строка (например title для Suno)	Input
Поля параметра:

Ts

interface UIParameter {
  key: string            // 'mode', 'aspectRatio', 'resolution', 'duration', ...
  label: string          // Локализованная подпись
  type: 'select' | 'boolean' | 'number' | 'text'
  affectsPrice: boolean  // если true → debounced recalc цены при изменении
  defaultValue?: any
  options?: Array<{ value: string; label: string }>  // только для type=select
  min?: number           // для number
  max?: number           // для number
}
🎨 Примеры моделей и их параметров

Midjourney

mode: relax(5🔥) / fast(12🔥) / turbo(22🔥) — affectsPrice
aspectRatio: 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3
Flux 2

version: flex / pro — affectsPrice
resolution: 1K / 2K — affectsPrice
aspectRatio: 1:1 / 16:9 / 9:16
Nano Banana Pro

resolution: 1K(9🔥) / 2K(11🔥) / 4K(14🔥) — affectsPrice
aspectRatio: ...
outputFormat: png / jpg / webp
GPT-5 Image

quality: standard(9🔥) / hd(12🔥) — affectsPrice
aspectRatio: ...
Sora 2 (видео, но логика та же)

duration: 5s(20🔥) / 10s(30🔥) / 15s(45🔥) — affectsPrice
aspectRatio: ...
Kling 3.0 (видео)

mode: std / pro — affectsPrice
sound: true/false — affectsPrice
duration: 5 / 10
aspectRatio: ...
🗂️ Что уже есть на фронте


src/
├── lib/
│   ├── api/
│   │   ├── index.ts          ← ENDPOINTS, apiClient (axios)
│   │   ├── upload.ts         ✅ Готовый XHR upload с прогрессом
│   │   └── ...
│   └── data.ts               ← статика моделей (fallback)
├── stores/
│   ├── models.store.ts       ← список моделей (грузится с бэка)
│   ├── chat.store.ts
│   └── ...
├── hooks/
│   ├── useModels.ts          ← маппит модели с бэкенда
│   └── ...
├── pages/
│   ├── ChatPage.tsx          ✅ Чат с vision работает
│   └── GeneratePage.tsx      ⏳ ← вот это надо доработать
└── components/
    └── (нужны новые компоненты)
Известный паттерн — fetch модели:

Ts

// src/hooks/useModels.ts (уже есть)
const { models } = useModels()
const currentModel = models.find(m => m.slug === slug)
🏗️ Что нужно сделать на фронте

A. Новый хук useModelUIConfig(slug)

Ts

// src/hooks/useModelUIConfig.ts
export function useModelUIConfig(slug: string | null) {
  // GET /api/v1/generation/models/:slug/ui-config
  // → { uiParameters, inputCapabilities, defaultValues }
  // Кэшируется по slug, опционально через SWR/React Query (если есть) или просто useState
  return { config, isLoading, error }
}
B. Новый хук usePriceCalculator(slug, params)

Ts

// src/hooks/usePriceCalculator.ts
export function usePriceCalculator(slug: string, params: Record<string, any>) {
  // Debounce 300ms на изменения params
  // POST /api/v1/generation/calculate-price
  // → { costInTokens, costInDollars, matchedRule, fallback }
  return { price, isCalculating }
}
C. Компонент <DynamicParamsForm />

Рендерит форму из uiParameters[]:

select → группа чипов (мобильный UI как в текущей вёрстке)
boolean → toggle
number → slider
При изменении любого поля с affectsPrice: true → триггерит пересчёт цены
D. Компонент <InputImagesUploader /> (для img2img)

Если inputCapabilities.acceptsImages === true:

Кнопка "📎 Добавить картинку" (до maxInputImages штук)
Превью с прогрессом загрузки (переиспользует upload.ts)
Передаёт массив URLs в inputImageUrls при submit
E. Обновлённая GeneratePage.tsx

Структура:

Tsx

<GeneratePage>
  <ModelHeader /> {/* название, описание */}
  
  <PromptInput /> {/* textarea для промпта */}
  
  {config.inputCapabilities.acceptsImages && (
    <InputImagesUploader 
      maxImages={config.inputCapabilities.maxInputImages}
      value={inputImageUrls}
      onChange={setInputImageUrls}
    />
  )}
  
  <DynamicParamsForm
    parameters={config.uiParameters}
    value={params}
    onChange={setParams}
  />
  
  <PriceDisplay 
    costInTokens={price?.costInTokens}
    isCalculating={isCalculating}
    matchedRuleLabel={price?.matchedRule?.label}
  />
  
  <GenerateButton 
    disabled={!prompt || isCalculating || isUploading}
    onClick={handleGenerate}
  />
</GeneratePage>
F. Стор/локалстейт генераций

При submit → POST /generation/image → получаем generationId
Polling GET /generation/:id каждые 2-3 сек ИЛИ WebSocket-подписка
Превью результата с возможностью открыть полноразмер
📝 Важные нюансы

affectsPrice — если у параметра false (например aspectRatio), не триггерим recalc — экономим запросы.
Debounce 300ms на пересчёт цены — иначе при быстрых переключениях будет спам.
Fallback цена — если бэкенд вернул fallback: true, не показываем "matchedRule.label", просто цену.
maxInputImages: 0 или acceptsImages: false → блок upload не рендерим вообще.
TokenCost округлять не нужно — бэк отдаёт integer.
Стилистика — следовать существующему дизайну (см. ChatPage.tsx) — [var(--radius-xs)], bg-[var(--bg-glass)], text-[var(--accent-yellow)], чипы, active:scale-[0.96], haptic feedback.
Балансы — после успешной генерации стор юзера должен подтянуть новый баланс (как в чате).
❓ Вопросы для следующего ИИ

Где сейчас GeneratePage.tsx? Покажи текущий код — допишем поверх.
Какая стейт-библиотека для запросов? Чистый useState + useEffect, SWR, React Query, или что-то ещё?
Polling vs WebSocket для статуса генерации — что уже работает в проекте?
Стор балансов — как называется (useUserStore?), и есть ли метод refresh после генерации?
🎬 Дай мне следующие файлы фронта

Чтобы написать код:

src/pages/GeneratePage.tsx (если есть) — текущий код страницы генерации
src/stores/user.store.ts (или как называется) — для refresh баланса
src/lib/api/index.ts — посмотреть ENDPOINTS чтобы добавить новые
src/hooks/useModels.ts уже видели — ОК
Любой компонент с чипами/select из существующей вёрстки — чтобы повторить стилистику
Существующий компонент PromptInput или подобный (если есть)
После получения → выдам полный пакет:

🆕 useModelUIConfig.ts
🆕 usePriceCalculator.ts
🆕 DynamicParamsForm.tsx
🆕 InputImagesUploader.tsx (или переиспользуем из ChatPage)
🆕 PriceDisplay.tsx
🔄 Обновлённый GeneratePage.tsx
🔄 Патч src/lib/api/index.ts (+ENDPOINTS)
Готов? Скидывай файлы 👇

