/**
 * Запуск: npx ts-node -r tsconfig-paths/register src/scripts/seed-billing.ts
 * Или добавь в package.json:
 *   "seed:billing": "ts-node -r tsconfig-paths/register src/scripts/seed-billing.ts"
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SubscriptionPlanEntity,
  SubscriptionPlanDocument,
} from '../modules/billing/schemas/subscription-plan.schema';
import {
  TokenPackageEntity,
  TokenPackageDocument,
} from '../modules/billing/schemas/token-package.schema';

const PLANS = [
  {
    planKey: 'basic',
    name: 'Basic',
    priceRub: 450,
    tokensPerMonth: 150,
    bonusTokens: 0,
    modelsAccess: 'limited' as const,
    freeModels: [],
    features: {
      maxDailyGenerations: 50,
      priorityQueue: false,
      exclusiveModels: false,
      noWatermark: false,
      maxContextMessages: 20,
    },
    capabilities: [
      '1 500 запросов в текст',
      'Генерация 125 изображений',
      'Генерация 25 видео',
      'Генерация 36 песен',
    ],
    color: '#60a5fa',
    icon: 'Zap',
    sortOrder: 1,
  },
  {
    planKey: 'plus',
    name: 'Plus',
    priceRub: 990,
    tokensPerMonth: 330,
    bonusTokens: 0,
    modelsAccess: 'full' as const,
    freeModels: [
      { modelSlug: 'gpt-oss-120b', displayName: 'gpt-oss-120b', hourlyLimit: 10, dailyLimit: 60 },
      { modelSlug: 'deepseek-v3.2', displayName: 'DeepSeek V3.2', hourlyLimit: 10, dailyLimit: 60 },
      { modelSlug: 'grok-4.1-fast', displayName: 'xAI: Grok 4.1 Fast', hourlyLimit: 10, dailyLimit: 60 },
    ],
    features: {
      maxDailyGenerations: 200,
      priorityQueue: false,
      exclusiveModels: true,
      noWatermark: false,
      maxContextMessages: 30,
    },
    capabilities: [
      'Бесплатная генерация текста 10/час, 60/сутки',
      'Генерация 275 изображений',
      'Генерация 55 видео',
      'Генерация 82 песен',
    ],
    color: '#fbbf24',
    icon: 'Star',
    isPopular: true,
    sortOrder: 2,
  },
  {
    planKey: 'max',
    name: 'Max',
    priceRub: 2490,
    tokensPerMonth: 830,
    bonusTokens: 50,
    modelsAccess: 'full' as const,
    freeModels: [
      { modelSlug: 'gpt-oss-120b', displayName: 'gpt-oss-120b', hourlyLimit: null, dailyLimit: null },
      { modelSlug: 'deepseek-v3.2', displayName: 'DeepSeek V3.2', hourlyLimit: null, dailyLimit: null },
      { modelSlug: 'grok-4.1-fast', displayName: 'xAI: Grok 4.1 Fast', hourlyLimit: null, dailyLimit: null },
    ],
    features: {
      maxDailyGenerations: 999999,
      priorityQueue: true,
      exclusiveModels: true,
      noWatermark: true,
      maxContextMessages: 50,
    },
    capabilities: [
      'Безлимитная генерация текста',
      'Генерация 733 изображений',
      'Генерация 146 видео',
      'Генерация 220 песен',
    ],
    color: '#f97316',
    icon: 'Rocket',
    sortOrder: 3,
  },
  {
    planKey: 'ultimate',
    name: 'Ultimate',
    priceRub: 5990,
    tokensPerMonth: 1997,
    bonusTokens: 220,
    modelsAccess: 'full' as const,
    freeModels: [
      { modelSlug: 'gpt-image-1.5-lite', displayName: 'GPT Image 1.5 Lite', hourlyLimit: 10, dailyLimit: 60 },
      { modelSlug: 'imagen-4', displayName: 'Imagen 4', hourlyLimit: 10, dailyLimit: 60 },
      { modelSlug: 'midjourney', displayName: 'Midjourney обычный', hourlyLimit: 10, dailyLimit: 60 },
      { modelSlug: 'gpt-oss-120b', displayName: 'gpt-oss-120b', hourlyLimit: null, dailyLimit: null },
      { modelSlug: 'deepseek-v3.2', displayName: 'DeepSeek V3.2', hourlyLimit: null, dailyLimit: null },
      { modelSlug: 'grok-4.1-fast', displayName: 'xAI: Grok 4.1 Fast', hourlyLimit: null, dailyLimit: null },
    ],
    features: {
      maxDailyGenerations: 999999,
      priorityQueue: true,
      exclusiveModels: true,
      noWatermark: true,
      maxContextMessages: 100,
    },
    capabilities: [
      'Безлимитная генерация текста',
      'Бесплатная генерация изображений 10/час, 60/сутки',
      'Генерация 369 изображений',
      'Генерация 220 видео',
      'Генерация 554 песен',
    ],
    color: '#c084fc',
    icon: 'Diamond',
    sortOrder: 4,
  },
];

const PACKAGES = [
  { packageId: 'pack_100',  label: '100 спичек',  tokens: 100,  priceRub: 99,   sortOrder: 1 },
  { packageId: 'pack_300',  label: '300 спичек',  tokens: 300,  priceRub: 249,  popular: true,  sortOrder: 2 },
  { packageId: 'pack_700',  label: '700 спичек',  tokens: 700,  priceRub: 499,  sortOrder: 3 },
  { packageId: 'pack_1500', label: '1500 спичек', tokens: 1500, priceRub: 899,  sortOrder: 4 },
  { packageId: 'pack_5000', label: '5000 спичек', tokens: 5000, priceRub: 2499, best: true,     sortOrder: 5 },
];

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const planModel = app.get<Model<SubscriptionPlanDocument>>(
    getModelToken(SubscriptionPlanEntity.name),
  );
  const packageModel = app.get<Model<TokenPackageDocument>>(
    getModelToken(TokenPackageEntity.name),
  );

  console.log('🌱 Seeding subscription plans...');
  for (const plan of PLANS) {
    const res = await planModel.updateOne(
      { planKey: plan.planKey },
      { $setOnInsert: plan },
      { upsert: true },
    );
    console.log(
      `  ${res.upsertedCount ? '✅ created' : '⏭  exists'}: ${plan.planKey} (${plan.name})`,
    );
  }

  console.log('\n🌱 Seeding token packages...');
  for (const pack of PACKAGES) {
    const res = await packageModel.updateOne(
      { packageId: pack.packageId },
      { $setOnInsert: pack },
      { upsert: true },
    );
    console.log(
      `  ${res.upsertedCount ? '✅ created' : '⏭  exists'}: ${pack.packageId} (${pack.label})`,
    );
  }

  console.log('\n✨ Done!\n');
  await app.close();
  process.exit(0);
}

bootstrap().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
  