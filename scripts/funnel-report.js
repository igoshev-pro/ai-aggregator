// scripts/funnel-report.js
//
// Воронка «регистрация → использование → баланс на нуле → попытка оплаты → оплата».
// ТОЛЬКО ЧТЕНИЕ: ничего не пишет и не удаляет. Личных данных не печатает,
// только агрегаты.
//
// Запуск на сервере (из папки, где лежит файл):
//   docker cp funnel-report.js ai-mongo:/tmp/funnel-report.js
//   docker exec ai-mongo sh -c 'mongosh -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" \
//     --authenticationDatabase admin ai-aggregator --quiet --eval "load(\"/tmp/funnel-report.js\")"'
//
// Когорта последних N дней: добавить DAYS=30; перед load(...).

/* global db, print */

const days = typeof DAYS === 'number' ? DAYS : 0;
const since = days ? new Date(Date.now() - days * 864e5) : new Date(0);
const PAY_TYPES = ['deposit', 'subscription'];

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');
const line = (label, n, base) =>
  print(`  ${label.padEnd(46, '.')} ${String(n).padStart(7)}  ${base != null ? pct(n, base) : ''}`);
const h = (t) => print(`\n=== ${t} ===`);
const agg = (coll, pipe) => db.getCollection(coll).aggregate(pipe, { allowDiskUse: true }).toArray();

// ─── Когорта ───────────────────────────────────────────────────────
const userMatch = {
  createdAt: { $gte: since },
  isDeleted: { $ne: true },
  role: { $nin: ['admin', 'moderator'] },
};
const cohort = db.users.find(userMatch, { _id: 1 }).toArray().map((u) => u._id);
const cohortSet = new Set(cohort.map(String));
const inCohort = (ids) => ids.filter((id) => id && cohortSet.has(String(id)));
const N = cohort.length;

print(`Отчёт ${new Date().toISOString().slice(0, 16)} · когорта: ${days ? `последние ${days} дн.` : 'все время'} · пользователей ${N}`);

h('Откуда регистрируются');
agg('users', [
  { $match: userMatch },
  { $group: { _id: '$authProvider', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]).forEach((r) => line(String(r._id), r.n, N));

h('Регистрации по неделям (последние 10)');
agg('users', [
  { $match: userMatch },
  { $group: { _id: { $dateToString: { format: '%G-W%V', date: '$createdAt' } }, n: { $sum: 1 } } },
  { $sort: { _id: -1 } },
  { $limit: 10 },
]).forEach((r) => line(r._id, r.n));

// ─── Шаги воронки ──────────────────────────────────────────────────
const genAny = inCohort(db.generations.distinct('userId', { createdAt: { $gte: since } }));
const genOk = inCohort(db.generations.distinct('userId', { createdAt: { $gte: since }, status: 'completed' }));
const chatUsers = inCohort(db.messages.distinct('userId', { createdAt: { $gte: since }, role: 'user' }));
const active = new Set([...genAny, ...chatUsers].map(String));
const spentAny = inCohort(db.transactions.distinct('userId', { type: 'generation' }));

const drained = db.users.countDocuments({
  ...userMatch,
  totalTokensSpent: { $gt: 0 },
  tokenBalance: { $lte: 0.5 },
  bonusTokens: { $lte: 0.5 },
  cashbackBalance: { $lte: 0.5 },
});

const tried = inCohort(db.transactions.distinct('userId', { type: { $in: PAY_TYPES } }));
const paid = inCohort(db.transactions.distinct('userId', { type: { $in: PAY_TYPES }, paymentStatus: 'completed' }));

h('Воронка');
line('1. Зарегистрировались', N, N);
line('2. Хоть что-то сделали (генерация или чат)', active.size, N);
line('   — писали в чат', chatUsers.length, N);
line('   — запускали генерацию (картинка/видео/музыка)', genAny.length, N);
line('   — получили готовую генерацию', genOk.length, N);
line('3. Потратили хоть одну спичку', spentAny.length, N);
line('4. Баланс на нуле (всё потратили)', drained, N);
line('5. Нажали «оплатить» (создан платёж)', tried.length, N);
line('6. Оплатили', paid.length, N);

h('Платёжные попытки: статус × провайдер (все время)');
agg('transactions', [
  { $match: { type: { $in: PAY_TYPES } } },
  {
    $group: {
      _id: { p: '$paymentProvider', s: '$paymentStatus', t: '$type' },
      n: { $sum: 1 },
      rub: { $sum: { $ifNull: ['$paymentAmountRub', 0] } },
    },
  },
  { $sort: { n: -1 } },
]).forEach((r) => line(`${r._id.t} · ${r._id.p} · ${r._id.s} (${Math.round(r.rub)} ₽)`, r.n));

h('Последние 15 платёжных попыток (без личных данных)');
db.transactions
  .find({ type: { $in: PAY_TYPES } }, { createdAt: 1, paymentProvider: 1, paymentStatus: 1, paymentAmountRub: 1, description: 1, 'metadata.error': 1, 'metadata.failReason': 1 })
  .sort({ createdAt: -1 })
  .limit(15)
  .forEach((t) =>
    print(
      `  ${t.createdAt.toISOString().slice(0, 16)}  ${String(t.paymentProvider).padEnd(10)} ${String(t.paymentStatus).padEnd(9)} ${String(t.paymentAmountRub ?? '').padStart(5)} ₽  ${t.description}` +
        (t.metadata && (t.metadata.error || t.metadata.failReason) ? `  ERR: ${t.metadata.error || t.metadata.failReason}` : ''),
    ),
  );

h('Начислено вручную / промокодами / рефералкой (спички)');
agg('transactions', [
  { $match: { type: { $in: ['admin_adjustment', 'promo_code', 'referral_bonus'] } } },
  { $group: { _id: '$type', n: { $sum: 1 }, amount: { $sum: '$amount' } } },
]).forEach((r) => line(`${r._id} (${Math.round(r.amount)} спичек)`, r.n));

// ─── Что люди делают ───────────────────────────────────────────────
h('Генерации по типам (когорта)');
agg('generations', [
  { $match: { createdAt: { $gte: since } } },
  { $group: { _id: { t: '$type', s: '$status' }, n: { $sum: 1 } } },
  { $sort: { n: -1 } },
]).forEach((r) => line(`${r._id.t} · ${r._id.s}`, r.n));

h('Топ-15 моделей генерации (завершённые)');
agg('generations', [
  { $match: { createdAt: { $gte: since }, status: 'completed' } },
  { $group: { _id: '$modelSlug', n: { $sum: 1 }, users: { $addToSet: '$userId' } } },
  { $project: { n: 1, u: { $size: '$users' } } },
  { $sort: { n: -1 } },
  { $limit: 15 },
]).forEach((r) => line(`${r._id} (людей: ${r.u})`, r.n));

h('Топ-10 моделей чата (сообщения пользователей)');
agg('conversations', [
  { $match: { createdAt: { $gte: since } } },
  { $group: { _id: '$modelSlug', msgs: { $sum: '$messageCount' }, users: { $addToSet: '$userId' } } },
  { $project: { msgs: 1, u: { $size: '$users' } } },
  { $sort: { u: -1 } },
  { $limit: 10 },
]).forEach((r) => line(`${r._id} (сообщений: ${r.msgs})`, r.u));

h('Куда ушли спички (списания по типу генерации)');
agg('transactions', [
  { $match: { type: 'generation', createdAt: { $gte: since } } },
  { $group: { _id: { $ifNull: ['$generationType', 'chat/—'] }, n: { $sum: 1 }, spent: { $sum: { $abs: '$amount' } } } },
  { $sort: { spent: -1 } },
]).forEach((r) => line(`${r._id} (${Math.round(r.spent)} спичек)`, r.n));

// ─── Удержание ─────────────────────────────────────────────────────
h('Возвращаются ли (зарегистрированы > 7 дней назад)');
const old = { ...userMatch, createdAt: { $gte: since, $lt: new Date(Date.now() - 7 * 864e5) } };
const oldN = db.users.countDocuments(old);
line('Пользователей старше 7 дней', oldN, oldN);
line('Активны за последние 7 дней', db.users.countDocuments({ ...old, lastActiveAt: { $gte: new Date(Date.now() - 7 * 864e5) } }), oldN);
line('Активны за последние 30 дней', db.users.countDocuments({ ...old, lastActiveAt: { $gte: new Date(Date.now() - 30 * 864e5) } }), oldN);
line('Ни разу не вернулись (lastActive < created+1 день)', agg('users', [
  { $match: old },
  { $match: { $expr: { $lt: [{ $ifNull: ['$lastActiveAt', '$createdAt'] }, { $add: ['$createdAt', 864e5] }] } } },
  { $count: 'n' },
])[0]?.n || 0, oldN);

h('Остатки бонусных спичек у тех, кто ничего не тратил');
agg('users', [
  { $match: { ...userMatch, totalTokensSpent: { $lte: 0 } } },
  { $group: { _id: '$bonusTokens', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
  { $limit: 5 },
]).forEach((r) => line(`bonusTokens = ${r._id}`, r.n, N));

print('\nГотово. Скрипт ничего не менял.');
