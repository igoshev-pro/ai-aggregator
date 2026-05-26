📦 Контекст: Backend (NestJS) — Блок 17: Scripts (Migrations & Seeds)

🗂️ Структура скриптов


src/scripts/
├── migrate-token-system.ts      TypeScript, NestJS context
├── seed-billing.ts              TypeScript, NestJS context
└── (внешний) seed-midjourney-pricing.js   MongoDB shell script (mongosh)
📄 migrate-token-system.ts

Назначение


Одноразовая миграция схемы БД при переходе на новую систему токенов.
Добавляет новые поля к существующим документам без удаления старых.
Подключение к БД

Typescript

const app = await NestFactory.createApplicationContext(AppModule);
const mongoose = app.get('DatabaseConnection');

// ⚠️ app.get('DatabaseConnection') — строковый токен
//    В NestJS + @nestjs/mongoose стандартный токен: getConnectionToken()
//    или 'DatabaseConnection' если зарегистрирован вручную в AppModule
//    Если токен не совпадёт → runtime error при запуске миграции
//    Нет проверки что mongoose !== undefined перед вызовом .model()

const modelModel = mongoose.model('AIModel');
const generationModel = mongoose.model('Generation');
const messageModel = mongoose.model('Message');
const transactionModel = mongoose.model('Transaction');
// ⚠️ Имена моделей ('AIModel', 'Generation' и т.д.) — строки без проверки
//    Если модель не зарегистрирована в mongoose — ошибка в runtime
Шаг 1: Обновление AIModel

Typescript

// Загружает ВСЕ документы в память:
const models = await modelModel.find({});

// Для каждой модели проверяет 4 поля, при необходимости вычисляет и сохраняет

// ⚠️ model.find({}) — full collection scan, все документы в RAM
//    При большом количестве моделей — проблема памяти
//    Правильно: updateMany с вычислением через MongoDB aggregation pipeline
//    или find({}).cursor() для потоковой обработки

// ⚠️ model.save() внутри цикла → N последовательных write-запросов
//    При 100 моделях = 100 round-trips к MongoDB
//    Нет bulkWrite / Promise.all

// Логика вычисления costPerMillionInputTokens:
if (model.type === 'text') {
  model.costPerMillionInputTokens = model.tokenCost ? model.tokenCost * 0.5 : 1;
  model.costPerMillionOutputTokens = model.tokenCost ? model.tokenCost * 2 : 5;
}
// ⚠️ Коэффициенты (0.5, 2, 1, 5) — магические числа без объяснения
//    Откуда взялся коэффициент 0.5 для input и 2 для output?
//    Нет документации формулы пересчёта

// fixedCostPerGeneration:
model.fixedCostPerGeneration = model.tokenCost ? model.tokenCost * 0.01 : 0.05;
// ⚠️ Коэффициент 0.01 — магическое число (1 токен = $0.01?)
//    При tokenCost = 4 (Midjourney fast) → fixedCostPerGeneration = 0.04
//    Совпадает с pricingMatrix в seed-midjourney-pricing.js → корректно

// tokensPerDollar:
model.tokensPerDollar = model.type === 'text' ? 1000 : 100;
// ⚠️ Одно значение для всех text-моделей и одно для всех media
//    GPT-4o и GPT-3.5 имеют разные tokensPerDollar, но оба = 1000
Шаги 2-4: updateMany для коллекций

Typescript

// Generation, Message, Transaction — updateMany с $exists: false
// ✅ Корректный идемпотентный паттерн: запускай сколько угодно раз
// ✅ Атомарные операции на стороне MongoDB
// ✅ Нет загрузки данных в память

// ⚠️ Нет транзакции (MongoDB session/transaction)
//    Если миграция упадёт на шаге 3 — шаги 1-2 уже применены,
//    шаги 3-4 нет. Повторный запуск: шаги 1-2 (needsUpdate=false),
//    шаги 3-4 применятся. Для $exists: false это идемпотентно — ОК.
//    Для шага 1 (model.save() при undefined) — тоже идемпотентно,
//    т.к. после первого сохранения поле уже существует.
//    Частичная применимость не критична для этой миграции.

// ⚠️ Нет логирования количества обновлённых документов:
//    updateMany возвращает { modifiedCount, matchedCount }
//    В логах только "Updating generations..." без итогов
Error handling

Typescript

catch (error) {
  logger.error(`❌ Migration failed: ${error.message}`);
  process.exit(1);
}
// ⚠️ app.close() не вызывается при ошибке — соединение с MongoDB
//    остаётся открытым до завершения процесса через process.exit(1)
//    Нужен try/finally:
//    finally { await app.close(); }
📄 seed-billing.ts

Назначение


Заполняет коллекции SubscriptionPlan и TokenPackage начальными данными.
Идемпотентный: повторный запуск не создаёт дубликаты ($setOnInsert).
Данные: Планы подписки (PLANS)

Typescript

// 4 плана: basic(450₽), plus(990₽), max(2490₽), ultimate(5990₽)

// Соотношение цена/токены:
// basic:    450₽ / 150 токенов = 3.0 ₽/токен
// plus:     990₽ / 330 токенов = 3.0 ₽/токен
// max:     2490₽ / 830 токенов = 3.0 ₽/токен
// ultimate:5990₽ /1997 токенов = 3.0 ₽/токен
// ✅ Единообразная ценовая политика по токенам

// Бонусные токены при подписке:
// basic: 0, plus: 0, max: +50, ultimate: +220

// freeModels для plus/max/ultimate:
// Содержат modelSlug строками — нет проверки что slug существует в AIModel
// Если slug изменится — freeModels содержат невалидные ссылки без ошибки

// ⚠️ maxDailyGenerations для max и ultimate: 999999
//    Семантически "безлимит", но хранится как число
//    При проверке в сервисе: user.dailyGenerations < 999999
//    При 999999 генерациях в день — лимит всё равно сработает
//    Нужна явная константа UNLIMITED = -1 или null + отдельная проверка

// ⚠️ capabilities — строки для отображения, хардкод количеств:
//    'Генерация 125 изображений' для basic
//    Эти числа вычислены из tokensPerMonth / стоимости одной генерации
//    При изменении стоимости моделей — capabilities устареют
//    без какой-либо ошибки (просто неверная маркетинговая информация)
Данные: Пакеты токенов (PACKAGES)

Typescript

// 5 пакетов: 100, 300, 700, 1500, 5000 токенов

// Соотношение цена/токен:
// pack_100:  99₽  / 100  = 0.99 ₽/токен
// pack_300:  249₽ / 300  = 0.83 ₽/токен
// pack_700:  499₽ / 700  = 0.71 ₽/токен
// pack_1500: 899₽ / 1500 = 0.60 ₽/токен
// pack_5000: 2499₽/ 5000 = 0.50 ₽/токен
// ✅ Прогрессивная скидка при увеличении пакета

// ⚠️ Подписки стоят 3 ₽/токен, пакеты — 0.5-0.99 ₽/токен
//    Пакеты дешевле подписок в 3-6 раз
//    Это намеренная модель или ценовая ошибка?
//    basic: 450₽ за 150 токенов vs pack_300: 249₽ за 300 токенов
//    → подписка в 6 раз дороже пакетов при равном количестве токенов
//    Если это намеренно (freeModels, features) — нужен комментарий
Механизм seed

Typescript

await planModel.updateOne(
  { planKey: plan.planKey },
  { $setOnInsert: plan },
  { upsert: true },
);

// ✅ $setOnInsert — создаёт только если не существует, не перезаписывает
// ✅ Идемпотентный: повторный запуск безопасен
// ⚠️ Нельзя обновить существующий план через seed
//    Если priceRub изменился — нужно удалить документ и перезапустить seed,
//    или добавить отдельный "force update" режим
//    Нет флага --force или --update для принудительного обновления
Импорт путей

Typescript

import { AppModule } from '../src/app.module';
// ⚠️ Путь '../src/app.module' — скрипт находится в корне проекта (не в src/)
//    migrate-token-system.ts использует '../app.module' (без src/)
//    Два скрипта используют разные пути к одному модулю
//    Один из путей неверен в зависимости от расположения скрипта
//    Нужно проверить реальное расположение файлов
📄 seed-midjourney-pricing.js (MongoDB Shell)

Назначение


mongosh-скрипт для прямого обновления документа aimodels.
Добавляет pricingMatrix и uiParameters для Midjourney.
Структура данных

Javascript

// pricingMatrix: 3 режима
{ conditions: { mode: 'turbo'  }, costInTokens: 6, costInDollars: 0.06 }
{ conditions: { mode: 'fast'   }, costInTokens: 4, costInDollars: 0.04 }
{ conditions: { mode: 'normal' }, costInTokens: 2, costInDollars: 0.015 }

// uiParameters: mode + aspectRatio
// mode.default = 'fast'
// aspectRatio: 7 вариантов

// ⚠️ Несоответствие: normal режим
//    costInTokens: 2, costInDollars: 0.015
//    tokensPerDollar = 30 → 2 токена = $0.0667
//    Но costInDollars = 0.015 → несоответствие конвертации
//    fast: 4 токена * (1/30) = $0.0333 ≠ $0.04 (тоже несоответствие)
//    turbo: 6 токена * (1/30) = $0.02 ≠ $0.06
//    Курс tokensPerDollar = 30 не согласуется с costInDollars в pricingMatrix

// ⚠️ $set перезаписывает существующие данные (в отличие от seed-billing.ts)
//    Повторный запуск: все поля будут перезаписаны актуальными значениями
//    ✅ Это правильно для "update pricing" скрипта
Запуск

Bash

# Не указан в скрипте, стандартно:
mongosh <connection-string> seed-midjourney-pricing.js

# ⚠️ Нет инструкции по запуску в комментарии скрипта
#    (в отличие от seed-billing.ts с подробным JSDoc)
# ⚠️ Нет проверки подключения к нужной БД
#    Если запустить против prod вместо dev — изменения применятся сразу
⚠️ Замеченные проблемы

🔴 Критичные

app.close() не вызывается при ошибке в migrate-token-system.ts — при исключении в любом шаге миграции catch вызывает process.exit(1) без предварительного app.close(). Соединение с MongoDB не закрывается корректно, открытые сессии висят до таймаута. При частом запуске с ошибками (отладка) — исчерпание connection pool. Нужен try/finally { await app.close(); }.

Несоответствие tokensPerDollar и costInDollars в Midjourney — tokensPerDollar: 30 означает 1 доллар = 30 токенов. normal: costInTokens: 2 → должно быть $0.067, но записано $0.015. fast: 4 токена → должно быть $0.133, записано $0.04. turbo: 6 токенов → $0.2, записано $0.06. Если costInDollars используется для расчёта реальных затрат — данные неверны. Если costInTokens — конвертация в доллары некорректна.

Ценовой дисбаланс подписки vs пакеты — подписки стоят ~3 ₽/токен, пакеты 0.5-0.99 ₽/токен. Базовый план basic (450₽/150 токенов) в 4 раза дороже pack_300 (249₽/300 токенов). Если это намеренно (freeModels, noWatermark, maxDailyGenerations) — нужен явный бизнес-комментарий. Если ошибка — tokensPerMonth в планах занижен в 4-6 раз.

🟡 Средние

Строковый токен app.get('DatabaseConnection') — нет гарантии что этот токен зарегистрирован в DI. Если AppModule использует MongooseModule.forRoot() — правильный токен getConnectionToken() или getConnectionToken('default'). При несовпадении — Error: Nest could not find DatabaseConnection element при запуске миграции.

model.find({}) + model.save() в цикле — загрузка всех AIModel в память + N последовательных write-запросов. При 200+ моделях и медленной сети — миграция может занять минуты. Нужен bulkWrite или updateMany с $set + условие $or: [{ field: { $exists: false } }].

maxDailyGenerations: 999999 вместо явного "безлимит" — число используется в сравнении dailyGenerations < maxDailyGenerations. При 999999+ генерациях лимит сработает. Нужно null или -1 как сигнал "без лимита" с отдельной проверкой в checkDailyLimit.

capabilities хардкодом — строки 'Генерация 125 изображений' вычислены из tokensPerMonth / цена_генерации. При изменении стоимости модели числа устареют без предупреждения. Эти строки маркетинговые — их обновление должно быть явным при изменении тарифов.

Путь импорта '../src/app.module' vs '../app.module' — seed-billing.ts импортирует из '../src/app.module', migrate-token-system.ts из '../app.module'. Если оба файла в src/scripts/ — правильный путь '../app.module', и в seed-billing.ts путь неверен. Нужна унификация.

$setOnInsert без возможности обновления — повторный запуск seed-billing.ts не обновляет существующие планы. При изменении priceRub или features — нужно вручную удалять документы или добавлять режим --update. Нет документации этого ограничения.

🟢 Минорные

Магические числа в migrate-token-system.ts — коэффициенты 0.5, 2, 0.01, 0.05 для пересчёта старых полей в новые не документированы. Неясно откуда взяты эти значения. Нужны комментарии с объяснением формулы.

Нет логирования modifiedCount — updateMany возвращает { modifiedCount, matchedCount }, но скрипт логирует только 'Updating generations...' без итогов. Неясно сколько документов фактически обновлено. Нужен logger.log(Updated ${result.modifiedCount} generations).

seed-midjourney-pricing.js — нет инструкции по запуску — seed-billing.ts имеет подробный JSDoc с командами запуска. seed-midjourney-pricing.js — нет. Нужен аналогичный комментарий с mongosh <uri> <script>.

Нет проверки окружения перед запуском — ни один скрипт не проверяет NODE_ENV. При случайном запуске в production — изменения применятся к prod-базе. Нужна проверка if (process.env.NODE_ENV === 'production') { require confirmation } или флаг --prod-confirm.