// scripts/failures-report.js
//
// Почему падают генерации: по каждой модели — сколько упало / прошло и
// самые частые тексты ошибок. ТОЛЬКО ЧТЕНИЕ, личных данных не печатает.
//
// Запуск на сервере (из папки, где лежит файл):
//   docker cp failures-report.js ai-mongo:/tmp/failures-report.js
//   docker exec ai-mongo sh -c 'mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" \
//     --authenticationDatabase admin ai-aggregator --quiet --eval "DAYS=30; load(\"/tmp/failures-report.js\")"' > failures.txt
//
// DAYS=30 — за последние 30 дней (по умолчанию 30).

/* global db, print */

const days = typeof DAYS === 'number' ? DAYS : 30;
const since = new Date(Date.now() - days * 864e5);
const h = (t) => print(`\n=== ${t} ===`);

print(`Отказы генераций ${new Date().toISOString().slice(0, 16)} · за ${days} дн.`);

const byModel = db.generations
  .aggregate([
    { $match: { createdAt: { $gte: since }, type: { $in: ['image', 'video', 'audio'] } } },
    {
      $group: {
        _id: { model: '$modelSlug', provider: '$providerSlug' },
        total: { $sum: 1 },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        stuck: { $sum: { $cond: [{ $in: ['$status', ['pending', 'processing']] }, 1, 0] } },
      },
    },
    { $sort: { failed: -1, total: -1 } },
  ])
  .toArray();

h('Модели: упало / прошло / зависло (всего)');
byModel.forEach((r) => {
  const pct = r.total ? Math.round((r.failed / r.total) * 100) : 0;
  print(
    `  ${(r._id.model + ' · ' + (r._id.provider || '?')).padEnd(46, '.')} ` +
      `упало ${String(r.failed).padStart(3)} (${String(pct).padStart(3)}%)  ok ${String(r.completed).padStart(3)}  ` +
      `висит ${String(r.stuck).padStart(2)}  всего ${r.total}`,
  );
});

h('Тексты ошибок по моделям (топ-5 на модель)');
const errs = db.generations
  .aggregate([
    { $match: { createdAt: { $gte: since }, status: 'failed' } },
    {
      $group: {
        _id: { model: '$modelSlug', err: { $substrCP: [{ $ifNull: ['$errorMessage', '(пусто)'] }, 0, 220] } },
        n: { $sum: 1 },
        last: { $max: '$createdAt' },
      },
    },
    { $sort: { '_id.model': 1, n: -1 } },
  ])
  .toArray();

let cur = null;
let shown = 0;
errs.forEach((e) => {
  if (e._id.model !== cur) {
    cur = e._id.model;
    shown = 0;
    print(`\n  [${cur}]`);
  }
  if (shown++ < 5) print(`    ${String(e.n).padStart(3)}×  ${e.last.toISOString().slice(0, 10)}  ${e._id.err}`);
});

h('Сырые ошибки провайдеров по моделям (providerError, топ-5 на модель)');
const rawErrs = db.generations
  .aggregate([
    { $match: { createdAt: { $gte: since }, status: 'failed', providerError: { $exists: true, $ne: null } } },
    {
      $group: {
        _id: {
          model: '$modelSlug',
          // без "· attempt 1/3", чтобы одинаковые ошибки склеивались
          // "[kie · attempt 1/3] текст" → "[kie] текст"
          err: {
            $concat: [
              { $arrayElemAt: [{ $split: ['$providerError', ' · '] }, 0] },
              '] ',
              {
                $substrCP: [
                  '$providerError',
                  { $add: [{ $indexOfCP: ['$providerError', '] '] }, 2] },
                  220,
                ],
              },
            ],
          },
        },
        n: { $sum: 1 },
        last: { $max: '$createdAt' },
      },
    },
    { $sort: { '_id.model': 1, n: -1 } },
  ])
  .toArray();

cur = null;
shown = 0;
rawErrs.forEach((e) => {
  if (e._id.model !== cur) {
    cur = e._id.model;
    shown = 0;
    print(`\n  [${cur}]`);
  }
  if (shown++ < 5) print(`    ${String(e.n).padStart(3)}×  ${e.last.toISOString().slice(0, 10)}  ${e._id.err}`);
});
if (!rawErrs.length) print('  (пока нет — поле providerError появилось с новой версией)');

h('Последние 30 упавших (модель · параметры без промта · ошибка · сырая ошибка)');
db.generations
  .find({ createdAt: { $gte: since }, status: 'failed' })
  .sort({ createdAt: -1 })
  .limit(30)
  .forEach((g) => {
    const p = g.params || {};
    const brief = {
      mode: p.mode,
      res: p.resolution,
      ar: p.aspectRatio,
      dur: p.duration,
      imgs: (p.inputUrls || p.imageUrls || []).length || undefined,
      vids: (p.videoUrls || []).length || undefined,
    };
    Object.keys(brief).forEach((k) => brief[k] === undefined && delete brief[k]);
    print(
      `  ${g.createdAt.toISOString().slice(0, 16)}  ${g.modelSlug} · ${g.providerSlug || '?'}  ` +
        `${JSON.stringify(brief)}  возврат=${g.isRefunded ? 'да' : 'НЕТ'}  ${(g.errorMessage || '(пусто)').slice(0, 200)}`,
    );
    if (g.providerError) print(`      ↳ провайдер: ${String(g.providerError).slice(0, 300)}`);
  });

h('Упавшие без возврата спичек');
print(
  '  ' +
    db.generations.countDocuments({
      createdAt: { $gte: since },
      status: 'failed',
      tokensDeducted: true,
      isRefunded: { $ne: true },
    }),
);

print('\nГотово. Скрипт ничего не менял.');
