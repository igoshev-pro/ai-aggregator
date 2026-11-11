// scripts/cleanup-disposable-users.js
//
// Удаляет аккаунты, зарегистрированные на временную почту (фарм бонусных
// спичек). Запускается в mongosh внутри контейнера ai-mongo.
//
//   Пробный прогон (ничего не меняет, только отчёт):
//     mongosh ... ai-aggregator --quiet --eval 'load("/tmp/cleanup-disposable-users.js")'
//   Удаление:
//     mongosh ... ai-aggregator --quiet --eval 'APPLY=true; load("/tmp/cleanup-disposable-users.js")'
//
// Рядом в /tmp должен лежать disposable-domains.ts — тот же список, что
// проверяет регистрацию (src/modules/auth/disposable-domains.ts).
//
// Кого НЕ трогаем, даже если почта временная (попадают в отдельный отчёт):
//   - кто хоть раз платил (deposit/subscription со статусом completed),
//     у кого есть подписка, заявка на вывод или ненулевой платный баланс;
//   - привязанные к Telegram или Google — это живой человек, почта вторична;
//   - не обычные пользователи (admin/moderator и т.п.).
//
// У удаляемых чистим их собственные данные: генерации, чаты, сообщения,
// избранное, загрузки, транзакции (там только списания за генерации —
// платящих мы пропускаем), запись «кто кого пригласил» и счётчик
// приглашённых у пригласившего. Файлы в S3 остаются — их немного, это
// мусор, а не данные пользователей.

/* global db, print, printjson, require */

const APPLY_MODE = typeof APPLY !== 'undefined' && APPLY === true;
const DOMAINS_FILE =
  typeof DOMAINS_PATH !== 'undefined' ? DOMAINS_PATH : '/tmp/disposable-domains.ts';

// Синхронизировать с EXTRA_DISPOSABLE_DOMAINS в email-domain-guard.service.ts
const EXTRA = [
  'temp-mail.io', 'tempmail.ninja', 'mohmal.com', 'tempmailo.com',
  'tempmail.dev', 'emailondeck.com', 'mail.tm', 'mail.gw',
];

const fs = require('fs');
const text = fs.readFileSync(DOMAINS_FILE, 'utf8');
const blocked = new Set(EXTRA);
for (const m of text.matchAll(/^\s*'([a-z0-9.-]+)',\s*$/gm)) blocked.add(m[1]);
if (blocked.size < 1000) {
  throw new Error(`В ${DOMAINS_FILE} нашлось всего ${blocked.size} доменов — файл не тот?`);
}

function isDisposable(domain) {
  const parts = domain.toLowerCase().replace(/\.$/, '').split('.');
  for (let i = 0; i <= parts.length - 2; i++) {
    if (blocked.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

// ── 1. Кандидаты: почта с временного домена ─────────────────────────
const candidates = [];
db.users
  .find(
    { email: { $type: 'string', $ne: '' } },
    {
      email: 1, telegramId: 1, googleId: 1, role: 1, tokenBalance: 1,
      bonusTokens: 1, subscriptionPlan: 1, createdAt: 1, referredBy: 1,
    },
  )
  .forEach((u) => {
    const domain = u.email.split('@').pop();
    if (domain && isDisposable(domain)) candidates.push(u);
  });

// ── 2. Отделяем тех, кого удалять нельзя ────────────────────────────
const ids = candidates.map((u) => u._id);
const paidIds = new Set(
  db.transactions
    .distinct('userId', {
      userId: { $in: ids },
      type: { $in: ['deposit', 'subscription'] },
      paymentStatus: 'completed',
    })
    .map(String),
);
const withdrawalIds = new Set(
  db.withdrawals.distinct('userId', { userId: { $in: ids } }).map(String),
);
const subIds = new Set(
  db.subscriptions.distinct('userId', { userId: { $in: ids } }).map(String),
);

const toDelete = [];
const kept = [];
for (const u of candidates) {
  const id = String(u._id);
  const reasons = [];
  if (u.telegramId) reasons.push('есть Telegram');
  if (u.googleId) reasons.push('есть Google');
  if (u.role && u.role !== 'user') reasons.push(`роль ${u.role}`);
  if (paidIds.has(id)) reasons.push('платил');
  if (subIds.has(id) || (u.subscriptionPlan && u.subscriptionPlan !== 'free')) reasons.push('подписка');
  if (withdrawalIds.has(id)) reasons.push('вывод средств');
  if ((u.tokenBalance || 0) > 0) reasons.push(`платный баланс ${u.tokenBalance}`);
  (reasons.length ? kept : toDelete).push({ u, reasons });
}

// ── 3. Отчёт ────────────────────────────────────────────────────────
const byDomain = {};
for (const { u } of toDelete) {
  const d = u.email.split('@').pop();
  byDomain[d] = (byDomain[d] || 0) + 1;
}
const bonusSum = toDelete.reduce((s, { u }) => s + (u.bonusTokens || 0), 0);

print(`\nДоменов в списке: ${blocked.size}`);
print(`Аккаунтов на временной почте: ${candidates.length}`);
print(`  к удалению: ${toDelete.length} (бонусных спичек на них: ${bonusSum})`);
print(`  оставляем: ${kept.length}`);

print('\nТоп доменов среди удаляемых:');
Object.entries(byDomain)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([d, n]) => print(`  ${String(n).padStart(5)}  ${d}`));

if (kept.length) {
  print('\nНЕ удаляем (проверьте вручную):');
  kept.forEach(({ u, reasons }) => print(`  ${u._id}  ${u.email}  — ${reasons.join(', ')}`));
}

print('\nПервые 20 к удалению:');
toDelete.slice(0, 20).forEach(({ u }) =>
  print(`  ${u._id}  ${u.email}  бонус ${u.bonusTokens || 0}  ${u.createdAt ? u.createdAt.toISOString().slice(0, 10) : ''}`),
);

if (!APPLY_MODE) {
  print('\nПРОБНЫЙ ПРОГОН — в базе ничего не изменено.');
  print('Для удаления запустите с APPLY=true.\n');
} else if (toDelete.length === 0) {
  print('\nУдалять нечего.\n');
} else {
  // ── 4. Удаление ───────────────────────────────────────────────────
  const delIds = toDelete.map(({ u }) => u._id);
  const q = { userId: { $in: delIds } };
  const res = {};

  // Счётчик приглашённых у тех, кто их привёл.
  const referrers = {};
  toDelete.forEach(({ u }) => {
    if (u.referredBy) referrers[String(u.referredBy)] = (referrers[String(u.referredBy)] || 0) + 1;
  });
  for (const [rid, n] of Object.entries(referrers)) {
    db.users.updateOne(
      { _id: ObjectId(rid) },
      [{ $set: { referralCount: { $max: [0, { $subtract: [{ $ifNull: ['$referralCount', 0] }, n] }] } } }],
    );
  }
  res.referrers_updated = Object.keys(referrers).length;
  res.referrals = db.referrals.deleteMany({ referredId: { $in: delIds } }).deletedCount;

  for (const c of ['generations', 'messages', 'conversations', 'favorites', 'useruploads', 'transactions']) {
    res[c] = db.getCollection(c).deleteMany(q).deletedCount;
  }
  res.users = db.users.deleteMany({ _id: { $in: delIds } }).deletedCount;

  print('\nУДАЛЕНО:');
  printjson(res);
  print('');
}
