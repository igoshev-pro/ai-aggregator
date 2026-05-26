/**
 * Seeds subscription plans and token packages.
 *
 * Запуск (локально):
 *   npx ts-node -r tsconfig-paths/register src/scripts/seed-billing.ts
 *
 * Запуск (в Docker, скомпилированная версия):
 *   docker exec -it ai-backend node dist/scripts/seed-billing.js
 *
 * В package.json:
 *   "seed:billing": "ts-node -r tsconfig-paths/register src/scripts/seed-billing.ts"
 */
import { NestFactory } from '@nestjs/core';
import { INestApplicationContext } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { AppModule } from '../src/app.module';
import {
  SubscriptionPlanEntity,
  SubscriptionPlanDocument,
} from '../src/modules/billing/schemas/subscription-plan.schema';
import {
  TokenPackageEntity,
  TokenPackageDocument,
} from '../src/modules/billing/schemas/token-package.schema';

// ---------------------------------------------------------------------------
//  DATA
// ---------------------------------------------------------------------------

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
    isActive: true,
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
    isActive: true,
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
    isActive: true,
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
    isActive: true,
  },
];

const PACKAGES = [
  { packageId: 'pack_100',  label: '100 спичек',  tokens: 100,  priceRub: 99,   sortOrder: 1, isActive: true },
  { packageId: 'pack_300',  label: '300 спичек',  tokens: 300,  priceRub: 249,  popular: true, sortOrder: 2, isActive: true },
  { packageId: 'pack_700',  label: '700 спичек',  tokens: 700,  priceRub: 499,  sortOrder: 3, isActive: true },
  { packageId: 'pack_1500', label: '1500 спичек', tokens: 1500, priceRub: 899,  sortOrder: 4, isActive: true },
  { packageId: 'pack_5000', label: '5000 спичек', tokens: 5000, priceRub: 2499, best: true, sortOrder: 5, isActive: true },
];

// ---------------------------------------------------------------------------
//  BOOTSTRAP
// ---------------------------------------------------------------------------

async function bootstrap(): Promise<void> {
  console.log('🚀 [seed-billing] Bootstrap started');

  let app: INestApplicationContext | undefined;

  try {
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn', 'log'],
    });
    console.log('✅ [seed-billing] Nest application context created');

    // strict: false → искать токен во всем дереве модулей, а не только в корневом
    const planModel = app.get<Model<SubscriptionPlanDocument>>(
      getModelToken(SubscriptionPlanEntity.name),
      { strict: false },
    );
    const packageModel = app.get<Model<TokenPackageDocument>>(
      getModelToken(TokenPackageEntity.name),
      { strict: false },
    );

    if (!planModel) throw new Error('SubscriptionPlan model not found in DI container');
    if (!packageModel) throw new Error('TokenPackage model not found in DI container');

    console.log(
      `📦 [seed-billing] Models resolved: plans collection="${planModel.collection.name}", packages collection="${packageModel.collection.name}"`,
    );
    console.log(
      `📊 [seed-billing] Before seed: plans=${await planModel.countDocuments()}, packages=${await packageModel.countDocuments()}`,
    );

    // ---------------------- PLANS ----------------------
    console.log('\n🌱 [seed-billing] Seeding subscription plans...');
    for (const plan of PLANS) {
      try {
        const res = await planModel.updateOne(
          { planKey: plan.planKey },
          { $setOnInsert: plan },
          { upsert: true },
        );
        const status = res.upsertedCount ? '✅ created' : '⏭  exists ';
        console.log(`  ${status}: ${plan.planKey.padEnd(10)} (${plan.name})`);
      } catch (e: any) {
        console.error(`  ❌ failed:  ${plan.planKey} → ${e?.message ?? e}`);
      }
    }

    // ---------------------- PACKAGES -------------------
    console.log('\n🌱 [seed-billing] Seeding token packages...');
    for (const pack of PACKAGES) {
      try {
        const res = await packageModel.updateOne(
          { packageId: pack.packageId },
          { $setOnInsert: pack },
          { upsert: true },
        );
        const status = res.upsertedCount ? '✅ created' : '⏭  exists ';
        console.log(`  ${status}: ${pack.packageId.padEnd(12)} (${pack.label})`);
      } catch (e: any) {
        console.error(`  ❌ failed:  ${pack.packageId} → ${e?.message ?? e}`);
      }
    }

    console.log(
      `\n📊 [seed-billing] After seed:  plans=${await planModel.countDocuments()}, packages=${await packageModel.countDocuments()}`,
    );

    console.log('\n✨ [seed-billing] Done!\n');
  } catch (err: any) {
    console.error('❌ [seed-billing] FATAL:', err?.stack ?? err);
    process.exitCode = 1;
  } finally {
    if (app) {
      try {
        await app.close();
        console.log('🔒 [seed-billing] Nest context closed');
      } catch (closeErr) {
        console.error('⚠️  [seed-billing] Error closing context:', closeErr);
      }
    }
    // Гарантированный выход (иначе процесс может «висеть» из-за открытых соединений)
    process.exit(process.exitCode ?? 0);
  }
}

bootstrap();