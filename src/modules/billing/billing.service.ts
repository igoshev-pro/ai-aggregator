// src/modules/billing/billing.service.ts
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  Inject,
  forwardRef,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Transaction, TransactionDocument } from './schemas/transaction.schema';
import {
  Subscription,
  SubscriptionDocument,
} from './schemas/subscription.schema';
import {
  PromoCode,
  PromoCodeDocument,
  PromoCodeType,
} from './schemas/promo-code.schema';
import { PromoCodeService, PromoApplyContext } from './promo-code.service';
import { AIModel, ModelDocument } from '../ai-providers/schemas/model.schema';
import { UsersService } from '../users/users.service';
import { YookassaProvider } from './providers/yookassa.provider';
import { CryptomusProvider } from './providers/cryptomus.provider';
import { StarsProvider } from './providers/stars.provider';
import {
  TransactionType,
  PaymentStatus,
  SubscriptionPlan,
} from '@/common/interfaces';
import { FreedomPayProvider } from './providers/freedompay/freedompay.provider';
import { TochkaProvider } from './providers/tochka/tochka.provider';
import { TochkaAcquiringWebhookPayload } from './providers/tochka/tochka.types';
import { HeleketProvider } from './providers/heleket.provider';
import { ReferralService } from '../referral/referral.service';
import {
  SubscriptionPlanEntity,
  SubscriptionPlanDocument,
} from './schemas/subscription-plan.schema';
import {
  TokenPackageEntity,
  TokenPackageDocument,
} from './schemas/token-package.schema';
import { calcCustomByTokens, CUSTOM_MAX_TOKENS, CUSTOM_MIN_TOKENS } from './pricing/custom-tokens.pricing';


// ─── Курс конвертации ────────────────────────────────────────────
const RUB_TO_USD_RATE = 90;

// ─── Глобальные константы точности ────────────────────────────
const MIN_CHARGE_TOKENS = 0.01;
const TOKEN_PRECISION = 2;
const FLOAT_EPSILON = 1e-9;

// Кэшбек от реферальных покупок (10%)
const REFERRAL_CASHBACK_RATE = 0.1;


function roundTokens(value: number): number {
  const factor = Math.pow(10, TOKEN_PRECISION);
  return Math.round(value * factor) / factor;
}

function finalizeTokenCost(value: number): number {
  const rounded = roundTokens(value);
  return rounded < MIN_CHARGE_TOKENS ? MIN_CHARGE_TOKENS : rounded;
}


// ─── Типы ────────────────────────────────────────────────────────
interface FreeModelAccess {
  modelSlug: string;
  displayName: string;
  hourlyLimit: number | null;
  dailyLimit: number | null;
  /**
   * 🆕 Дополнительный фильтр по параметрам генерации.
   * Если задан — модель бесплатна ТОЛЬКО при совпадении этих параметров.
   * Сравнение нестрогое (== для number/string).
   *
   * Пример: { mode: 'draft' } → midjourney бесплатен только в обычном режиме,
   * fast/turbo идут платно.
   */
  requiredParams?: Record<string, any>;
}


interface SubscriptionPlanConfig {
  name: string;
  priceRub: number;
  tokensPerMonth: number;
  bonusTokens: number;
  modelsAccess: 'limited' | 'full';
  freeModels: FreeModelAccess[];
  features: {
    maxDailyGenerations: number;
    priorityQueue: boolean;
    exclusiveModels: boolean;
    noWatermark: boolean;
    maxContextMessages: number;
  };
  capabilities: string[];
  description?: string;
  color?: string;
  icon?: string;
  isPopular?: boolean;
}


interface TokenPackageConfig {
  id: string;
  tokens: number;
  priceRub: number;
  label: string;
  bonusPercent?: number;
  popular?: boolean;
  best?: boolean;
}


type ProviderName =
  | 'yookassa'
  | 'cryptomus'
  | 'stars'
  | 'freedompay'
  | 'tochka'
  | 'heleket';


export interface ModelPreviewCost {
  avgCostInTokens: number;
  minCostInTokens: number;
  maxCostInTokens?: number;
  pricingType: 'per_token' | 'matrix' | 'fixed';
  details: {
    pricePerMillionInput?: number;
    pricePerMillionOutput?: number;
    avgTokensPerRequest?: number;
    min?: number;
    max?: number;
  };
}


// ─── Fallback константы ──────────────────────────────────────────
const FALLBACK_TOKEN_PACKAGES: TokenPackageConfig[] = [
  { id: 'pack_100', tokens: 100, priceRub: 99, label: '100 токенов' },
  { id: 'pack_300', tokens: 300, priceRub: 249, label: '300 токенов', popular: true },
  { id: 'pack_700', tokens: 700, priceRub: 499, label: '700 токенов' },
  { id: 'pack_1500', tokens: 1500, priceRub: 899, label: '1500 токенов' },
  { id: 'pack_5000', tokens: 5000, priceRub: 2499, label: '5000 токенов', best: true },
];


// ⚠️ Слаги моделей сверены с buildModelsCatalog() в provider-registry.service.ts
//    Маппинг ТЗ → реальные слаги каталога (Вариант A):
//      deepseek-v3.2     → deepseek-v4-flash
//      grok-4.1-fast     → grok-4.20
//      gpt-image-1.5-lite → seedream-5-lite (самый дешёвый image — 1.6🔥)
//      midjourney        → midjourney + requiredParams: { mode: 'draft' }
const FALLBACK_SUBSCRIPTION_PLANS: Record<string, SubscriptionPlanConfig> = {
  [SubscriptionPlan.BASIC]: {
    name: 'Basic',
    priceRub: 450,
    tokensPerMonth: 150,
    bonusTokens: 0,
    modelsAccess: 'limited',
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
  },
  [SubscriptionPlan.PLUS]: {
    name: 'Plus',
    priceRub: 990,
    tokensPerMonth: 330,
    bonusTokens: 0,
    modelsAccess: 'full',
    freeModels: [
      { modelSlug: 'gpt-oss-120b',     displayName: 'gpt-oss-120b',      hourlyLimit: 10, dailyLimit: 60 },
      { modelSlug: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', hourlyLimit: 10, dailyLimit: 60 },
      { modelSlug: 'grok-4.20',        displayName: 'xAI: Grok 4.20',    hourlyLimit: 10, dailyLimit: 60 },
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
  },
  [SubscriptionPlan.MAX]: {
    name: 'Max',
    priceRub: 2490,
    tokensPerMonth: 830,
    bonusTokens: 50,
    modelsAccess: 'full',
    freeModels: [
      { modelSlug: 'gpt-oss-120b',     displayName: 'gpt-oss-120b',      hourlyLimit: null, dailyLimit: null },
      { modelSlug: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', hourlyLimit: null, dailyLimit: null },
      { modelSlug: 'grok-4.20',        displayName: 'xAI: Grok 4.20',    hourlyLimit: null, dailyLimit: null },
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
  },
  [SubscriptionPlan.ULTIMATE]: {
    name: 'Ultimate',
    priceRub: 5990,
    tokensPerMonth: 1997,
    bonusTokens: 220,
    modelsAccess: 'full',
    freeModels: [
      // image
      {
        modelSlug: 'seedream-5-lite',
        displayName: 'Seedream 5.0 Lite',
        hourlyLimit: 10,
        dailyLimit: 60,
      },
      {
        modelSlug: 'imagen-4',
        displayName: 'Google Imagen 4 Fast',
        hourlyLimit: 10,
        dailyLimit: 60,
      },
      {
        modelSlug: 'midjourney',
        displayName: 'Midjourney V7 (обычный режим)',
        hourlyLimit: 10,
        dailyLimit: 60,
        requiredParams: { mode: 'draft' }, // 🆕 только режим "draft" бесплатно
      },
      // text — безлимит
      { modelSlug: 'gpt-oss-120b',      displayName: 'gpt-oss-120b',      hourlyLimit: null, dailyLimit: null },
      { modelSlug: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', hourlyLimit: null, dailyLimit: null },
      { modelSlug: 'grok-4.20',         displayName: 'xAI: Grok 4.20',    hourlyLimit: null, dailyLimit: null },
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
  },
};


const PLAN_MIGRATION: Record<string, SubscriptionPlan> = {
  [SubscriptionPlan.PRO]: SubscriptionPlan.PLUS,
  [SubscriptionPlan.UNLIMITED]: SubscriptionPlan.ULTIMATE,
};


@Injectable()
export class BillingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BillingService.name);

  private plansCache: { data: SubscriptionPlanDocument[]; ts: number } | null = null;
  private packagesCache: { data: TokenPackageDocument[]; ts: number } | null = null;
  private readonly CACHE_TTL_MS = 60_000;


  constructor(
    @InjectModel(Transaction.name)
    private transactionModel: Model<TransactionDocument>,
    @InjectModel(Subscription.name)
    private subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(PromoCode.name)
    private promoCodeModel: Model<PromoCodeDocument>,
    @InjectModel(AIModel.name)
    private modelModel: Model<ModelDocument>,
    @InjectModel(SubscriptionPlanEntity.name)
    private planModel: Model<SubscriptionPlanDocument>,
    @InjectModel(TokenPackageEntity.name)
    private packageModel: Model<TokenPackageDocument>,
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
    @Inject(forwardRef(() => ReferralService))
    private referralService: ReferralService,
    private promoCodeService: PromoCodeService,
    private yookassaProvider: YookassaProvider,
    private cryptomusProvider: CryptomusProvider,
    private starsProvider: StarsProvider,
    private freedompayProvider: FreedomPayProvider,
    private tochkaProvider: TochkaProvider,
    private heleketProvider: HeleketProvider,
  ) {}


  async onApplicationBootstrap() {
    try {
      await this.migrateDeprecatedSubscriptions();
    } catch (err: any) {
      this.logger.error(
        `Failed to migrate deprecated subscriptions on bootstrap: ${err.message}`,
      );
    }
  }


  // ═══════════════════════════════════════════════════════════════
  // Кэш
  // ═══════════════════════════════════════════════════════════════

  invalidateBillingCache() {
    this.plansCache = null;
    this.packagesCache = null;
    this.logger.log('🧹 Billing cache invalidated');
  }


  private async loadPlansFromDB(): Promise<SubscriptionPlanDocument[]> {
    if (this.plansCache && Date.now() - this.plansCache.ts < this.CACHE_TTL_MS) {
      return this.plansCache.data;
    }
    const docs = await this.planModel
      .find({ isActive: true })
      .sort({ sortOrder: 1, priceRub: 1 })
      .lean<SubscriptionPlanDocument[]>();
    this.plansCache = { data: docs, ts: Date.now() };
    return docs;
  }


  private async loadPackagesFromDB(): Promise<TokenPackageDocument[]> {
    if (this.packagesCache && Date.now() - this.packagesCache.ts < this.CACHE_TTL_MS) {
      return this.packagesCache.data;
    }
    const docs = await this.packageModel
      .find({ isActive: true })
      .sort({ sortOrder: 1, priceRub: 1 })
      .lean<TokenPackageDocument[]>();
    this.packagesCache = { data: docs, ts: Date.now() };
    return docs;
  }


  private async getPlanConfig(
    plan: SubscriptionPlan | string,
  ): Promise<SubscriptionPlanConfig | null> {
    const effectivePlan = PLAN_MIGRATION[plan as SubscriptionPlan] || plan;
    const key = String(effectivePlan).toLowerCase();

    const dbPlans = await this.loadPlansFromDB();
    const dbPlan = dbPlans.find((p) => p.planKey === key);
    if (dbPlan) {
      return {
        name: dbPlan.name,
        priceRub: dbPlan.priceRub,
        tokensPerMonth: dbPlan.tokensPerMonth,
        bonusTokens: dbPlan.bonusTokens,
        modelsAccess: dbPlan.modelsAccess,
        freeModels: (dbPlan.freeModels || []).map((fm: any) => ({
          modelSlug: fm.modelSlug,
          displayName: fm.displayName,
          hourlyLimit: fm.hourlyLimit,
          dailyLimit: fm.dailyLimit,
          requiredParams: fm.requiredParams, // 🆕 пробрасываем из БД, если есть
        })),
        features: dbPlan.features as any,
        capabilities: dbPlan.capabilities || [],
        description: dbPlan.description,
        color: dbPlan.color,
        icon: dbPlan.icon,
        isPopular: dbPlan.isPopular,
      };
    }

    return FALLBACK_SUBSCRIPTION_PLANS[key] || null;
  }


  // ═══════════════════════════════════════════════════════════════
  // WEBHOOKS
  // ═══════════════════════════════════════════════════════════════

  async handleFreedomPayWebhook(body: any): Promise<string> {
    const fpResult = await this.freedompayProvider.verifyWebhook(body, {});

    if (fpResult.metadata?.reason === 'invalid_signature') {
      return this.freedompayProvider.buildWebhookResponseXml(
        'error',
        'Invalid signature',
      );
    }

    const transaction = await this.transactionModel.findOne({
      externalPaymentId: fpResult.paymentId,
      paymentProvider: 'freedompay',
    });

    if (!transaction) {
      this.logger.warn(`[FP] transaction not found: ${fpResult.paymentId}`);
      return this.freedompayProvider.buildWebhookResponseXml(
        'error',
        'Order not found',
      );
    }

    if (transaction.paymentStatus !== PaymentStatus.PENDING) {
      this.logger.log(
        `[FP] duplicate webhook: tx=${transaction._id} status=${transaction.paymentStatus}`,
      );
      return this.freedompayProvider.buildWebhookResponseXml(
        'ok',
        'Already processed',
      );
    }

    await this.handlePaymentWebhook('freedompay', body, {});

    return this.freedompayProvider.buildWebhookResponseXml('ok', 'Order paid');
  }


  async handleTochkaWebhook(rawJwt: string): Promise<{ ok: boolean }> {
    const verifier = this.tochkaProvider.getVerifier();
    let payload: TochkaAcquiringWebhookPayload;
    try {
      payload = verifier.verify(rawJwt);
    } catch (err: any) {
      this.logger.warn(`[Tochka] webhook rejected: ${err.message}`);
      throw err;
    }

    this.logger.log(
      `[Tochka] webhook: op=${payload.operationId} status=${payload.status} type=${payload.webhookType}`,
    );

    if (payload.webhookType !== 'acquiringInternetPayment') {
      this.logger.log(`[Tochka] ignoring webhook type: ${payload.webhookType}`);
      return { ok: true };
    }

    const transaction = await this.transactionModel.findOne({
      externalPaymentId: payload.operationId,
      paymentProvider: 'tochka',
    });

    if (!transaction) {
      this.logger.warn(`[Tochka] transaction not found: op=${payload.operationId}`);
      return { ok: true };
    }

    if (transaction.paymentStatus !== PaymentStatus.PENDING) {
      this.logger.log(
        `[Tochka] duplicate webhook: tx=${transaction._id} status=${transaction.paymentStatus}`,
      );
      return { ok: true };
    }

    await this.handlePaymentWebhook('tochka', payload, {});

    return { ok: true };
  }


  // ═══════════════════════════════════════════════════════════════
  // Конвертация валюты
  // ═══════════════════════════════════════════════════════════════

  private convertPrice(priceRub: number, currency: 'RUB' | 'USD'): number {
    if (currency === 'RUB') return priceRub;
    return Math.round((priceRub / RUB_TO_USD_RATE) * 100) / 100;
  }

  private getCurrencySymbol(currency: 'RUB' | 'USD'): string {
    return currency === 'RUB' ? '₽' : '$';
  }


  // ═══════════════════════════════════════════════════════════════
  // Пакеты токенов
  // ═══════════════════════════════════════════════════════════════

  async getTokenPackages(currency: 'RUB' | 'USD' = 'RUB') {
    const dbPacks = await this.loadPackagesFromDB();

    const source: TokenPackageConfig[] =
      dbPacks.length > 0
        ? dbPacks.map((p) => ({
            id: p.packageId,
            tokens: p.tokens,
            priceRub: p.priceRub,
            label: p.label,
            bonusPercent: p.bonusPercent,
            popular: p.popular,
            best: p.best,
          }))
        : FALLBACK_TOKEN_PACKAGES;

    return source.map((pack) => {
      const bonusTokens = Math.floor(
        (pack.tokens * (pack.bonusPercent || 0)) / 100,
      );
      return {
        id: pack.id,
        label: pack.label,
        tokens: pack.tokens,
        bonusTokens,
        totalTokens: pack.tokens + bonusTokens,
        priceRub: pack.priceRub,
        price: this.convertPrice(pack.priceRub, currency),
        currency,
        currencySymbol: this.getCurrencySymbol(currency),
        popular: pack.popular || false,
        best: pack.best || false,
      };
    });
  }


  private async findPackageById(
    packageId: string,
  ): Promise<TokenPackageConfig | null> {
    const dbPack = await this.packageModel
      .findOne({ packageId, isActive: true })
      .lean();
    if (dbPack) {
      return {
        id: dbPack.packageId,
        tokens: dbPack.tokens,
        priceRub: dbPack.priceRub,
        label: dbPack.label,
        bonusPercent: dbPack.bonusPercent,
        popular: dbPack.popular,
        best: dbPack.best,
      };
    }
    return FALLBACK_TOKEN_PACKAGES.find((p) => p.id === packageId) || null;
  }


    // ═══════════════════════════════════════════════════════════════
  // Планы подписки
  // ═══════════════════════════════════════════════════════════════

  async getSubscriptionPlans(currency: 'RUB' | 'USD' = 'RUB') {
    const dbPlans = await this.loadPlansFromDB();
    const result: any[] = [];

    const entries: Array<[string, SubscriptionPlanConfig]> =
      dbPlans.length > 0
        ? dbPlans.map((p) => [
            p.planKey,
            {
              name: p.name,
              priceRub: p.priceRub,
              tokensPerMonth: p.tokensPerMonth,
              bonusTokens: p.bonusTokens,
              modelsAccess: p.modelsAccess,
              freeModels: (p.freeModels || []) as FreeModelAccess[],
              features: p.features as any,
              capabilities: p.capabilities || [],
              description: p.description,
              color: p.color,
              icon: p.icon,
              isPopular: p.isPopular,
            },
          ])
        : Object.entries(FALLBACK_SUBSCRIPTION_PLANS);

    for (const [planId, config] of entries) {
      if (
        planId === SubscriptionPlan.PRO ||
        planId === SubscriptionPlan.UNLIMITED
      ) {
        continue;
      }

      result.push({
        id: planId,
        plan: planId,
        name: config.name,
        description: config.description || '',
        price: this.convertPrice(config.priceRub, currency),
        priceRub: config.priceRub,
        currency,
        currencySymbol: this.getCurrencySymbol(currency),
        period: '/мес',
        tokensPerMonth: config.tokensPerMonth,
        bonusTokens: config.bonusTokens,
        totalTokens: config.tokensPerMonth + config.bonusTokens,
        modelsAccess: config.modelsAccess,
        freeModels: config.freeModels.map((fm) => ({
          name: fm.displayName,
          slug: fm.modelSlug,
          limit:
            fm.hourlyLimit === null
              ? 'Безлимит'
              : `${fm.hourlyLimit}/час, ${fm.dailyLimit}/сутки`,
          isUnlimited: fm.hourlyLimit === null,
          requiredParams: fm.requiredParams || null, // 🆕 фронт может показать "только режим X"
        })),
        features: config.features,
        capabilities: config.capabilities,
        color: config.color || '#60a5fa',
        icon: config.icon || 'Zap',
        isPopular: config.isPopular || false,
        tokenPriceRub: 3,
        tokenPriceUsd: Math.round((3 / RUB_TO_USD_RATE) * 1000) / 1000,
      });
    }

    return result;
  }


  // ═══════════════════════════════════════════════════════════════
  // 🆕 Проверка бесплатного доступа к модели (с поддержкой params)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Возвращает:
   *   - isFree=true              → юзер может генерить бесплатно (лимит ОК + params матчатся)
   *   - isFree=false, reason='not_in_plan'        → модель/режим НЕ входит в free список плана
   *                                                  (значит идём по обычной платной логике)
   *   - isFree=false, reason='limit_exceeded:...' → лимит исчерпан
   *
   * 🆕 Учитывает requiredParams: если у модели в плане задан фильтр
   *    (напр. { mode: 'draft' }), то бесплатными считаются ТОЛЬКО запросы
   *    с этими параметрами. Остальные → not_in_plan → платно.
   */
  async checkFreeModelAccess(
    userId: string,
    modelSlug: string,
    params?: Record<string, any>,
  ): Promise<{
    isFree: boolean;
    reason?: string;
    matchedFreeModel?: FreeModelAccess;
    resetAt?: Date;
  }> {
    const user = await this.usersService.findById(userId);
    const planConfig = await this.getPlanConfig(user.subscriptionPlan);

    if (!planConfig) {
      return { isFree: false, reason: 'not_in_plan' };
    }

    // Кандидаты — все free-записи плана с нужным slug
    const candidates = planConfig.freeModels.filter(
      (fm) => fm.modelSlug === modelSlug,
    );
    if (candidates.length === 0) {
      return { isFree: false, reason: 'not_in_plan' };
    }

    // Выбираем первую запись, у которой совпадают requiredParams.
    // Если у записи нет requiredParams — она матчится всегда (любые params).
    const freeModel =
      candidates.find((fm) => this.matchRequiredParams(fm.requiredParams, params)) ||
      null;

    if (!freeModel) {
      // slug в плане есть, но params не подходят → платно
      return { isFree: false, reason: 'not_in_plan' };
    }

    // Безлимит → сразу free
    if (freeModel.hourlyLimit === null && freeModel.dailyLimit === null) {
      return { isFree: true, matchedFreeModel: freeModel };
    }

    // Считаем потребление по транзакциям с metadata.freeAccess=true
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    const [hourlyCount, dailyCount] = await Promise.all([
      freeModel.hourlyLimit !== null
        ? this.transactionModel.countDocuments({
            userId: new Types.ObjectId(userId),
            type: TransactionType.GENERATION,
            modelSlug,
            createdAt: { $gte: hourAgo },
            'metadata.freeAccess': true,
          })
        : Promise.resolve(0),
      freeModel.dailyLimit !== null
        ? this.transactionModel.countDocuments({
            userId: new Types.ObjectId(userId),
            type: TransactionType.GENERATION,
            modelSlug,
            createdAt: { $gte: dayStart },
            'metadata.freeAccess': true,
          })
        : Promise.resolve(0),
    ]);

    if (
      freeModel.hourlyLimit !== null &&
      hourlyCount >= freeModel.hourlyLimit
    ) {
      // Сброс в начале следующего часа
      const resetAt = new Date(now);
      resetAt.setMinutes(0, 0, 0);
      resetAt.setHours(resetAt.getHours() + 1);

      return {
        isFree: false,
        reason: `limit_exceeded:hourly:${freeModel.hourlyLimit}`,
        matchedFreeModel: freeModel,
        resetAt,
      };
    }

    if (freeModel.dailyLimit !== null && dailyCount >= freeModel.dailyLimit) {
      // Сброс в начале следующих суток
      const resetAt = new Date(now);
      resetAt.setHours(0, 0, 0, 0);
      resetAt.setDate(resetAt.getDate() + 1);

      return {
        isFree: false,
        reason: `limit_exceeded:daily:${freeModel.dailyLimit}`,
        matchedFreeModel: freeModel,
        resetAt,
      };
    }

    return { isFree: true, matchedFreeModel: freeModel };
  }


  /**
   * 🆕 Нестрогое сравнение requiredParams с реально присланными params.
   * Если requiredParams не задан / пуст → совпадает всегда.
   * Если задан → каждый ключ из required должен присутствовать в params
   * со совпадающим значением (== для number/string).
   */
  private matchRequiredParams(
    required: Record<string, any> | undefined,
    actual?: Record<string, any>,
  ): boolean {
    if (!required || Object.keys(required).length === 0) {
      return true;
    }
    if (!actual) return false;

    for (const key of Object.keys(required)) {
      const expected = required[key];
      const got = actual[key];
      // eslint-disable-next-line eqeqeq
      if (expected != got) return false;
    }
    return true;
  }


  // ═══════════════════════════════════════════════════════════════
  // Превью промокода
  // ═══════════════════════════════════════════════════════════════

  async previewPromoCode(
    userId: string,
    code: string,
    target:
      | { type: 'token_package'; packageId: string }
      | { type: 'subscription'; plan: SubscriptionPlan },
  ) {
    let context: PromoApplyContext;

    if (target.type === 'token_package') {
      const pack = await this.findPackageById(target.packageId);
      if (!pack) throw new BadRequestException('Пакет не найден');
      context = {
        purchaseType: 'token_package',
        amountRub: pack.priceRub,
        packageId: pack.id,
      };
    } else {
      const planConfig = await this.getPlanConfig(target.plan);
      if (!planConfig) throw new BadRequestException('План не найден');
      const effectivePlan = (PLAN_MIGRATION[target.plan] || target.plan) as string;
      context = {
        purchaseType: 'subscription',
        amountRub: planConfig.priceRub,
        planKey: String(effectivePlan).toLowerCase(),
      };
    }

    const validation = await this.promoCodeService.validate(
      code,
      userId,
      context,
    );

    return {
      code: validation.promo.code,
      type: validation.promo.type,
      effectLabel: validation.effectLabel,
      discountRub: validation.discountRub,
      bonusTokens: validation.bonusTokens,
      subscriptionDays: validation.subscriptionDays,
      subscriptionPlan: validation.subscriptionPlan,
      originalAmountRub: context.amountRub || 0,
      finalAmountRub: validation.finalAmountRub,
    };
  }


  // ═══════════════════════════════════════════════════════════════
  // Оплата пакета токенов
  // ═══════════════════════════════════════════════════════════════

  async createTokenPayment(
    userId: string,
    packageId: string,
    provider: ProviderName,
    currency: 'RUB' | 'USD' = 'RUB',
    returnUrl?: string,
    promoCode?: string,
  ) {
    const pack = await this.findPackageById(packageId);
    if (!pack) throw new BadRequestException('Invalid package');

    const user = await this.usersService.findById(userId);
    const paymentProvider = this.getPaymentProvider(provider);

    const bonusTokensFromPack = Math.floor(
      (pack.tokens * (pack.bonusPercent || 0)) / 100,
    );
    const totalTokens = pack.tokens + bonusTokensFromPack;

    let promoValidation: Awaited<
      ReturnType<typeof this.promoCodeService.validate>
    > | null = null;
    let finalPriceRub = pack.priceRub;
    let promoBonusTokens = 0;

    if (promoCode) {
      promoValidation = await this.promoCodeService.validate(
        promoCode,
        userId,
        {
          purchaseType: 'token_package',
          amountRub: pack.priceRub,
          packageId: pack.id,
        },
      );

      if (promoValidation.promo.type === PromoCodeType.SUBSCRIPTION_DAYS) {
        throw new BadRequestException(
          'Этот промокод применяется только к подпискам',
        );
      }

      finalPriceRub = promoValidation.finalAmountRub;
      promoBonusTokens = promoValidation.bonusTokens;

      this.logger.log(
        `🎟 Promo ${promoValidation.promo.code} applied to package ${pack.id}: ` +
          `${pack.priceRub}₽ → ${finalPriceRub}₽ (+${promoBonusTokens}🔥)`,
      );
    }

    // ── Полная скидка → активируем без платежа ───────────────────
    if (finalPriceRub === 0 && promoValidation) {
      await this.usersService.addTokens(userId, pack.tokens);
      const totalBonus = bonusTokensFromPack + promoBonusTokens;
      if (totalBonus > 0) {
        await this.usersService.addBonusTokens(userId, totalBonus);
      }

      await this.promoCodeService.markUsed(promoValidation.promo._id, userId, {
        discountRub: pack.priceRub,
        bonusTokens: promoBonusTokens,
      });

      const finalUser = await this.usersService.findById(userId);

      await this.createTransaction(userId, {
        type: TransactionType.DEPOSIT,
        amount: pack.tokens + totalBonus,
        description: `Пополнение (бесплатно по промокоду ${promoValidation.promo.code}): ${pack.label}`,
        paymentStatus: PaymentStatus.COMPLETED,
        paymentProvider: provider,
        paymentAmountRub: 0,
        promoCode: promoValidation.promo.code,
        balanceBefore: roundTokens(
          user.tokenBalance + user.bonusTokens + (user.cashbackBalance || 0),
        ),
        balanceAfter: roundTokens(
          finalUser.tokenBalance +
            finalUser.bonusTokens +
            (finalUser.cashbackBalance || 0),
        ),
        metadata: {
          currency,
          paymentAmount: 0,
          baseTokens: pack.tokens,
          bonusTokens: bonusTokensFromPack,
          promoBonusTokens,
          promoDiscountRub: pack.priceRub,
          fullPrice: true,
          freeByPromo: true,
        },
      });

      return {
        paymentId: null,
        paymentUrl: null,
        freeByPromo: true,
        package: {
          id: pack.id,
          label: pack.label,
          tokens: pack.tokens,
          bonusTokens: totalBonus,
          totalTokens: pack.tokens + totalBonus,
          price: 0,
          originalPrice: this.convertPrice(pack.priceRub, currency),
          currency,
        },
        promo: {
          code: promoValidation.promo.code,
          effectLabel: promoValidation.effectLabel,
        },
      };
    }

    // ── Обычный поток с оплатой ─────────────────────────────────
    const paymentAmount = this.convertPrice(finalPriceRub, currency);

    const result = await paymentProvider.createPayment({
      amount: paymentAmount,
      currency,
      tokens: totalTokens,
      userId,
      description: `Пополнение: ${pack.label}`,
      returnUrl,
    });

    if (!result.success) {
      throw new BadRequestException(result.error || 'Payment creation failed');
    }

    const balanceSnapshot = roundTokens(
      user.tokenBalance + user.bonusTokens + (user.cashbackBalance || 0),
    );

    await this.createTransaction(userId, {
      type: TransactionType.DEPOSIT,
      amount: totalTokens,
      description: `Пополнение: ${pack.label}${
        bonusTokensFromPack > 0 ? ` (+${bonusTokensFromPack} бонус)` : ''
      }${promoValidation ? ` [промокод ${promoValidation.promo.code}]` : ''}`,
      paymentStatus: PaymentStatus.PENDING,
      externalPaymentId: result.paymentId,
      paymentProvider: provider,
      paymentAmountRub: finalPriceRub,
      promoCode: promoValidation?.promo.code,
      balanceBefore: balanceSnapshot,
      balanceAfter: balanceSnapshot,
      metadata: {
        currency,
        paymentAmount,
        originalPriceRub: pack.priceRub,
        finalPriceRub,
        baseTokens: pack.tokens,
        bonusTokens: bonusTokensFromPack,
        promoCodeApplied: promoValidation
          ? {
              promoId: promoValidation.promo._id.toString(),
              code: promoValidation.promo.code,
              type: promoValidation.promo.type,
              discountRub: promoValidation.discountRub,
              bonusTokens: promoValidation.bonusTokens,
            }
          : null,
      },
    });

    return {
      paymentId: result.paymentId,
      paymentUrl: result.paymentUrl,
      package: {
        id: pack.id,
        label: pack.label,
        tokens: pack.tokens,
        bonusTokens: bonusTokensFromPack,
        totalTokens,
        price: paymentAmount,
        originalPrice: this.convertPrice(pack.priceRub, currency),
        discountApplied: promoValidation?.discountRub || 0,
        currency,
      },
      promo: promoValidation
        ? {
            code: promoValidation.promo.code,
            effectLabel: promoValidation.effectLabel,
            discountRub: promoValidation.discountRub,
            bonusTokens: promoValidation.bonusTokens,
          }
        : null,
    };
  }


  // ═══════════════════════════════════════════════════════════════
  // Кастомная покупка спичек (произвольное количество)
  // ═══════════════════════════════════════════════════════════════

  async createCustomTokenPayment(
    userId: string,
    tokensRaw: number,
    provider: ProviderName,
    currency: 'RUB' | 'USD' = 'RUB',
    returnUrl?: string,
  ) {
    const calc = calcCustomByTokens(tokensRaw);

    if (!calc.valid) {
      throw new BadRequestException(
        `Количество спичек должно быть от ${CUSTOM_MIN_TOKENS} до ${CUSTOM_MAX_TOKENS}`,
      );
    }

    const tokens = calc.tokens;
    const finalPriceRub = calc.rub;

    const user = await this.usersService.findById(userId);
    const paymentProvider = this.getPaymentProvider(provider);

    const paymentAmount = this.convertPrice(finalPriceRub, currency);

    const result = await paymentProvider.createPayment({
      amount: paymentAmount,
      currency,
      tokens,
      userId,
      description: `Пополнение: ${tokens} спичек`,
      returnUrl,
    });

    if (!result.success) {
      throw new BadRequestException(result.error || 'Payment creation failed');
    }

    const balanceSnapshot = roundTokens(
      user.tokenBalance + user.bonusTokens + (user.cashbackBalance || 0),
    );

    await this.createTransaction(userId, {
      type: TransactionType.DEPOSIT,
      amount: tokens,
      description: `Пополнение: ${tokens} спичек (${calc.pricePerToken}₽/шт, −${calc.discountPct}%)`,
      paymentStatus: PaymentStatus.PENDING,
      externalPaymentId: result.paymentId,
      paymentProvider: provider,
      paymentAmountRub: finalPriceRub,
      balanceBefore: balanceSnapshot,
      balanceAfter: balanceSnapshot,
      metadata: {
        currency,
        paymentAmount,
        custom: true,
        pricePerToken: calc.pricePerToken,
        discountPct: calc.discountPct,
        baseTokens: tokens,
        bonusTokens: 0,
      },
    });

    return {
      paymentId: result.paymentId,
      paymentUrl: result.paymentUrl,
      custom: {
        tokens,
        pricePerToken: calc.pricePerToken,
        discountPct: calc.discountPct,
        priceRub: finalPriceRub,
        price: paymentAmount,
        originalPrice: this.convertPrice(calc.baseRub, currency),
        currency,
      },
    };
  }


  // ═══════════════════════════════════════════════════════════════
  // Webhook обработка
  // ═══════════════════════════════════════════════════════════════

  async handlePaymentWebhook(
    provider: ProviderName,
    body: any,
    headers: any,
  ) {
    const paymentProvider = this.getPaymentProvider(provider);
    const result = await paymentProvider.verifyWebhook(body, headers);

    if (!result.success) {
      this.logger.warn(`Webhook verification failed for ${provider}`);
      return { processed: false };
    }

    // ─── FAILED ──────────────────────────────────────────────────
    if (result.status === 'failed') {
      const failedTx = await this.transactionModel.findOneAndUpdate(
        {
          externalPaymentId: result.paymentId,
          paymentProvider: provider,
          paymentStatus: PaymentStatus.PENDING,
        },
        { $set: { paymentStatus: PaymentStatus.FAILED } },
        { new: true },
      );

      if (!failedTx) {
        this.logger.warn(
          `[${provider}] No pending tx to fail for payment ${result.paymentId}`,
        );
        return { processed: false };
      }

      this.logger.log(
        `❌ Payment ${result.paymentId} marked failed (tx=${failedTx._id})`,
      );
      return { processed: true, status: 'failed' };
    }

    // ─── PENDING (промежуточный статус провайдера) ───────────────
    if (result.status !== 'completed') {
      return { processed: false, status: 'pending' };
    }

    // ─── COMPLETED: атомарный захват ─────────────────────────────
    const transaction = await this.transactionModel.findOneAndUpdate(
      {
        externalPaymentId: result.paymentId,
        paymentProvider: provider,
        paymentStatus: PaymentStatus.PENDING,
      },
      {
        $set: { paymentStatus: PaymentStatus.COMPLETED },
      },
      { new: true },
    );

    if (!transaction) {
      this.logger.warn(
        `[${provider}] No pending tx for payment ${result.paymentId} ` +
          `(already processed or wrong provider)`,
      );
      return { processed: false };
    }

    // Для SUBSCRIPTION токены начисляет activateSubscription —
    // здесь НЕ дублируем
    let user;
    if (transaction.type === TransactionType.SUBSCRIPTION) {
      user = await this.usersService.findById(transaction.userId.toString());
    } else {
      user = await this.usersService.addTokens(
        transaction.userId.toString(),
        transaction.amount,
      );
    }

    transaction.balanceAfter = roundTokens(
      user.tokenBalance + user.bonusTokens + (user.cashbackBalance || 0),
    );
    await transaction.save();

        // ─── ПРОМОКОД (бонусы + markUsed) ────────────────────────────
    const promoApplied = transaction.metadata?.promoCodeApplied as
      | {
          promoId: string;
          code: string;
          type: string;
          discountRub: number;
          bonusTokens: number;
        }
      | null
      | undefined;

    if (promoApplied) {
      try {
        if (promoApplied.bonusTokens > 0) {
          await this.usersService.addBonusTokens(
            transaction.userId.toString(),
            promoApplied.bonusTokens,
          );

          await this.createTransaction(transaction.userId.toString(), {
            type: TransactionType.PROMO_CODE,
            amount: promoApplied.bonusTokens,
            description: `Промокод ${promoApplied.code}: +${promoApplied.bonusTokens} 🔥 спичек`,
            paymentStatus: PaymentStatus.COMPLETED,
            promoCode: promoApplied.code,
            metadata: {
              relatedPaymentId: result.paymentId,
              promoId: promoApplied.promoId,
              promoType: promoApplied.type,
            },
          });
        }

        await this.promoCodeService.markUsed(
          promoApplied.promoId,
          transaction.userId.toString(),
          {
            discountRub: promoApplied.discountRub,
            bonusTokens: promoApplied.bonusTokens,
          },
        );

        this.logger.log(
          `🎟 Promo ${promoApplied.code} applied after webhook for user ${transaction.userId}`,
        );
      } catch (err: any) {
        this.logger.error(
          `Failed to apply promo ${promoApplied.code} after webhook: ${err.message}`,
        );
      }
    }

    // ─── АКТИВАЦИЯ ПОДПИСКИ ───────────────────────────────────────
    if (
      transaction.type === TransactionType.SUBSCRIPTION &&
      transaction.metadata?.plan
    ) {
      await this.activateSubscription(
        transaction.userId.toString(),
        transaction.metadata.plan as SubscriptionPlan,
      );

      // Перечитываем баланс после начисления подписочных токенов
      const fresh = await this.usersService.findById(
        transaction.userId.toString(),
      );
      transaction.balanceAfter = roundTokens(
        fresh.tokenBalance + fresh.bonusTokens + (fresh.cashbackBalance || 0),
      );
      await transaction.save();
    }

    // ─── РЕФЕРАЛЬНЫЙ КЭШБЕК ──────────────────────────────────────
    await this.processReferralBonus(transaction);

    this.logger.log(
      `✅ Payment ${result.paymentId} completed: ${transaction.amount} tokens → user ${transaction.userId}`,
    );

    return { processed: true, status: 'completed' };
  }


  // ═══════════════════════════════════════════════════════════════
  // Реферальный бонус
  // ═══════════════════════════════════════════════════════════════

  /**
   * Кэшбек = 10% от КУПЛЕННЫХ СПИЧЕК (transaction.amount).
   * Только для платных покупок (paymentAmountRub > 0).
   */
  private async processReferralBonus(transaction: TransactionDocument) {
    const userDoc = await this.usersService.findById(
      transaction.userId.toString(),
    );
    if (!userDoc.referredBy) return;

    const paymentRub = Number(transaction.paymentAmountRub) || 0;
    if (paymentRub <= 0) return;

    const purchasedTokens = Number(transaction.amount) || 0;
    if (purchasedTokens <= 0) return;

    const cashbackAmount = roundTokens(purchasedTokens * REFERRAL_CASHBACK_RATE);
    if (cashbackAmount <= 0) return;

    const referrerId = userDoc.referredBy.toString();

    await this.usersService.addCashback(referrerId, cashbackAmount, true);

    try {
      await this.referralService.markReferralPurchase(
        transaction.userId.toString(),
        cashbackAmount,
      );
    } catch (err: any) {
      this.logger.warn(`Failed to update Referral record: ${err.message}`);
    }

    await this.createTransaction(referrerId, {
      type: TransactionType.REFERRAL_BONUS,
      amount: cashbackAmount,
      description: `Кэшбек 10% от покупки пользователя ${userDoc.firstName || 'друга'} (+${cashbackAmount}🔥)`,
      paymentStatus: PaymentStatus.COMPLETED,
      referralUserId: transaction.userId,
      metadata: {
        cashback: true,
        sourcePurchasedTokens: purchasedTokens,
        sourcePaymentRub: paymentRub,
        sourceTransactionId: transaction._id.toString(),
      },
    });

    this.logger.log(
      `💰 Cashback +${cashbackAmount}🔥 → user ${referrerId} (10% of ${purchasedTokens}🔥 purchased)`,
    );
  }


  // ═══════════════════════════════════════════════════════════════
  // 🔥 СПИСАНИЕ ЗА ГЕНЕРАЦИЮ (для текста — sync-режим)
  // ═══════════════════════════════════════════════════════════════

  async chargeForGeneration(
    userId: string,
    modelSlug: string,
    generationType: string,
    generationId: string,
    inputTokens?: number,
    outputTokens?: number,
    params?: Record<string, any>,
    cachedTokens?: number,
  ) {
    // 🆕 Проверка бесплатного доступа учитывает params (для гибкости в будущем)
    const freeAccess = await this.checkFreeModelAccess(userId, modelSlug, params);

    if (freeAccess.isFree) {
      const userFree = await this.usersService.findById(userId);
      const totalFree = roundTokens(
        userFree.tokenBalance +
          userFree.bonusTokens +
          (userFree.cashbackBalance || 0),
      );

      await this.createTransaction(userId, {
        type: TransactionType.GENERATION,
        amount: 0,
        description: `Генерация ${generationType}: ${modelSlug} (бесплатно по подписке)`,
        paymentStatus: PaymentStatus.COMPLETED,
        generationId,
        generationType,
        modelSlug,
        balanceBefore: totalFree,
        balanceAfter: totalFree,
        metadata: {
          freeAccess: true, // 🔑 КЛЮЧЕВОЙ флаг для подсчёта лимитов
          inputTokens,
          outputTokens,
          cachedTokens,
          params,
        },
      });

      return {
        costInTokens: 0,
        costInDollars: 0,
        freeAccess: true,
      };
    }

    const { costInDollars, costInTokens, matchedTier } =
      await this.calculateGenerationCost(
        modelSlug,
        inputTokens,
        outputTokens,
        params,
        cachedTokens,
      );

    // Снимок ПЕРЕД списанием
    const userBefore = await this.usersService.findById(userId);
    const balanceBefore = roundTokens(
      userBefore.tokenBalance +
        userBefore.bonusTokens +
        (userBefore.cashbackBalance || 0),
    );

    const userAfter = await this.usersService.deductTokens(
      userId,
      costInTokens,
      'generation',
    );
    const balanceAfter = roundTokens(
      userAfter.tokenBalance +
        userAfter.bonusTokens +
        (userAfter.cashbackBalance || 0),
    );

    await this.createTransaction(userId, {
      type: TransactionType.GENERATION,
      amount: -costInTokens,
      description: `Генерация ${generationType}: ${modelSlug}${matchedTier ? ` (${matchedTier})` : ''}`,
      paymentStatus: PaymentStatus.COMPLETED,
      generationId,
      generationType,
      modelSlug,
      balanceBefore,
      balanceAfter,
      inputTokens: inputTokens || 0,
      outputTokens: outputTokens || 0,
      costInDollars,
      costInTokens,
      metadata: {
        inputTokens,
        outputTokens,
        cachedTokens,
        costInDollars,
        freeAccess: false,
        params,
        matchedTier,
      },
    });

    return { costInTokens, costInDollars, freeAccess: false };
  }


  // ═══════════════════════════════════════════════════════════════
  // 🆕 Запись медиа-генерации (async-режим, после успеха провайдера)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Вызывается из Consumer'а после успешной генерации.
   *
   * 🆕 Корректно обрабатывает freeAccess:
   *   - если params.freeAccess=true ИЛИ costInTokens<=0 → пишет amount=0,
   *     freeAccess=true (чтобы checkFreeModelAccess правильно считал лимиты)
   *   - иначе → обычное платное списание
   */
    async recordMediaGeneration(
    userId: string,
    params: {
      modelSlug: string;
      generationType: 'image' | 'video' | 'audio';
      generationId: string;
      costInTokens: number;
      costInDollars: number;
      matchedTier?: string;
      generationParams?: Record<string, any>;
      providerSlug?: string;
      providerJobId?: string;
      freeAccess?: boolean; // 🆕 явный флаг бесплатной генерации
    },
  ) {
    const isFree = !!params.freeAccess || params.costInTokens <= 0;
    const cost = isFree ? 0 : finalizeTokenCost(params.costInTokens);

    // 🔧 Списание токенов уже произошло в preChargeMediaGeneration().
    //    Здесь мы только пишем АУДИТ-транзакцию по факту успешной генерации.
    //    Поэтому balanceBefore == balanceAfter (никаких "восстановлений").
    const user = await this.usersService.findById(userId);
    const balanceAfter = roundTokens(
      user.tokenBalance + user.bonusTokens + (user.cashbackBalance || 0),
    );
    const balanceBefore = balanceAfter;

    await this.createTransaction(userId, {
      type: TransactionType.GENERATION,
      amount: isFree ? 0 : -cost,
      description:
        `Генерация ${params.generationType}: ${params.modelSlug}` +
        (params.matchedTier ? ` (${params.matchedTier})` : '') +
        (isFree ? ' (бесплатно по подписке)' : ''),
      paymentStatus: PaymentStatus.COMPLETED,
      generationId: params.generationId,
      generationType: params.generationType,
      modelSlug: params.modelSlug,
      balanceBefore,
      balanceAfter,
      costInDollars: isFree ? 0 : params.costInDollars,
      costInTokens: cost,
      metadata: {
        costInDollars: isFree ? 0 : params.costInDollars,
        matchedTier: params.matchedTier,
        params: params.generationParams,
        providerSlug: params.providerSlug,
        providerJobId: params.providerJobId,
        freeAccess: isFree, // 🔑 ключевой флаг для подсчёта лимитов
        asyncMode: true,
      },
    });

    this.logger.log(
      `📝 Recorded media generation: ${params.modelSlug} | ` +
        (isFree ? `FREE` : `-${cost}🔥`) +
        ` | user=${userId}`,
    );
  }


  /**
   * Pre-charge для медиа-генерации (резервируем спички ПЕРЕД отправкой провайдеру).
   *
   * 🆕 Учитывает params в checkFreeModelAccess.
   * 🆕 Возвращает freeAccess — Consumer должен пробросить это в recordMediaGeneration.
   */
  async preChargeMediaGeneration(
    userId: string,
    modelSlug: string,
    generationParams?: Record<string, any>,
  ): Promise<{
    costInTokens: number;
    costInDollars: number;
    matchedTier?: string;
    freeAccess: boolean;
    balanceBefore: number;
    balanceAfter: number;
  }> {
    const freeAccess = await this.checkFreeModelAccess(
      userId,
      modelSlug,
      generationParams,
    );

    if (freeAccess.isFree) {
      const user = await this.usersService.findById(userId);
      const total = roundTokens(
        user.tokenBalance + user.bonusTokens + (user.cashbackBalance || 0),
      );
      return {
        costInTokens: 0,
        costInDollars: 0,
        freeAccess: true,
        balanceBefore: total,
        balanceAfter: total,
      };
    }

    const { costInDollars, costInTokens, matchedTier } =
      await this.calculateGenerationCost(
        modelSlug,
        undefined,
        undefined,
        generationParams,
      );

    const userBefore = await this.usersService.findById(userId);
    const balanceBefore = roundTokens(
      userBefore.tokenBalance +
        userBefore.bonusTokens +
        (userBefore.cashbackBalance || 0),
    );

    if (balanceBefore + FLOAT_EPSILON < costInTokens) {
      throw new BadRequestException(
        `Недостаточно токенов. Требуется: ${costInTokens}🔥, доступно: ${balanceBefore}🔥`,
      );
    }

    const userAfter = await this.usersService.deductTokens(
      userId,
      costInTokens,
      'generation',
    );
    const balanceAfter = roundTokens(
      userAfter.tokenBalance +
        userAfter.bonusTokens +
        (userAfter.cashbackBalance || 0),
    );

    return {
      costInTokens,
      costInDollars,
      matchedTier,
      freeAccess: false,
      balanceBefore,
      balanceAfter,
    };
  }


  // ═══════════════════════════════════════════════════════════════
  // Рефанд
  // ═══════════════════════════════════════════════════════════════

  async recordRefund(
    userId: string,
    amount: number,
    description: string,
    generationId: string,
  ) {
    const refundAmount = roundTokens(amount);
    if (refundAmount <= 0) {
      this.logger.warn(
        `recordRefund: skip non-positive refund (${amount}) for user ${userId}`,
      );
      return;
    }

    const userBefore = await this.usersService.findById(userId);
    const balanceBefore = roundTokens(
      userBefore.tokenBalance +
        userBefore.bonusTokens +
        (userBefore.cashbackBalance || 0),
    );

    await this.usersService.refundTokens(userId, refundAmount);

    const userAfter = await this.usersService.findById(userId);
    const balanceAfter = roundTokens(
      userAfter.tokenBalance +
        userAfter.bonusTokens +
        (userAfter.cashbackBalance || 0),
    );

    await this.createTransaction(userId, {
      type: TransactionType.REFUND,
      amount: refundAmount,
      description,
      paymentStatus: PaymentStatus.COMPLETED,
      generationId,
      balanceBefore,
      balanceAfter,
      metadata: {
        refund: true,
      },
    });

    this.logger.log(
      `↩️ Refund recorded: +${refundAmount}🔥 → user ${userId} | ${description}`,
    );
  }


  // ═══════════════════════════════════════════════════════════════
  // Промокоды — standalone применение (для BONUS_TOKENS)
  // ═══════════════════════════════════════════════════════════════

  async applyPromoCode(userId: string, code: string) {
    const validation = await this.promoCodeService.validate(code, userId, {
      purchaseType: 'standalone',
    });

    const promo = validation.promo;

    if (promo.type !== PromoCodeType.BONUS_TOKENS) {
      throw new BadRequestException(
        'Этот промокод применяется при оплате. Введите его на странице покупки.',
      );
    }

    const userBefore = await this.usersService.findById(userId);
    const balanceBefore = roundTokens(
      userBefore.tokenBalance +
        userBefore.bonusTokens +
        (userBefore.cashbackBalance || 0),
    );

    const user = await this.usersService.addBonusTokens(
      userId,
      validation.bonusTokens,
    );

    await this.promoCodeService.markUsed(promo._id, userId, {
      bonusTokens: validation.bonusTokens,
    });

    const balanceAfter = roundTokens(
      user.tokenBalance + user.bonusTokens + (user.cashbackBalance || 0),
    );

    await this.createTransaction(userId, {
      type: TransactionType.PROMO_CODE,
      amount: validation.bonusTokens,
      description: `Промокод ${promo.code}: +${validation.bonusTokens} 🔥 спичек`,
      paymentStatus: PaymentStatus.COMPLETED,
      promoCode: promo.code,
      balanceBefore,
      balanceAfter,
      metadata: {
        promoId: promo._id.toString(),
        promoType: promo.type,
      },
    });

    return {
      success: true,
      effectLabel: validation.effectLabel,
      bonusTokens: validation.bonusTokens,
      newBalance: balanceAfter,
    };
  }


  // ═══════════════════════════════════════════════════════════════
  // Подписки (с поддержкой промокода)
  // ═══════════════════════════════════════════════════════════════

  async createSubscription(
    userId: string,
    plan: SubscriptionPlan,
    provider: ProviderName,
    currency: 'RUB' | 'USD' = 'RUB',
    returnUrl?: string,
    promoCode?: string,
  ) {
    if (plan === SubscriptionPlan.FREE) {
      throw new BadRequestException('Cannot subscribe to free plan');
    }

    const planConfig = await this.getPlanConfig(plan);
    if (!planConfig) throw new BadRequestException('Invalid plan');

    const effectivePlan = (PLAN_MIGRATION[plan] || plan) as SubscriptionPlan;
    const paymentProvider = this.getPaymentProvider(provider);

    let promoValidation: Awaited<
      ReturnType<typeof this.promoCodeService.validate>
    > | null = null;
    let finalPriceRub = planConfig.priceRub;

    if (promoCode) {
      promoValidation = await this.promoCodeService.validate(
        promoCode,
        userId,
        {
          purchaseType: 'subscription',
          amountRub: planConfig.priceRub,
          planKey: String(effectivePlan).toLowerCase(),
        },
      );

      // SUBSCRIPTION_DAYS — даёт бесплатные дни без оплаты
      if (promoValidation.promo.type === PromoCodeType.SUBSCRIPTION_DAYS) {
        const promoPlan = promoValidation.subscriptionPlan?.toLowerCase();
        const targetPlan = String(effectivePlan).toLowerCase();

        if (promoPlan && promoPlan !== targetPlan) {
          throw new BadRequestException(
            `Промокод даёт бесплатные дни плана ${promoPlan.toUpperCase()}, а не ${targetPlan.toUpperCase()}`,
          );
        }

        await this.activateSubscriptionForDays(
          userId,
          effectivePlan,
          promoValidation.subscriptionDays,
        );

        await this.promoCodeService.markUsed(
          promoValidation.promo._id,
          userId,
          {
            subscriptionDays: promoValidation.subscriptionDays,
          },
        );

        await this.createTransaction(userId, {
          type: TransactionType.PROMO_CODE,
          amount: 0,
          description: `Промокод ${promoValidation.promo.code}: ${promoValidation.subscriptionDays} дней ${planConfig.name} бесплатно`,
          paymentStatus: PaymentStatus.COMPLETED,
          promoCode: promoValidation.promo.code,
          metadata: {
            promoId: promoValidation.promo._id.toString(),
            promoType: promoValidation.promo.type,
            subscriptionDays: promoValidation.subscriptionDays,
            plan: effectivePlan,
          },
        });

        return {
          paymentId: null,
          paymentUrl: null,
          freeByPromo: true,
          subscriptionDays: promoValidation.subscriptionDays,
          plan: {
            id: effectivePlan,
            name: planConfig.name,
            price: 0,
            currency,
            tokensPerMonth: 0,
            bonusTokens: 0,
          },
          promo: {
            code: promoValidation.promo.code,
            effectLabel: promoValidation.effectLabel,
          },
        };
      }

      finalPriceRub = promoValidation.finalAmountRub;

      this.logger.log(
        `🎟 Promo ${promoValidation.promo.code} applied to plan ${effectivePlan}: ` +
          `${planConfig.priceRub}₽ → ${finalPriceRub}₽`,
      );
    }

    // ── Полная скидка → активируем без платежа ─────────────────
    if (finalPriceRub === 0 && promoValidation) {
      await this.activateSubscription(userId, effectivePlan);

      await this.promoCodeService.markUsed(promoValidation.promo._id, userId, {
        discountRub: planConfig.priceRub,
      });

      await this.createTransaction(userId, {
        type: TransactionType.SUBSCRIPTION,
        amount: planConfig.tokensPerMonth,
        description: `Подписка ${planConfig.name} (бесплатно по промокоду ${promoValidation.promo.code})`,
        paymentStatus: PaymentStatus.COMPLETED,
        paymentProvider: provider,
        paymentAmountRub: 0,
        promoCode: promoValidation.promo.code,
        metadata: {
          plan: effectivePlan,
          currency,
          paymentAmount: 0,
          originalPriceRub: planConfig.priceRub,
          promoDiscountRub: planConfig.priceRub,
          fullPrice: true,
          freeByPromo: true,
        },
      });

      return {
        paymentId: null,
        paymentUrl: null,
        freeByPromo: true,
        plan: {
          id: effectivePlan,
          name: planConfig.name,
          price: 0,
          currency,
          tokensPerMonth: planConfig.tokensPerMonth,
          bonusTokens: planConfig.bonusTokens,
        },
        promo: {
          code: promoValidation.promo.code,
          effectLabel: promoValidation.effectLabel,
        },
      };
    }

        // ── Обычный поток с оплатой ────────────────────────────────
    const paymentAmount = this.convertPrice(finalPriceRub, currency);

    const result = await paymentProvider.createPayment({
      amount: paymentAmount,
      currency,
      tokens: planConfig.tokensPerMonth,
      userId,
      description: `Подписка: ${planConfig.name}`,
      returnUrl,
    });

    if (!result.success) {
      throw new BadRequestException(result.error || 'Subscription creation failed');
    }

    await this.createTransaction(userId, {
      type: TransactionType.SUBSCRIPTION,
      amount: planConfig.tokensPerMonth,
      description: `Подписка: ${planConfig.name}${promoValidation ? ` [промокод ${promoValidation.promo.code}]` : ''}`,
      paymentStatus: PaymentStatus.PENDING,
      externalPaymentId: result.paymentId,
      paymentProvider: provider,
      paymentAmountRub: finalPriceRub,
      promoCode: promoValidation?.promo.code,
      metadata: {
        plan: effectivePlan,
        currency,
        paymentAmount,
        originalPriceRub: planConfig.priceRub,
        finalPriceRub,
        promoCodeApplied: promoValidation
          ? {
              promoId: promoValidation.promo._id.toString(),
              code: promoValidation.promo.code,
              type: promoValidation.promo.type,
              discountRub: promoValidation.discountRub,
              bonusTokens: promoValidation.bonusTokens,
            }
          : null,
      },
    });

    return {
      paymentId: result.paymentId,
      paymentUrl: result.paymentUrl,
      plan: {
        id: effectivePlan,
        name: planConfig.name,
        price: paymentAmount,
        originalPrice: this.convertPrice(planConfig.priceRub, currency),
        discountApplied: promoValidation?.discountRub || 0,
        currency,
        tokensPerMonth: planConfig.tokensPerMonth,
        bonusTokens: planConfig.bonusTokens,
      },
      promo: promoValidation
        ? {
            code: promoValidation.promo.code,
            effectLabel: promoValidation.effectLabel,
            discountRub: promoValidation.discountRub,
          }
        : null,
    };
  }


  async activateSubscription(userId: string, plan: SubscriptionPlan) {
    const effectivePlan = (PLAN_MIGRATION[plan] || plan) as SubscriptionPlan;
    const planConfig = await this.getPlanConfig(effectivePlan);
    if (!planConfig) throw new BadRequestException('Invalid plan');

    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 1);

    await this.subscriptionModel.create({
      userId: new Types.ObjectId(userId),
      plan: effectivePlan,
      startDate,
      endDate,
      isActive: true,
      tokensPerMonth: planConfig.tokensPerMonth,
      bonusTokens: planConfig.bonusTokens,
    });

    await this.usersService.updateSubscription(
      userId,
      effectivePlan,
      endDate,
    );

    await this.usersService.addTokens(userId, planConfig.tokensPerMonth);
    if (planConfig.bonusTokens > 0) {
      await this.usersService.addBonusTokens(userId, planConfig.bonusTokens);
    }

    this.logger.log(
      `✅ Subscription ${effectivePlan} activated for user ${userId} (until ${endDate.toISOString()})`,
    );
  }


  private async activateSubscriptionForDays(
    userId: string,
    plan: SubscriptionPlan,
    days: number,
  ) {
    const effectivePlan = (PLAN_MIGRATION[plan] || plan) as SubscriptionPlan;
    const planConfig = await this.getPlanConfig(effectivePlan);
    if (!planConfig) throw new BadRequestException('Invalid plan');

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);

    await this.subscriptionModel.create({
      userId: new Types.ObjectId(userId),
      plan: effectivePlan,
      startDate,
      endDate,
      isActive: true,
      tokensPerMonth: 0,
      bonusTokens: 0,
      metadata: { activatedByPromo: true, days },
    });

    await this.usersService.updateSubscription(userId, effectivePlan, endDate);

    this.logger.log(
      `✅ Promo subscription ${effectivePlan} (${days} days) activated for user ${userId} (until ${endDate.toISOString()})`,
    );
  }


  // ═══════════════════════════════════════════════════════════════
  // Расчёт стоимости генерации
  // ═══════════════════════════════════════════════════════════════

  async calculateGenerationCost(
    modelSlug: string,
    inputTokens?: number,
    outputTokens?: number,
    params?: Record<string, any>,
    cachedTokens?: number,
  ): Promise<{
    costInDollars: number;
    costInTokens: number;
    matchedTier?: string;
  }> {
    const model = await this.modelModel.findOne({ slug: modelSlug });
    if (!model) {
      throw new NotFoundException(`Model ${modelSlug} not found`);
    }

    // ── 1. Текстовые модели ─────────────────────────────────────
    if (model.type === 'text') {
      const inputUsed = inputTokens ?? 0;
      const outputUsed = outputTokens ?? 0;

      const cachedUsed = Math.min(cachedTokens ?? 0, inputUsed);
      const billableInput = Math.max(inputUsed - cachedUsed, 0);

      const inputCostUsd =
        (billableInput * (model.pricePerMillionInputTokens ?? 0)) / 1_000_000;
      const cachedCostUsd =
        (cachedUsed *
          (model.pricePerMillionInputTokens ?? 0) *
          0.1) /
        1_000_000;
      const outputCostUsd =
        (outputUsed * (model.pricePerMillionOutputTokens ?? 0)) / 1_000_000;

      const totalUsd = inputCostUsd + cachedCostUsd + outputCostUsd;

      const tokensPerDollar = model.tokensPerDollar || 1000;
      let costInTokens = totalUsd * tokensPerDollar;

      // Учёт web_search
      if (params?.useWebSearch && model.webSearchCostInTokens) {
        costInTokens += model.webSearchCostInTokens;
      }

      const minCost = model.minTokenCost || MIN_CHARGE_TOKENS;
      const finalCost = finalizeTokenCost(Math.max(minCost, costInTokens));

      return {
        costInDollars: Math.round(totalUsd * 1000) / 1000,
        costInTokens: finalCost,
        matchedTier: undefined,
      };
    }

    // ── 2. Медиа-модели с pricingMatrix ─────────────────────────
    const matrix = (model as any).pricingMatrix as Array<{
      conditions?: Record<string, any>;
      costInTokens: number;
      costInDollars: number;
      label?: string;
    }>;

    if (Array.isArray(matrix) && matrix.length > 0) {
      const matched = this.findMatrixRow(matrix, params);
      if (matched) {
        return {
          costInDollars: matched.costInDollars,
          costInTokens: finalizeTokenCost(matched.costInTokens),
          matchedTier: matched.label,
        };
      }

      const fallback = matrix.find(
        (r) => !r.conditions || Object.keys(r.conditions).length === 0,
      );
      if (fallback) {
        return {
          costInDollars: fallback.costInDollars,
          costInTokens: finalizeTokenCost(fallback.costInTokens),
          matchedTier: fallback.label,
        };
      }
    }

    // ── 3. Фиксированная стоимость ──────────────────────────────
    const tokensPerDollar = model.tokensPerDollar || 90;
    const fixedDollars = (model as any).fixedCostPerGeneration || 0;
    const fixedTokens = fixedDollars * tokensPerDollar;
    const minCost = model.minTokenCost || MIN_CHARGE_TOKENS;

    return {
      costInDollars: fixedDollars,
      costInTokens: finalizeTokenCost(Math.max(minCost, fixedTokens)),
      matchedTier: 'fixed',
    };
  }


  /**
   * Находит строку pricingMatrix, чьи conditions полностью совпадают с params.
   * Поддерживает == для number/string/boolean.
   */
  private findMatrixRow(
    matrix: Array<{ conditions?: Record<string, any>; costInTokens: number; costInDollars: number; label?: string }>,
    params?: Record<string, any>,
  ) {
    if (!params) return null;

    for (const row of matrix) {
      if (!row.conditions || Object.keys(row.conditions).length === 0) continue;

      let match = true;
      for (const key of Object.keys(row.conditions)) {
        const expected = row.conditions[key];
        const got = params[key];
        // eslint-disable-next-line eqeqeq
        if (expected != got) {
          match = false;
          break;
        }
      }

      if (match) return row;
    }

    return null;
  }


  // ═══════════════════════════════════════════════════════════════
  // Превью стоимости (для UI)
  // ═══════════════════════════════════════════════════════════════

  async getModelPreviewCost(modelSlug: string): Promise<ModelPreviewCost> {
    const model = await this.modelModel.findOne({ slug: modelSlug });
    if (!model) throw new NotFoundException(`Model ${modelSlug} not found`);

    if (model.type === 'text') {
      const avgTokens = (model as any).avgTokensPerRequest || 1500;
      const inputPrice = model.pricePerMillionInputTokens || 0;
      const outputPrice = model.pricePerMillionOutputTokens || 0;

      const avgUsd =
        (avgTokens * (0.3 * inputPrice + 0.7 * outputPrice)) / 1_000_000;
      const tokensPerDollar = model.tokensPerDollar || 1000;
      const avgCost = Math.max(
        model.minTokenCost || MIN_CHARGE_TOKENS,
        avgUsd * tokensPerDollar,
      );

      return {
        avgCostInTokens: roundTokens(avgCost),
        minCostInTokens: model.minTokenCost || MIN_CHARGE_TOKENS,
        pricingType: 'per_token',
        details: {
          pricePerMillionInput: inputPrice,
          pricePerMillionOutput: outputPrice,
          avgTokensPerRequest: avgTokens,
        },
      };
    }

    const matrix = (model as any).pricingMatrix as Array<{
      costInTokens: number;
    }>;

    if (Array.isArray(matrix) && matrix.length > 0) {
      const costs = matrix.map((r) => r.costInTokens);
      return {
        avgCostInTokens: roundTokens(
          costs.reduce((a, b) => a + b, 0) / costs.length,
        ),
        minCostInTokens: Math.min(...costs),
        maxCostInTokens: Math.max(...costs),
        pricingType: 'matrix',
        details: {
          min: Math.min(...costs),
          max: Math.max(...costs),
        },
      };
    }

    const tokensPerDollar = model.tokensPerDollar || 90;
    const fixed = ((model as any).fixedCostPerGeneration || 0) * tokensPerDollar;
    const cost = Math.max(model.minTokenCost || MIN_CHARGE_TOKENS, fixed);

    return {
      avgCostInTokens: roundTokens(cost),
      minCostInTokens: model.minTokenCost || MIN_CHARGE_TOKENS,
      pricingType: 'fixed',
      details: {},
    };
  }


  // ═══════════════════════════════════════════════════════════════
  // История транзакций
  // ═══════════════════════════════════════════════════════════════

  async getTransactionHistory(userId: string, limit: number = 50, skip: number = 0) {
    const [items, total] = await Promise.all([
      this.transactionModel
        .find({ userId: new Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.transactionModel.countDocuments({ userId: new Types.ObjectId(userId) }),
    ]);

    return { items, total, limit, skip };
  }


  async getActiveSubscription(userId: string) {
    return this.subscriptionModel
      .findOne({
        userId: new Types.ObjectId(userId),
        isActive: true,
        endDate: { $gt: new Date() },
      })
      .sort({ endDate: -1 })
      .lean();
  }


  // ═══════════════════════════════════════════════════════════════
  // Внутренние утилиты
  // ═══════════════════════════════════════════════════════════════

  private getPaymentProvider(provider: ProviderName) {
    switch (provider) {
      case 'yookassa':
        return this.yookassaProvider;
      case 'cryptomus':
        return this.cryptomusProvider;
      case 'stars':
        return this.starsProvider;
      case 'freedompay':
        return this.freedompayProvider;
      case 'tochka':
        return this.tochkaProvider;
      case 'heleket':
        return this.heleketProvider;
      default:
        throw new BadRequestException(`Unknown payment provider: ${provider}`);
    }
  }


  private async createTransaction(
    userId: string,
    data: Partial<Transaction>,
  ): Promise<TransactionDocument> {
    return this.transactionModel.create({
      userId: new Types.ObjectId(userId),
      ...data,
    });
  }


  // ═══════════════════════════════════════════════════════════════
  // Миграции
  // ═══════════════════════════════════════════════════════════════

  private async migrateDeprecatedSubscriptions() {
    for (const [oldPlan, newPlan] of Object.entries(PLAN_MIGRATION)) {
      const result = await this.subscriptionModel.updateMany(
        { plan: oldPlan, isActive: true },
        { $set: { plan: newPlan } },
      );
      if (result.modifiedCount > 0) {
        this.logger.warn(
          `🔁 Migrated ${result.modifiedCount} active subscriptions: ${oldPlan} → ${newPlan}`,
        );
      }

      await this.usersService.migrateUserPlan(oldPlan as any, newPlan);
    }
  }


  // ═══════════════════════════════════════════════════════════════
  // CRON: ежедневная проверка истекших подписок
  // ═══════════════════════════════════════════════════════════════

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async checkExpiredSubscriptions() {
    const now = new Date();
    const expired = await this.subscriptionModel.find({
      isActive: true,
      endDate: { $lte: now },
    });

    for (const sub of expired) {
      sub.isActive = false;
      await sub.save();

      try {
        await this.usersService.downgradeToFree(sub.userId.toString());
        this.logger.log(
          `⏰ Subscription ${sub.plan} expired for user ${sub.userId} → downgraded to FREE`,
        );
      } catch (err: any) {
        this.logger.error(
          `Failed to downgrade user ${sub.userId}: ${err.message}`,
        );
      }
    }

    if (expired.length > 0) {
      this.logger.log(`🧹 Processed ${expired.length} expired subscriptions`);
    }
  }
}