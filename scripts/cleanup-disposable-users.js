// scripts/cleanup-disposable-users.js
//
// Удаляет аккаунты, которыми фармили бонусные спички:
//   - зарегистрированные на временную почту;
//   - дубли одного ящика (a.b.c@gmail.com, abc@gmail.com, abc+1@gmail.com —
//     один и тот же Gmail): в группе остаётся один, самый старый.
// Запускается в mongosh внутри контейнера ai-mongo.
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

// Копия canonicalEmail из users.service.ts — менять вместе.
const GMAIL = new Set(['gmail.com', 'googlemail.com']);
const YANDEX = new Set(['yandex.ru', 'ya.ru', 'yandex.com', 'yandex.by', 'yandex.kz', 'yandex.ua']);
function canonicalEmail(email) {
  const n = String(email || '').trim().toLowerCase();
  const at = n.lastIndexOf('@');
  if (at <= 0) return n;
  let local = n.slice(0, at);
  let domain = n.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL.has(domain)) { local = local.replace(/\./g, ''); domain = 'gmail.com'; }
  else if (YANDEX.has(domain)) { local = local.replace(/-/g, '.'); domain = 'yandex.ru'; }
  return `${local}@${domain}`;
}

// Ящики, чью группу сносим целиком, включая самый старый аккаунт:
//   --eval 'PURGE=["aleksleba627@gmail.com"]; load(...)'
// Указывать в каноническом виде (как в отчёте «Крупнейшие группы дублей»).
const PURGE_SET = new Set(
  (typeof PURGE !== 'undefined' && Array.isArray(PURGE) ? PURGE : []).map((e) => canonicalEmail(e)),
);

// ── 1. Все пользователи с почтой ────────────────────────────────────
const all = db.users
  .find(
    { email: { $type: 'string', $ne: '' } },
    {
      email: 1, telegramId: 1, googleId: 1, role: 1, tokenBalance: 1,
      bonusTokens: 1, subscriptionPlan: 1, createdAt: 1, referredBy: 1,
    },
  )
  .toArray();

// ── 2. Кого удалять нельзя ни при каких условиях ────────────────────
const allIds = all.map((u) => u._id);
const paidIds = new Set(
  db.transactions
    .distinct('userId', {
      userId: { $in: allIds },
      type: { $in: ['deposit', 'subscription'] },
      paymentStatus: 'completed',
    })
    .map(String),
);
const withdrawalIds = new Set(
  db.withdrawals.distinct('userId', { userId: { $in: allIds } }).map(String),
);
const subIds = new Set(
  db.subscriptions.distinct('userId', { userId: { $in: allIds } }).map(String),
);

function protectReasons(u) {
  const id = String(u._id);
  const r = [];
  if (u.telegramId) r.push('есть Telegram');
  if (u.googleId) r.push('есть Google');
  if (u.role && u.role !== 'user') r.push(`роль ${u.role}`);
  if (paidIds.has(id)) r.push('платил');
  if (subIds.has(id) || (u.subscriptionPlan && u.subscriptionPlan !== 'free')) r.push('подписка');
  if (withdrawalIds.has(id)) r.push('вывод средств');
  // Ненулевой tokenBalance сам по себе ничего не значит: туда попадают
  // возвраты за упавшие генерации и т.п., у фармеров он тоже бывает.
  // Защищаем только по реальным оплатам (выше).
  return r;
}

// ── 3. Кандидаты ────────────────────────────────────────────────────
// а) временная почта;
// б) дубли одного ящика (a.b.c@gmail.com = abc@gmail.com = abc+1@gmail.com):
//    в группе оставляем защищённые аккаунты, а если таких нет — самый
//    старый; остальные — фарм.
const why = new Map(); // id -> { u, reason }

for (const u of all) {
  const domain = u.email.split('@').pop();
  if (domain && isDisposable(domain)) why.set(String(u._id), { u, reason: 'временная почта' });
}

const groups = {};
for (const u of all) {
  const c = canonicalEmail(u.email);
  (groups[c] = groups[c] || []).push(u);
}
const dupGroups = Object.entries(groups).filter(([c, us]) => us.length > 1 || PURGE_SET.has(c));
for (const [c, us] of dupGroups) {
  us.sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0));
  const hasProtected = us.some((u) => protectReasons(u).length);
  us.forEach((u, i) => {
    if (protectReasons(u).length) return;
    // Самый старый — оставляем, если группу не сносим целиком.
    if (!hasProtected && i === 0 && !PURGE_SET.has(c)) return;
    if (!why.has(String(u._id))) why.set(String(u._id), { u, reason: `дубль ${c}` });
  });
}

const toDelete = [];
const kept = [];
for (const { u, reason } of why.values()) {
  const reasons = protectReasons(u);
  (reasons.length ? kept : toDelete).push({ u, reason, reasons });
}

// ── 4. Отчёт ────────────────────────────────────────────────────────
const bonusSum = toDelete.reduce((s, { u }) => s + (u.bonusTokens || 0), 0);
const byReason = { disposable: 0, dup: 0 };
toDelete.forEach(({ reason }) => (reason === 'временная почта' ? byReason.disposable++ : byReason.dup++));

print(`\nДоменов в списке: ${blocked.size}`);
print(`Пользователей с почтой: ${all.length}`);
print(`К удалению: ${toDelete.length} (бонусных спичек на них: ${bonusSum})`);
print(`  временная почта: ${byReason.disposable}`);
print(`  дубли одного ящика: ${byReason.dup} (групп с дублями: ${dupGroups.length})`);
print(`Оставляем, хотя попали под подозрение: ${kept.length}`);

const byDomain = {};
toDelete
  .filter(({ reason }) => reason === 'временная почта')
  .forEach(({ u }) => {
    const d = u.email.split('@').pop();
    byDomain[d] = (byDomain[d] || 0) + 1;
  });
if (Object.keys(byDomain).length) {
  print('\nТоп временных доменов:');
  Object.entries(byDomain)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([d, n]) => print(`  ${String(n).padStart(5)}  ${d}`));
}

if (dupGroups.length) {
  print('\nКрупнейшие группы дублей (ящик — аккаунтов):');
  dupGroups
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 15)
    .forEach(([c, us]) => print(`  ${String(us.length).padStart(5)}  ${c}`));
}

if (kept.length) {
  print('\nНЕ удаляем (проверьте вручную):');
  kept.forEach(({ u, reason, reasons }) =>
    print(`  ${u._id}  ${u.email}  [${reason}] — ${reasons.join(', ')}`),
  );
}

print('\nПервые 20 к удалению:');
toDelete.slice(0, 20).forEach(({ u, reason }) =>
  print(`  ${u._id}  ${u.email}  бонус ${u.bonusTokens || 0}  ${u.createdAt ? u.createdAt.toISOString().slice(0, 10) : ''}  [${reason}]`),
);

if (!APPLY_MODE) {
  print('\nПРОБНЫЙ ПРОГОН — в базе ничего не изменено.');
  print('Для удаления запустите с APPLY=true.\n');
} else if (toDelete.length === 0) {
  print('\nУдалять нечего.\n');
} else {
  // ── 5. Удаление ───────────────────────────────────────────────────
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
