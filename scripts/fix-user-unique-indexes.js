// scripts/fix-user-unique-indexes.js
//
// Ставит уникальные индексы users.telegramId / email / googleId вместо
// обычных, которые годами лежали в базе из-за ошибки в схеме (подробности —
// комментарий у UserSchema.index в user.schema.ts).
//
// Запуск (mongosh внутри ai-mongo):
//   mongosh ... ai-aggregator --quiet --eval 'load("/tmp/fix-user-unique-indexes.js")'
//
// Для каждого поля:
//   - есть дубли — ничего не трогаем, печатаем их (разбирать вручную);
//   - уже есть нужный уникальный индекс — пропускаем;
//   - иначе удаляем старый индекс и сразу создаём уникальный. Если создание
//     всё же упало — возвращаем старый, чтобы поиск при входе не остался
//     без индекса.
// Повторный запуск безопасен.

/* global db, print, printjson */

const FIELDS = [
  { field: 'telegramId', filter: { telegramId: { $gt: 0 } }, oldOpts: { sparse: true } },
  { field: 'email', filter: { email: { $gt: '' } }, oldOpts: { sparse: true } },
  { field: 'googleId', filter: { googleId: { $gt: '' } }, oldOpts: { sparse: true } },
];

for (const { field, filter, oldOpts } of FIELDS) {
  print(`\n── ${field}`);
  const existing = db.users.getIndexes().filter(
    (i) => Object.keys(i.key).length === 1 && i.key[field] === 1,
  );

  if (existing.some((i) => i.unique)) {
    print('  уникальный индекс уже есть — пропускаю');
    continue;
  }

  const dups = db.users
    .aggregate([
      { $match: filter },
      { $group: { _id: `$${field}`, n: { $sum: 1 }, ids: { $push: '$_id' } } },
      { $match: { n: { $gt: 1 } } },
      { $limit: 20 },
    ])
    .toArray();

  if (dups.length) {
    print(`  ДУБЛИ (${dups.length}+) — индекс не меняю, нужно разобрать вручную:`);
    dups.forEach((d) => print(`    ${d._id}  x${d.n}  ${d.ids.join(', ')}`));
    continue;
  }

  for (const i of existing) {
    db.users.dropIndex(i.name);
    print(`  удалён старый ${i.name}`);
  }

  try {
    db.users.createIndex(
      { [field]: 1 },
      { name: `${field}_1`, unique: true, partialFilterExpression: filter },
    );
    print(`  создан уникальный ${field}_1`);
  } catch (e) {
    print(`  НЕ СОЗДАН: ${e.message} — возвращаю обычный индекс`);
    db.users.createIndex({ [field]: 1 }, { name: `${field}_1`, ...oldOpts });
  }
}

print('\nИтог:');
db.users
  .getIndexes()
  .filter((i) => ['telegramId', 'email', 'googleId'].some((f) => i.key[f] === 1))
  .forEach((i) => print(`  ${i.name}  unique=${!!i.unique}  filter=${JSON.stringify(i.partialFilterExpression || null)}`));
print('');
