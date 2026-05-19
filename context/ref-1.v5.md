🎯 SPICHKI AI — Контекст рефакторинга (v6.0 POST-ITERATION-1)

v6.0 (текущая): Итерация 1 ЗАВЕРШЕНА и СБИЛЖЕНА. Инфраструктура развёрнута. Готовы к наполнению данных.
v5.0: Все файлы разобраны, план готов.
v4.0: Разбор billing/generation/dto.
v3.0: Разбор провайдеров.
v2.0: Данные БД.
v1.0: Концепция.
0. 📊 ЧТО СДЕЛАНО В ИТЕРАЦИИ 1 (✅ ДЕПЛОЙ ПРОШЁЛ)

0.1. Применённые файлы — 10 артефактов

#	Файл	Тип изменения	Статус
1	src/modules/ai-providers/schemas/model.schema.ts	Полная замена	✅ Применён
2	src/modules/generation/schemas/generation.schema.ts	Полная замена	✅ Применён
3	src/modules/billing/pricing.service.ts	Новый файл	✅ Применён
4	src/modules/billing/billing.module.ts	Полная замена (+PricingService в providers/exports)	✅ Применён
5	src/modules/generation/dto/calculate-price.dto.ts	Новый файл	✅ Применён
6	src/modules/generation/dto/image-generation.dto.ts	Полная замена (+mode, version, stable, operation, title, videoUrls)	✅ Применён
7	src/modules/generation/generation.controller.ts	Полная замена (+ 2 новых эндпоинта)	✅ Применён
8	src/modules/generation/generation.service.ts	Полная замена (+ PricingService интеграция)	✅ Применён
9	src/modules/generation/generation.module.ts	Полная замена (+ AIModelSchema регистрация)	✅ Применён
10	src/modules/ai-providers/providers/kie.provider.ts	3 точечные правки	✅ Применён
Итог: npm run build → 0 ошибок, сервер стартует, существующие генерации работают.

0.2. Что РЕАЛИЗОВАНО на уровне инфраструктуры

🆕 Схема AIModel обогащена 3 полями:

Ts

pricingMatrix: PricingRule[]       // массив правил с условиями
uiParameters: UIParameter[]        // декларация параметров для фронта
inputCapabilities: InputCapabilities  // что модель умеет принимать на вход
providerMappings[].metadata?: Record<string, any> — для метаданных типа { version: 'pro' }.
🆕 Схема Generation обогащена 2 полями:

Ts

costInDollars: number              // долларовая стоимость
pricingBreakdown: object           // детализация какое правило применилось
🆕 Новый сервис PricingService

Метод: calculatePrice(modelSlug: string, params: Record<string, any>) → PriceCalculation

Алгоритм:

Находит модель в БД
Для текста → возвращает minTokenCost как preview
Для media → перебирает pricingMatrix, отсортированный по специфичности (больше условий — выше приоритет)
Если правило совпало (все conditions подмножество params) → возвращает его цену
Если ни одно не совпало → fallback к fixedCostPerGeneration × tokensPerDollar
Особенность: Возвращает breakdown для аудита — какое правило сработало, какие параметры пришли.

🆕 Новые API эндпоинты


POST /api/v1/generation/calculate-price
  → { modelSlug, params? }
  → { costInTokens, costInDollars, fallback, matchedRule?, breakdown }

GET /api/v1/generation/models/:slug/ui-config
  → { slug, displayName, uiParameters, pricingMatrix, inputCapabilities, defaultParams }
🆕 Расширены DTO

ImageGenerationDto добавлено: mode, version
VideoGenerationDto добавлено: stable, videoUrls
AudioGenerationDto добавлено: operation, title

🆕 Интеграция в GenerationService

Ts

// БЫЛО:
const { costInTokens } = await billing.calculateGenerationCost(modelSlug);

// СТАЛО:
const priceCalc = await pricingService.calculatePrice(
  modelSlug,
  this.extractPricingParams(dto)
);
const costInTokens = priceCalc.costInTokens;
// + сохранение priceCalc.breakdown в Generation.pricingBreakdown
// + costInDollars в Generation.costInDollars
Метод extractPricingParams(dto) собирает из DTO только те поля, которые влияют на цену: mode, version, resolution, quality, duration, sound, stable, operation, hasInputImage, numImages.

🆕 Правки в kie.provider.ts

Передача videoUrls для Kling motion-control
Передача stable для Sora (зарезервирован)
Проброс operation в Suno body
Передача mode для Midjourney (turbo/fast/relax)
Передача version для Flux
0.3. Что РАБОТАЕТ НА УРОВНЕ ПОВЕДЕНИЯ (важно!)

Возможность	Состояние	Почему
Старые запросы фронта работают как раньше	✅ Да	Все новые поля DTO опциональные. pricingMatrix пустой → fallback к fixedCostPerGeneration (как было)
Цены не изменились для существующих моделей	✅ Да	Матрицы не заполнены, идёт fallback
Эндпоинт /calculate-price отвечает	✅ Да	Но возвращает fallback: true для всех моделей
Эндпоинт /ui-config отвечает	✅ Да	Но возвращает uiParameters: [], pricingMatrix: []
Generation.pricingBreakdown пишется в БД	✅ Да	С момента деплоя — все новые генерации имеют этот объект
Generation.costInDollars пишется в БД	✅ Да	Аналогично
KIE провайдер принимает новые параметры	✅ Да	Если придут — учтёт, если нет — игнорирует
0.4. Что НЕ изменилось (намеренно)

❌ generation.consumer.ts — не трогали, работает старая логика (это в итерацию 2)
❌ provider-registry.service.ts — seedDefaultModels() остался старый, без матриц
❌ billing.service.ts — calculateGenerationCost, chargeForGeneration, recordRefund — без изменений
❌ Транзакции для media — по-прежнему НЕ создаются (баг известен, в итерацию 2)
❌ Цены в БД — не обновлены (текущие fixedCostPerGeneration остались)
❌ includedInPlans — старые значения (['pro', 'unlimited'])
❌ tokensPerDollar — у каждой модели свои (от 30 до 1000)

1. 🎯 ТЕКУЩЕЕ СОСТОЯНИЕ ПРОЕКТА

1.1. Метафора

Построен трубопровод. Вода ещё не пущена.
Бэкенд готов принимать pricingMatrix и uiParameters из БД
Фронт может вызывать /calculate-price и /ui-config — получит валидный ответ
Но в ответе всё ещё fallback: true, uiParameters: [] — потому что данных нет
1.2. Что точно работает (можно тестировать)

Bash

# Тест 1: расчёт цены (fallback)
curl -X POST http://localhost:3000/api/v1/generation/calculate-price \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"modelSlug":"midjourney","params":{"mode":"turbo"}}'

# Ответ:
{
  "success": true,
  "data": {
    "costInTokens": 30,           # ← через fallback
    "costInDollars": 0.05,
    "fallback": true,             # ← матрица пустая
    "breakdown": { "rule": "fixed-price fallback", ... }
  }
}

# Тест 2: UI конфиг модели
curl http://localhost:3000/api/v1/generation/models/midjourney/ui-config \
  -H "Authorization: Bearer <JWT>"

# Ответ:
{
  "data": {
    "slug": "midjourney",
    "uiParameters": [],           # ← пусто, надо заполнить
    "pricingMatrix": [],          # ← пусто
    "inputCapabilities": {}       # ← пусто
  }
}
1.3. Что не работает (нужно сделать)

❌ Реальные цены по матрице (Midjourney turbo=6🔥, fast=4🔥, normal=2🔥)
❌ Динамические формы на фронте (нет uiParameters)
❌ Транзакции для media-генераций не пишутся (старый баг)
❌ Suno операции extend/cover/boost (только generate)
❌ Upload контроллер /api/v1/upload/image
❌ Чат мультимодальность (vision для Claude/GPT)
❌ Админка управления pricingMatrix
2. 🗺 ДОРОЖНАЯ КАРТА — ЧТО ДАЛЬШЕ

🎯 ИТЕРАЦИЯ 2 — НАПОЛНЕНИЕ ДАННЫХ (СЛЕДУЮЩИЙ ШАГ)

Цель: запустить воду в трубопровод.

Что делаем:

2A. Обновлённый seedDefaultModels в provider-registry.service.ts

Большая правка ~700 строк. Заполняем для 11 моделей:

Модель	pricingMatrix	uiParameters	inputCapabilities
midjourney	3 правила (normal/fast/turbo)	mode, aspectRatio	—
flux-2	4 правила (normal×{1K,2K}, pro×{1K,2K})	version, resolution, aspectRatio	maxImages: 8
nano-banana-2	3 правила (1K/2K/4K)	resolution, aspectRatio, outputFormat	maxImages: 14
nano-banana-pro	3 правила (1K/2K/4K)	resolution, aspectRatio, outputFormat	maxImages: 8
sora-2	2 правила (10s/15s)	duration, aspectRatio	maxImages: 1
kling-3.0	4 правила (std/pro × sound)	mode, sound, duration	maxImages: 1
runway	4 правила (720p/1080p × 5s/10s)	resolution, duration, aspectRatio	maxImages: 1
hailuo-2.3-standard	3 правила (768P/1080P × 6s/10s)	resolution, duration	maxImages: 1
hailuo-2.3-pro	3 правила (768P/1080P × 6s/10s)	resolution, duration	maxImages: 1
veo-3.1-fast	flat (15🔥)	(опции скрыты до уточнения с Evolink)	maxImages: 1
veo-3.1-pro	flat (75🔥)	(опции скрыты)	maxImages: 1
Стратегия записи в БД: Вариант А — $setOnInsert для новых полей, чтобы при рестарте админские правки не затирались.

Параллельно:

⚠️ Обновить includedInPlans → ['plus', 'max', 'ultimate'] для всех моделей
⚠️ Деактивировать deepseek-v4, elevenlabs-tts (isActive: false)
⚠️ Сменить tokensPerDollar → 30 для всех
⚠️ Для hailuo-2.3-standard/pro → сменить providerMappings priority 1 на hailuo/02-text-to-video-* (auto-switch в KIE)
2B. Багфикс: транзакции для media

В generation.consumer.ts после успешной генерации добавить:

Ts

await billingService.recordMediaGeneration(userId, generationId, ...);
Новый метод в BillingService. Это починит:

✅ Историю транзакций для image/video/audio
✅ getRevenueStats для всех типов
✅ Лимиты freeAccess 10/час, 60/сутки
2C. Suno операции

Расширение kie.provider.ts.generateAudio():

Ts

const sunoEndpoints: Record<string, string> = {
  generate: '/api/v1/generate',
  extend: '/api/v1/generate/extend',
  cover: '/api/v1/generate/cover',
  // + 5 остальных
};
Зависимость: нужны точные URL endpoints от KIE (документация или curl).

Время итерации 2: ~4-5 часов кодинга + 1 час тестов

🎯 ИТЕРАЦИЯ 3 — UPLOAD + ЧАТ МУЛЬТИМОДАЛЬНОСТЬ

3A. Контроллер /upload

Создание src/modules/upload/upload.controller.ts:


POST /api/v1/upload/image   multipart → { url, key, size }
POST /api/v1/upload/audio   multipart → { url, key, size }
POST /api/v1/upload/file    multipart → { url, key, size, mimeType }
Использует StorageService.uploadBuffer(). ~50 строк.

Зачем нужен: для img2img / img2vid фронт должен сначала загрузить пользовательскую картинку, потом передать URL в inputUrls/imageUrl.

3B. Чат — мультимодальность (vision)

Файлы:

chat/schemas/message.schema.ts → добавить attachments: AttachmentDto[]
chat/chat.service.ts → в buildContext пробрасывать images[] в провайдер
evolink.provider.ts → в convertToClaudeMessages поддержка [{type:'image', source:...}]
openrouter.provider.ts → для vision-моделей content: [{type:'text'}, {type:'image_url', image_url:{url}}]
Время итерации 3: ~3 часа

🎯 ИТЕРАЦИЯ 4 — АДМИНКА

4A. Эндпоинты управления моделями


PUT /admin/models/:slug/pricing    → обновить pricingMatrix
PUT /admin/models/:slug/parameters → обновить uiParameters
PUT /admin/models/:slug            → общие настройки
GET /admin/models                  → список со всеми полями
Время итерации 4: ~2 часа

🎯 ИТЕРАЦИЯ 5 — ФРОНТ (НА СТОРОНЕ ФРОНТА)

После завершения итерации 2:

Страница генерации запрашивает /models/:slug/ui-config
Динамически рендерит форму по uiParameters
На каждый change → /calculate-price (debounce 300ms)
Отображает цену в реальном времени
При submit → обычный /generation/image|video|audio + сохранённые params
3. 📋 РЕШЕНИЯ, КОТОРЫЕ УЖЕ ПРИНЯТЫ

#	Решение	Статус
1	Стратегия сида: Вариант А ($setOnInsert для новых полей)	✅ Применить в итерации 2
2	Sora stable — отказ, в KIE нет	✅ Не передаём в матрицу
3	Kling 3.0 — используем mode: std/pro вместо resolution	✅ В матрице будут conditions: {mode}
4	Veo 4K — пока flat (15🔥/75🔥), уточнить с Evolink	⏳ Запрос к Evolink
5	Hailuo 768P/1080P — формат с заглавной P (как у KIE)	✅ В матрице
6	Flux переключение flex↔pro — в провайдере	✅ Уже сделано в итерации 1
7	Suno операции — только generate в итерации 1	✅ Расширение в итерации 2
8	Hailuo Pro t2v — hailuo/02-text-to-video-pro priority 1	✅ В сиде итерации 2
9	Replicate — оставляем, не используем	✅
10	tokensPerDollar: 30 для всех media-моделей	✅ В сиде итерации 2
11	Терминология — tokens в коде, 🔥 в UI	✅
12	PricingService для text — возвращает minTokenCost как preview	✅ Уже работает
13	Транзакции media — багфикс в итерации 2	⏳
4. 🚨 ИЗВЕСТНЫЕ ПРОБЛЕМЫ (на бэкенде)

Проблема	Критичность	План
Транзакции для image/video/audio не создаются	🔴 Высокая	Итерация 2B
Лимиты freeModelAccess не работают для media	🔴 Высокая	Итерация 2B
getRevenueStats не учитывает media	🟡 Средняя	Итерация 2B
В pollTaskUntilComplete не сохраняется resultContent, responseTimeMs	🟢 Низкая	Не блокирует
Replicate не используется	🟢 Низкая	Не трогаем
S3_BUCKET=your-bucket-name в .env.example	🟡 Средняя	Проверить продакшен .env
5. 🎬 ЧТО НУЖНО ДЛЯ ИТЕРАЦИИ 2

5.1. Файлы от тебя:

🔴 Критично:

src/modules/ai-providers/provider-registry.service.ts — текущий код seedDefaultModels() (чтобы написать новую версию с матрицами поверх него)
src/modules/generation/queues/generation.consumer.ts — для багфикса транзакций media
src/modules/billing/billing.service.ts — чтобы добавить новый метод recordMediaGeneration()
🟡 Желательно:
4. src/modules/users/users.service.ts — посмотреть интерфейс deductTokens, refundTokens (чтобы не сломать)
5. Подтверждение по продакшен .env:

S3_BUCKET = реальный bucket ID?
S3_PUBLIC_URL = реальный URL?
5.2. Решения от тебя:

❓ Suno операции — нужны точные KIE endpoints. У тебя есть документация KIE или можешь сделать curl на их API?

Если нет — в итерации 2 сделаем только generate (как сейчас), Suno операции отложим в итерацию 2.5.

❓ Veo 4K через Evolink — поддерживается ли quality: '4K'? Если не знаешь — оставим только 720p/1080p, потом через админку добавим.

6. 📊 ОЦЕНКА ВРЕМЕНИ

Итерация	Объём	Время
Итерация 1	Инфраструктура	✅ ЗАВЕРШЕНА
Итерация 2	Seeder с матрицами + багфикс транзакций	~5 часов
Итерация 2.5 (опц)	Suno операции	~1.5 часа
Итерация 3	Upload + чат vision	~3 часа
Итерация 4	Админка	~2 часа
Итерация 5	Фронт	(на стороне фронта)
До полной готовности бэкенда: ~11-12 часов работы.

7. 🎯 НЕМЕДЛЕННЫЙ ВЫБОР — КУДА ИДЁМ?

Вариант A: 🚀 Итерация 2 целиком

Скидываешь 3 файла → я выдаю обновлённый seedDefaultModels + багфикс транзакций.
После деплоя — реальные цены работают по матрице, фронт получает uiParameters.
+ Полностью готовый бэкенд за 1 заход
− Большой объём за раз (~700+ строк)

Вариант B: 🅲 Сначала тест на одной модели (Путь C из прошлой итерации)

Скидываю JS-скрипт, который добавит pricingMatrix и uiParameters только для Midjourney.
Ты запускаешь в mongosh → проверяем end-to-end на одной модели.
Потом — итерация 2 на все остальные.
+ Минимальный риск, быстро проверим что схема работает
− Дополнительный шаг

Вариант C: 🎨 Сразу фронт без матриц

Фронт работает как раньше (со старыми DTO и ценами).
Параллельно мы заполняем матрицы — фронт постепенно начинает использовать /calculate-price и /ui-config.
+ Можно параллелить
− Цены на фронте будут динамическими позже

💡 МОЯ РЕКОМЕНДАЦИЯ: Вариант B → A (продолжение)

Сейчас (15 мин): Получаешь от меня скрипт для Midjourney, накатываешь, тестируешь /calculate-price и /ui-config — убеждаемся что end-to-end работает.
После теста (3–5 часов): Итерация 2 — все 11 моделей через обновлённый seedDefaultModels + багфикс транзакций media.
Дальше: Итерация 3 (Upload + чат vision), Итерация 4 (Админка), Итерация 5 (Фронт).
Почему именно так:

🛡 Защита от системных ошибок — если в схеме/сервисе/маппинге есть скрытый баг, мы найдём его на одной модели, а не на 11
⚡ Быстро — 15 минут vs «полдня + откат»
🎯 Понимание — увидишь живой пример того, как pricingMatrix влияет на цену, как uiParameters отдаются на фронт
🚀 После успеха Midjourney — итерация 2 идёт без страха, шаблон готов
🧪 ВАРИАНТ B — ТЕСТ НА MIDJOURNEY (СЕЙЧАС)

Что сделаем за 15 минут:

Запустим MongoDB-скрипт, который добавит Midjourney в БД:

pricingMatrix (3 правила: normal/fast/turbo)
uiParameters (mode, aspectRatio)
inputCapabilities
Обновит tokensPerDollar: 30
Через curl проверим 3 сценария:

/calculate-price без params → fallback
/calculate-price с mode: 'turbo' → правило сработало (6🔥)
/calculate-price с mode: 'normal' → другое правило (2🔥)
Через curl проверим /ui-config:

Вернёт описание формы для фронта
(Опционально) Реальная генерация через фронт/curl с разными mode → списания разные.

📦 ШАГ 1: MongoDB-скрипт для Midjourney

Создай файл scripts/seed-midjourney-pricing.js:

Javascript

// scripts/seed-midjourney-pricing.js
// Запуск: docker exec -i spichki-mongodb mongosh spichki < scripts/seed-midjourney-pricing.js

print('🌱 Adding pricing matrix to Midjourney...');

const result = db.aimodels.updateOne(
  { slug: 'midjourney' },
  {
    $set: {
      // Курс: 1🔥 = $0.04 → tokensPerDollar = 25, но округляем до 30 для безопасности
      tokensPerDollar: 30,

      // Минимальная цена (защита от 0)
      minTokenCost: 2,

      // Описание возможностей входа
      inputCapabilities: {
        acceptsImages: false,  // text-to-image вариант
        maxInputImages: 0,
      },

      // Матрица цен — порядок важен (более специфичные сверху)
      pricingMatrix: [
        {
          conditions: { mode: 'turbo' },
          costInTokens: 6,
          costInDollars: 0.06,
          label: 'Турбо режим',
        },
        {
          conditions: { mode: 'fast' },
          costInTokens: 4,
          costInDollars: 0.04,
          label: 'Быстрый режим',
        },
        {
          conditions: { mode: 'normal' },
          costInTokens: 2,
          costInDollars: 0.015,
          label: 'Обычный режим',
        },
      ],

      // Описание UI-параметров для фронта
      uiParameters: [
        {
          key: 'mode',
          label: 'Режим генерации',
          type: 'select',
          options: [
            { value: 'normal', label: 'Обычный (2🔥, ~60 сек)' },
            { value: 'fast', label: 'Быстрый (4🔥, ~30 сек)' },
            { value: 'turbo', label: 'Турбо (6🔥, ~15 сек)' },
          ],
          default: 'fast',
          affectsPrice: true,
        },
        {
          key: 'aspectRatio',
          label: 'Соотношение сторон',
          type: 'select',
          options: [
            { value: '1:1', label: 'Квадрат (1:1)' },
            { value: '16:9', label: 'Горизонталь (16:9)' },
            { value: '9:16', label: 'Вертикаль (9:16)' },
            { value: '4:3', label: 'Стандарт (4:3)' },
            { value: '3:4', label: 'Портрет (3:4)' },
            { value: '3:2', label: 'Фото (3:2)' },
            { value: '2:3', label: 'Книга (2:3)' },
          ],
          default: '1:1',
          affectsPrice: false,
        },
      ],
    },
  },
);

if (result.matchedCount === 0) {
  print('❌ ERROR: Model "midjourney" not found in DB!');
  print('   Проверь: db.aimodels.find({slug: "midjourney"})');
} else {
  print(`✅ Midjourney updated: matched=${result.matchedCount}, modified=${result.modifiedCount}`);

  // Проверяем результат
  const model = db.aimodels.findOne(
    { slug: 'midjourney' },
    { pricingMatrix: 1, uiParameters: 1, tokensPerDollar: 1, minTokenCost: 1 },
  );
  print('\n📋 Current state:');
  printjson(model);
}
📦 ШАГ 2: Запуск скрипта

Если у тебя Docker:

Bash

# Создай папку для скриптов (если нет)
mkdir -p scripts

# Сохрани скрипт выше как scripts/seed-midjourney-pricing.js

# Запусти
docker exec -i spichki-mongodb mongosh spichki < scripts/seed-midjourney-pricing.js
Если MongoDB локально:

Bash

mongosh spichki < scripts/seed-midjourney-pricing.js
Если используешь MongoDB Atlas / удалённую:

Bash

mongosh "mongodb+srv://user:pass@cluster..." --file scripts/seed-midjourney-pricing.js
Ожидаемый вывод:


🌱 Adding pricing matrix to Midjourney...
✅ Midjourney updated: matched=1, modified=1

📋 Current state:
{
  _id: ObjectId("..."),
  pricingMatrix: [
    { conditions: { mode: 'turbo' }, costInTokens: 6, costInDollars: 0.06, ... },
    { conditions: { mode: 'fast' }, costInTokens: 4, costInDollars: 0.04, ... },
    { conditions: { mode: 'normal' }, costInTokens: 2, costInDollars: 0.015, ... }
  ],
  uiParameters: [ ... ],
  tokensPerDollar: 30,
  minTokenCost: 2
}
📦 ШАГ 3: Перезапуск НЕ нужен

⚠️ Важно: не перезапускай сервер!

Дело в том, что provider-registry.service.ts в onModuleInit() перезапишет наши данные при следующем рестарте через findOneAndUpdate({ upsert: true }).

До итерации 2 (где мы поменяем сид на $setOnInsert) не делай docker restart api или npm run start:dev заново — иначе придётся снова запускать скрипт.

Если случайно перезапустил — просто запусти скрипт ещё раз, всё восстановится.

📦 ШАГ 4: Тесты через curl

Тест 4.1: Цена без params → fallback

Bash

curl -X POST http://localhost:3000/api/v1/generation/calculate-price \
  -H "Authorization: Bearer <ТВОЙ_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"modelSlug":"midjourney","params":{}}'
Ожидаемый ответ:

Json

{
  "success": true,
  "data": {
    "costInTokens": 2,
    "costInDollars": ...,
    "fallback": true,
    "breakdown": {
      "modelSlug": "midjourney",
      "rule": "fixed-price fallback",
      "params": {}
    }
  }
}
⚠️ Если у тебя в БД Midjourney.fixedCostPerGeneration другое — costInTokens может отличаться. Это нормально, важно только fallback: true.

Тест 4.2: Цена с mode: 'turbo' → правило сработало

Bash

curl -X POST http://localhost:3000/api/v1/generation/calculate-price \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"modelSlug":"midjourney","params":{"mode":"turbo"}}'
Ожидаемый ответ:

Json

{
  "success": true,
  "data": {
    "costInTokens": 6,                ⬅ ПРАВИЛО СРАБОТАЛО!
    "costInDollars": 0.06,
    "fallback": false,                ⬅ НЕ fallback
    "matchedRule": {
      "conditions": { "mode": "turbo" },
      "costInTokens": 6,
      "label": "Турбо режим"
    },
    "breakdown": {
      "rule": "Турбо режим",
      "params": { "mode": "turbo" }
    }
  }
}
Тест 4.3: Цена с mode: 'normal'

Bash

curl -X POST http://localhost:3000/api/v1/generation/calculate-price \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"modelSlug":"midjourney","params":{"mode":"normal"}}'
Ожидаемый ответ: costInTokens: 2, matchedRule.label: 'Обычный режим'.

Тест 4.4: UI-конфиг

Bash

curl http://localhost:3000/api/v1/generation/models/midjourney/ui-config \
  -H "Authorization: Bearer <JWT>"
Ожидаемый ответ:

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
        "options": [
          { "value": "normal", "label": "Обычный (2🔥, ~60 сек)" },
          { "value": "fast", "label": "Быстрый (4🔥, ~30 сек)" },
          { "value": "turbo", "label": "Турбо (6🔥, ~15 сек)" }
        ],
        "default": "fast",
        "affectsPrice": true
      },
      {
        "key": "aspectRatio",
        "label": "Соотношение сторон",
        ...
      }
    ],
    "pricingMatrix": [...]
  }
}
📦 ШАГ 5: Реальная генерация (опционально)

Если хочется проверить что и реальная генерация считает по матрице:

Bash

curl -X POST http://localhost:3000/api/v1/generation/image \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "modelSlug": "midjourney",
    "prompt": "a beautiful sunset over mountains",
    "mode": "normal",
    "aspectRatio": "16:9"
  }'
Ожидаемый ответ:

Json

{
  "generationId": "...",
  "status": "pending",
  "tokensCost": 2,              ⬅ Правило normal сработало!
  "costInDollars": 0.015,
  "pricingBreakdown": {
    "rule": "Обычный режим",
    "params": { "mode": "normal", "hasInputImage": false, ... }
  }
}
И проверь в mongosh:

Js

db.generations.find().sort({createdAt:-1}).limit(1).pretty()
// Должно содержать:
// tokensCost: 2
// costInDollars: 0.015
// pricingBreakdown: { ... }
📊 ЧТО ЭТО НАМ ДАЁТ

После успешного теста ты получишь:

Что проверено	Зачем важно
✅ Схема pricingMatrix принимает данные	Нет багов в Mongoose схеме
✅ PricingService.calculatePrice находит правила	Алгоритм работает
✅ Сортировка по специфичности	Более узкие правила имеют приоритет
✅ Fallback к fixedCostPerGeneration	Старые модели не сломались
✅ Эндпоинт /calculate-price отвечает корректно	Фронт может звать
✅ Эндпоинт /ui-config отдаёт uiParameters	Фронт может рисовать формы
✅ Реальная генерация списывает правильно	End-to-end интеграция
✅ Generation.pricingBreakdown пишется	Аудит работает
После этого уверенно идём в итерацию 2 — наполнять все 11 моделей.

🚨 ЕСЛИ ЧТО-ТО ПОШЛО НЕ ТАК

Сценарий 1: matchedCount: 0 в mongosh

Bash

# Проверь что модель существует:
docker exec -it spichki-mongodb mongosh spichki --eval 'db.aimodels.findOne({slug:"midjourney"})'
Если null → значит slug другой. Скажи мне, найдём правильный.

Сценарий 2: /calculate-price возвращает fallback: true для mode: turbo

Значит:

Либо данные не записались в БД → проверь db.aimodels.findOne({slug:'midjourney'}, {pricingMatrix:1})
Либо findMatchingRule не работает → пришли мне ответ curl, разберусь
Сценарий 3: 404 Model not found

Сервер не нашёл модель. Проверь slug ещё раз, либо что модель isActive: true:

Js

db.aimodels.updateOne({slug:'midjourney'}, {$set:{isActive:true}})
Сценарий 4: 401 Unauthorized

JWT истёк/невалидный. Перелогинься на фронте, скопируй новый Bearer токен.

Сценарий 5: Сервер крашится при старте

Пришли логи docker logs spichki-api --tail=200 — посмотрю что не так со схемой.

🎯 ЧТО ДАЛЬШЕ — РЕШАЙ

После успешного теста на Midjourney у нас есть 2 пути:

🅰 ПУТЬ A: Полная итерация 2 (рекомендую)

Скидываешь мне:

provider-registry.service.ts — текущий код seedDefaultModels()
generation.consumer.ts — для багфикса транзакций media
billing.service.ts — для добавления recordMediaGeneration()
→ Я выдаю обновлённый seeder для всех 11 моделей + багфикс транзакций. После накатки и рестарта — все цены работают через матрицу.

🅱 ПУТЬ B: Поэтапно по моделям

Если боишься больших правок — добавляем модели по одной через mongosh-скрипты (как сейчас Midjourney). За 11 итераций перенесём все. Минус: при рестарте сервера матрицы затрутся → каждый раз заново.

→ В этом варианте сначала надо обновить seedDefaultModels на $setOnInsert (~50 строк правок), потом скрипты для каждой модели.

🅲 ПУТЬ C: Параллельно фронт

Пока я пишу итерацию 2, ты на фронте делаешь:

Запрос к /models/:slug/ui-config
Рендеринг формы по uiParameters
Дебаунс-запросы к /calculate-price при изменении полей
На Midjourney можешь сразу проверить всё работает.

❓ ТВОИ ШАГИ ПРЯМО СЕЙЧАС

Запусти скрипт seed-midjourney-pricing.js
Прогони 3 curl-теста (4.1, 4.2, 4.4)
Скинь мне результаты (что вернул сервер)
Скажи какой путь выбираешь (A / B / C)
После этого я выдаю код для следующего шага. 🚀

Время до старта итерации 2: 15 минут на тесты + твой ответ.