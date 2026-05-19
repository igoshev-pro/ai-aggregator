// scripts/seed-midjourney-pricing.js
print('🌱 Adding pricing matrix to Midjourney...');

const result = db.aimodels.updateOne(
  { slug: 'midjourney' },
  {
    $set: {
      tokensPerDollar: 30,
      minTokenCost: 2,

      inputCapabilities: {
        acceptsImages: false,
        maxInputImages: 0,
      },

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
  
  const model = db.aimodels.findOne(
    { slug: 'midjourney' },
    { pricingMatrix: 1, uiParameters: 1, tokensPerDollar: 1, minTokenCost: 1 },
  );
  print('\n📋 Current state:');
  printjson(model);
}