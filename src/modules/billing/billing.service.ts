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

// ─── Курс конвертации ────────────────────────────────────────────
const RUB_TO_USD_RATE = 75;

// ─── 🆕 Глобальные константы точности ────────────────────────────
const MIN_CHARGE_TOKENS = 0.01;
const TOKEN_PRECISION = 2;
const FLOAT_EPSILON = 1e-9;

// 🆕 Кэшбек от реферальных покупок (10%)
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
  },
  [SubscriptionPlan.MAX]: {
    name: 'Max',
    priceRub: 2490,
    tokensPerMonth: 830,
    bonusTokens: 50,
    modelsAccess: 'full',
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
  },
  [SubscriptionPlan.ULTIMATE]: {
    name: 'Ultimate',
    priceRub: 5990,
    tokensPerMonth: 1997,
    bonusTokens: 220,
    modelsAccess: 'full',
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
  ) { }

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
  // Проверка бесплатного доступа к модели
  // ═══════════════════════════════════════════════════════════════

  async checkFreeModelAccess(
    userId: string,
    modelSlug: string,
  ): Promise<{ isFree: boolean; reason?: string }> {
    const user = await this.usersService.findById(userId);
    const planConfig = await this.getPlanConfig(user.subscriptionPlan);

    if (!planConfig) return { isFree: false };

    const freeModel = planConfig.freeModels.find(
      (fm) => fm.modelSlug === modelSlug,
    );
    if (!freeModel) return { isFree: false };

    // Безлимит
    if (freeModel.hourlyLimit === null && freeModel.dailyLimit === null) {
      return { isFree: true };
    }

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
      return {
        isFree: false,
        reason: `Лимит ${freeModel.hourlyLimit}/час исчерпан. Следующий через ${60 - now.getMinutes()} мин`,
      };
    }

    if (freeModel.dailyLimit !== null && dailyCount >= freeModel.dailyLimit) {
      return {
        isFree: false,
        reason: `Дневной лимит ${freeModel.dailyLimit} исчерпан`,
      };
    }

    return { isFree: true };
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
      description: `Пополнение: ${pack.label}${bonusTokensFromPack > 0 ? ` (+${bonusTokensFromPack} бонус)` : ''
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

    const transaction = await this.transactionModel.findOne({
      externalPaymentId: result.paymentId,
      paymentStatus: PaymentStatus.PENDING,
    });

    if (!transaction) {
      this.logger.warn(
        `No pending transaction for payment ${result.paymentId}`,
      );
      return { processed: false };
    }

    if (result.status === 'completed') {
      const user = await this.usersService.addTokens(
        transaction.userId.toString(),
        transaction.amount,
      );

      transaction.paymentStatus = PaymentStatus.COMPLETED;
      // 🆕 Учитываем cashbackBalance, чтобы балансы сходились с остальным кодом
      transaction.balanceAfter = roundTokens(
        user.tokenBalance + user.bonusTokens + (user.cashbackBalance || 0),
      );
      await transaction.save();

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

      if (
        transaction.type === TransactionType.SUBSCRIPTION &&
        transaction.metadata?.plan
      ) {
        await this.activateSubscription(
          transaction.userId.toString(),
          transaction.metadata.plan as SubscriptionPlan,
        );
      }

      await this.processReferralBonus(transaction);

      this.logger.log(
        `✅ Payment ${result.paymentId} completed: ${transaction.amount} tokens → user ${transaction.userId}`,
      );

      return { processed: true, status: 'completed' };
    }

    if (result.status === 'failed') {
      transaction.paymentStatus = PaymentStatus.FAILED;
      await transaction.save();
      return { processed: true, status: 'failed' };
    }

    return { processed: false, status: 'pending' };
  }

  // ═══════════════════════════════════════════════════════════════
  // Реферальный бонус
  // ═══════════════════════════════════════════════════════════════

  /**
   * 🆕 Кэшбек считаем от суммы платежа в РУБЛЯХ (paymentAmountRub),
   * потому что 1 спичка ≈ 1 ₽ (используется при выводе).
   *
   * Раньше cashback считался от transaction.amount (количество токенов),
   * что давало неправильную сумму для пакетов с бонусами.
   */
  private async processReferralBonus(transaction: TransactionDocument) {
    const userDoc = await this.usersService.findById(
      transaction.userId.toString(),
    );
    if (!userDoc.referredBy) return;

    const paymentRub = Number(transaction.paymentAmountRub) || 0;
    if (paymentRub <= 0) {
      // Бесплатные транзакции (по промокоду) не дают кэшбек
      return;
    }

    const cashbackAmount = roundTokens(paymentRub * REFERRAL_CASHBACK_RATE);
    if (cashbackAmount <= 0) return;

    const referrerId = userDoc.referredBy.toString();

    // fromReferral=true (по умолчанию) → попадёт и в referralEarnings
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
      description: `Кэшбек 10% от покупки пользователя ${userDoc.firstName || 'друга'}`,
      paymentStatus: PaymentStatus.COMPLETED,
      referralUserId: transaction.userId,
      metadata: {
        cashback: true,
        sourcePaymentRub: paymentRub,
        sourceTransactionId: transaction._id.toString(),
      },
    });

    this.logger.log(
      `💰 Cashback +${cashbackAmount}🔥 → user ${referrerId} (10% of ${paymentRub}₽)`,
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔥 СПИСАНИЕ ЗА ГЕНЕРАЦИЮ
  // ═══════════════════════════════════════════════════════════════

  async chargeForGeneration(
    userId: string,
    modelSlug: string,
    generationType: string,
    generationId: string,
    inputTokens?: number,
    outputTokens?: number,
    params?: Record<string, any>,
  ) {
    const freeAccess = await this.checkFreeModelAccess(userId, modelSlug);

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
          freeAccess: true,
          inputTokens,
          outputTokens,
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
      );

    // 🆕 Снимаем актуальный баланс ПЕРЕД списанием
    const userBefore = await this.usersService.findById(userId);
    const balanceBefore = roundTokens(
      userBefore.tokenBalance +
      userBefore.bonusTokens +
      (userBefore.cashbackBalance || 0),
    );

    // Атомарное списание (с retry внутри UsersService)
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
        costInDollars,
        freeAccess: false,
        params,
        matchedTier,
      },
    });

    return { costInTokens, costInDollars, freeAccess: false };
  }

  // ═══════════════════════════════════════════════════════════════
  // Запись медиа-генерации с готовой ценой (async режим)
  // ═══════════════════════════════════════════════════════════════

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
    },
  ) {
    const cost = finalizeTokenCost(params.costInTokens);
    const user = await this.usersService.findById(userId);
    const balanceAfter = roundTokens(
      user.tokenBalance + user.bonusTokens + (user.cashbackBalance || 0),
    );
    const balanceBefore = roundTokens(balanceAfter + cost);

    await this.createTransaction(userId, {
      type: TransactionType.GENERATION,
      amount: -cost,
      description: `Генерация ${params.generationType}: ${params.modelSlug}${params.matchedTier ? ` (${params.matchedTier})` : ''
        }`,
      paymentStatus: PaymentStatus.COMPLETED,
      generationId: params.generationId,
      generationType: params.generationType,
      modelSlug: params.modelSlug,
      balanceBefore,
      balanceAfter,
      costInDollars: params.costInDollars,
      costInTokens: cost,
      metadata: {
        costInDollars: params.costInDollars,
        matchedTier: params.matchedTier,
        params: params.generationParams,
        providerSlug: params.providerSlug,
        providerJobId: params.providerJobId,
        freeAccess: false,
        asyncMode: true,
      },
    });

    this.logger.log(
      `📝 Recorded media generation: ${params.modelSlug} | -${cost}🔥 | user=${userId}`,
    );
  }

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
    const freeAccess = await this.checkFreeModelAccess(userId, modelSlug);

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

    // 🆕 Снимаем актуальный баланс прямо перед списанием
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

    // Атомарное списание — deductTokens сам округляет и защищает от отрицательных
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

    // 🆕 Снимок ПЕРЕД возвратом, чтобы balanceBefore был корректным
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

    // 🆕 Снимок ПЕРЕД начислением
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
      description: `Подписка ${planConfig.name}`,
      returnUrl,
    });

    if (!result.success) {
      throw new BadRequestException(result.error || 'Payment failed');
    }

    await this.createTransaction(userId, {
      type: TransactionType.SUBSCRIPTION,
      amount: planConfig.tokensPerMonth,
      description: `Подписка ${planConfig.name}${promoValidation ? ` [промокод ${promoValidation.promo.code}]` : ''
        }`,
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

  // 🆕 АТОМАРНАЯ активация подписки — без user.save(), баланс не затирается
  async activateSubscription(userId: string, plan: SubscriptionPlan) {
    const planConfig = await this.getPlanConfig(plan);
    if (!planConfig) return;

    const effectivePlan = (PLAN_MIGRATION[plan] || plan) as SubscriptionPlan;

    const now = new Date();
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + 1);

    await this.subscriptionModel.updateMany(
      { userId: new Types.ObjectId(userId), isActive: true },
      { isActive: false },
    );

    const subscription = new this.subscriptionModel({
      userId: new Types.ObjectId(userId),
      plan: effectivePlan,
      startDate: now,
      endDate,
      isActive: true,
      tokensPerMonth: planConfig.tokensPerMonth,
      priceRub: planConfig.priceRub,
      features: planConfig.features,
    });
    await subscription.save();

    // 🆕 АТОМАРНОЕ обновление полей подписки на user (вместо user.save())
    await this.usersService.updateSubscription(
      userId,
      effectivePlan,
      endDate,
    );

    await this.usersService.addTokens(userId, planConfig.tokensPerMonth);

    if (planConfig.bonusTokens > 0) {
      await this.usersService.addBonusTokens(userId, planConfig.bonusTokens);

      await this.createTransaction(userId, {
        type: TransactionType.PROMO_CODE,
        amount: planConfig.bonusTokens,
        description: `Бонус подписки ${planConfig.name}: +${planConfig.bonusTokens} токенов`,
        paymentStatus: PaymentStatus.COMPLETED,
        metadata: { subscriptionBonus: true, plan: effectivePlan },
      });
    }

    this.logger.log(
      `✅ Subscription ${effectivePlan} activated for user ${userId} (${planConfig.tokensPerMonth} tokens + ${planConfig.bonusTokens} bonus)`,
    );
  }

  async activateSubscriptionForDays(
    userId: string,
    plan: SubscriptionPlan,
    days: number,
  ) {
    const planConfig = await this.getPlanConfig(plan);
    if (!planConfig) return;

    const effectivePlan = (PLAN_MIGRATION[plan] || plan) as SubscriptionPlan;
    const now = new Date();

    const existing = await this.subscriptionModel.findOne({
      userId: new Types.ObjectId(userId),
      isActive: true,
      endDate: { $gt: now },
    });

    let endDate: Date;

    if (existing && existing.plan === effectivePlan) {
      endDate = new Date(existing.endDate);
      endDate.setDate(endDate.getDate() + days);
      existing.endDate = endDate;
      await existing.save();
    } else {
      if (existing) {
        existing.isActive = false;
        await existing.save();
      }

      endDate = new Date(now);
      endDate.setDate(endDate.getDate() + days);

      const subscription = new this.subscriptionModel({
        userId: new Types.ObjectId(userId),
        plan: effectivePlan,
        startDate: now,
        endDate,
        isActive: true,
        tokensPerMonth: 0,
        priceRub: 0,
        features: planConfig.features,
      });
      await subscription.save();
    }

    // 🆕 АТОМАРНОЕ обновление user (вместо user.save())
    await this.usersService.updateSubscription(
      userId,
      effectivePlan,
      endDate,
    );

    this.logger.log(
      `🎁 Free subscription ${effectivePlan} for ${days} days → user ${userId} (until ${endDate.toISOString()})`,
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // Баланс
  // ═══════════════════════════════════════════════════════════════

  async getBalance(userId: string) {
    const user = await this.usersService.findById(userId);

    const activeSubscription = await this.subscriptionModel.findOne({
      userId: new Types.ObjectId(userId),
      isActive: true,
      endDate: { $gt: new Date() },
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todaySpent = await this.transactionModel.aggregate([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          type: TransactionType.GENERATION,
          createdAt: { $gte: todayStart },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $abs: '$amount' } },
        },
      },
    ]);

    let subscriptionData: any = null;
    if (activeSubscription) {
      const planConfig = await this.getPlanConfig(
        activeSubscription.plan as SubscriptionPlan,
      );
      subscriptionData = {
        plan: activeSubscription.plan,
        expiresAt: activeSubscription.endDate,
        tokensPerMonth: activeSubscription.tokensPerMonth,
        features: activeSubscription.features,
        freeModels: planConfig?.freeModels || [],
        modelsAccess: planConfig?.modelsAccess || 'limited',
        capabilities: planConfig?.capabilities || [],
        bonusTokens: planConfig?.bonusTokens || 0,
      };
    }

    return {
      tokenBalance: roundTokens(user.tokenBalance),
      bonusTokens: roundTokens(user.bonusTokens),
      cashbackBalance: roundTokens(user.cashbackBalance || 0),
      cashbackEarnedTotal: roundTokens(user.cashbackEarnedTotal || 0),
      totalAvailable: roundTokens(
        user.tokenBalance + user.bonusTokens + (user.cashbackBalance || 0),
      ),
      totalSpent: roundTokens(user.totalTokensSpent),
      totalDeposited: roundTokens(user.totalDeposited),
      todaySpent: roundTokens(todaySpent[0]?.total || 0),
      subscription: subscriptionData,
      dailyGenerations: user.dailyGenerations,
      rates: {
        rubToUsd: RUB_TO_USD_RATE,
        tokenPriceRub: 3,
        tokenPriceUsd: Math.round((3 / RUB_TO_USD_RATE) * 1000) / 1000,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Транзакции
  // ═══════════════════════════════════════════════════════════════

  async getTransactionHistory(
    userId: string,
    type?: TransactionType,
    page = 1,
    limit = 20,
  ) {
    const filter: any = { userId: new Types.ObjectId(userId) };
    if (type) filter.type = type;

    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      this.transactionModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.transactionModel.countDocuments(filter),
    ]);

    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Cron — проверка истёкших подписок (АТОМАРНО, без user.save)
  // ═══════════════════════════════════════════════════════════════

  @Cron(CronExpression.EVERY_HOUR)
  async checkExpiredSubscriptions() {
    const expired = await this.subscriptionModel.find({
      isActive: true,
      endDate: { $lt: new Date() },
    });

    for (const sub of expired) {
      sub.isActive = false;
      await sub.save();

      try {
        // 🆕 АТОМАРНО — больше не дёргаем findById + save (это затирало баланс)
        await this.usersService.updateSubscription(
          sub.userId.toString(),
          SubscriptionPlan.FREE,
          null,
        );
      } catch (err: any) {
        this.logger.warn(
          `Expired subscription: user ${sub.userId} update failed: ${err.message}`,
        );
      }

      this.logger.log(
        `Subscription expired for user ${sub.userId}, plan: ${sub.plan}`,
      );
    }

    if (expired.length > 0) {
      this.logger.log(`Deactivated ${expired.length} expired subscriptions`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Cron — миграция deprecated подписок раз в сутки
  // ═══════════════════════════════════════════════════════════════

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cronMigrateDeprecatedSubscriptions() {
    try {
      await this.migrateDeprecatedSubscriptions();
    } catch (err: any) {
      this.logger.error(`Cron migration failed: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Миграция старых подписок (PRO → PLUS, UNLIMITED → ULTIMATE)
  // ═══════════════════════════════════════════════════════════════

  async migrateDeprecatedSubscriptions() {
    const deprecated = await this.subscriptionModel.find({
      isActive: true,
      plan: { $in: [SubscriptionPlan.PRO, SubscriptionPlan.UNLIMITED] },
    });

    for (const sub of deprecated) {
      const newPlan = PLAN_MIGRATION[sub.plan];
      if (!newPlan) continue;

      const oldPlan = sub.plan;
      sub.plan = newPlan;
      await sub.save();

      try {
        // 🆕 АТОМАРНО — без findById + save
        await this.usersService.updateSubscription(
          sub.userId.toString(),
          newPlan,
          sub.endDate ?? null,
        );
      } catch (err: any) {
        this.logger.warn(
          `Migration: user ${sub.userId} not updated: ${err.message}`,
        );
      }

      this.logger.log(
        `Migrated subscription for user ${sub.userId}: ${oldPlan} → ${newPlan}`,
      );
    }

    if (deprecated.length > 0) {
      this.logger.log(
        `Migrated ${deprecated.length} deprecated subscriptions`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Админ: корректировка баланса
  // ═══════════════════════════════════════════════════════════════

  async adminAdjustBalance(
    adminUserId: string,
    targetUserId: string,
    amount: number,
    reason: string,
  ) {
    const userBefore = await this.usersService.findById(targetUserId);
    const balanceBefore = roundTokens(
      userBefore.tokenBalance +
      userBefore.bonusTokens +
      (userBefore.cashbackBalance || 0),
    );

    if (amount > 0) {
      await this.usersService.addTokens(targetUserId, amount);
    } else if (amount < 0) {
      await this.usersService.deductTokens(
        targetUserId,
        Math.abs(amount),
        'admin_adjustment',
      );
    }

    const userAfter = await this.usersService.findById(targetUserId);
    const balanceAfter = roundTokens(
      userAfter.tokenBalance +
      userAfter.bonusTokens +
      (userAfter.cashbackBalance || 0),
    );

    await this.createTransaction(targetUserId, {
      type: TransactionType.ADMIN_ADJUSTMENT,
      amount: roundTokens(amount),
      description: `Админ-корректировка: ${reason}`,
      paymentStatus: PaymentStatus.COMPLETED,
      balanceBefore,
      balanceAfter,
      metadata: { adminUserId, reason },
    });

    return {
      balanceBefore,
      balanceAfter,
      adjustment: roundTokens(amount),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Статистика
  // ═══════════════════════════════════════════════════════════════

  async getRevenueStats(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [revenue, generations, newSubscriptions] = await Promise.all([
      this.transactionModel.aggregate([
        {
          $match: {
            type: TransactionType.DEPOSIT,
            paymentStatus: PaymentStatus.COMPLETED,
            createdAt: { $gte: since },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt',
              },
            },
            totalRub: { $sum: '$paymentAmountRub' },
            totalTokens: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      this.transactionModel.aggregate([
        {
          $match: {
            type: TransactionType.GENERATION,
            createdAt: { $gte: since },
          },
        },
        {
          $group: {
            _id: '$modelSlug',
            count: { $sum: 1 },
            tokensSpent: { $sum: { $abs: '$amount' } },
          },
        },
        { $sort: { count: -1 } },
      ]),
      this.subscriptionModel.countDocuments({
        createdAt: { $gte: since },
        isActive: true,
      }),
    ]);

    return { revenue, generations, newSubscriptions };
  }

  // ═══════════════════════════════════════════════════════════════
  // Pricing API для фронта
  // ═══════════════════════════════════════════════════════════════

  async getModelPricing(modelSlug: string) {
    const model = await this.modelModel.findOne({ slug: modelSlug }).lean();
    if (!model) throw new NotFoundException(`Model ${modelSlug} not found`);

    const preview = await this.buildPreviewFromModel(model);

    return {
      slug: model.slug,
      name: model.name,
      displayName: model.displayName,
      type: model.type,
      preview,
      defaultCost: {
        costInTokens: preview.avgCostInTokens,
        costInDollars: 0,
      },
      pricingMatrix: model.pricingMatrix || [],
      uiParameters: model.uiParameters || [],
      inputCapabilities: model.inputCapabilities || {
        acceptsImages: false,
        maxInputImages: 0,
      },
      limits: model.limits || {},
      defaultParams: model.defaultParams || {},
    };
  }

  async getModelPreviewCost(modelSlug: string): Promise<ModelPreviewCost> {
    const model = await this.modelModel.findOne({ slug: modelSlug }).lean();
    if (!model) throw new NotFoundException(`Model ${modelSlug} not found`);
    return this.buildPreviewFromModel(model);
  }

  private async buildPreviewFromModel(
    model: ModelDocument | (ModelDocument & { _id: any }) | any,
  ): Promise<ModelPreviewCost> {
    // ─── TEXT ─────────────────────────────────────────────────
    if (model.type === 'text') {
      const inputPrice =
        Number(model.pricePerMillionInputTokens) ||
        Number(model.costPerMillionInputTokens) || 0;
      const outputPrice =
        Number(model.pricePerMillionOutputTokens) ||
        Number(model.costPerMillionOutputTokens) || 0;
      const avgTokens = Number(model.avgTokensPerRequest) || 1500;

      const avgCost = finalizeTokenCost(
        (avgTokens * 0.3 * inputPrice) / 1_000_000 +
        (avgTokens * 0.7 * outputPrice) / 1_000_000,
      );

      // 🆕 Если задан ручной minTokenCost — используем его, иначе формулу
      const minCost =
        Number(model.minTokenCost) > 0
          ? finalizeTokenCost(Number(model.minTokenCost))
          : finalizeTokenCost(
            (60 * inputPrice) / 1_000_000 + (140 * outputPrice) / 1_000_000,
          );

      return {
        avgCostInTokens: avgCost,
        minCostInTokens: minCost,   // → 0.8
        pricingType: 'per_token',
        details: {
          pricePerMillionInput: inputPrice,
          pricePerMillionOutput: outputPrice,
          avgTokensPerRequest: avgTokens,
        },
      };
    }

    // ─── MEDIA с pricingMatrix ────────────────────────────────
    if (
      Array.isArray(model.pricingMatrix) &&
      model.pricingMatrix.length > 0
    ) {
      const costs = model.pricingMatrix
        .map((row: any) => Number(row.costInTokens))
        .filter((n: number) => Number.isFinite(n) && n > 0);

      if (costs.length > 0) {
        const min = Math.min(...costs);
        const max = Math.max(...costs);
        const avg = costs.reduce((a, b) => a + b, 0) / costs.length;

        return {
          avgCostInTokens: finalizeTokenCost(avg),
          minCostInTokens: finalizeTokenCost(min),
          maxCostInTokens: finalizeTokenCost(max),
          pricingType: 'matrix',
          details: {
            min: finalizeTokenCost(min),
            max: finalizeTokenCost(max),
          },
        };
      }
    }

    // ─── MEDIA с фиксированной ценой (fallback) ───────────────
    const fixedDollars = Number(model.fixedCostPerGeneration) || 0;
    const tokensPerDollar = Number(model.tokensPerDollar) || 30;
    const fixed = finalizeTokenCost(fixedDollars * tokensPerDollar);

    return {
      avgCostInTokens: fixed,
      minCostInTokens: fixed,
      maxCostInTokens: fixed,
      pricingType: 'fixed',
      details: {},
    };
  }

  async estimateGenerationCost(
    modelSlug: string,
    params?: Record<string, any>,
    inputTokens?: number,
    outputTokens?: number,
  ) {
    return this.calculateGenerationCost(
      modelSlug,
      inputTokens,
      outputTokens,
      params,
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // Private helpers
  // ═══════════════════════════════════════════════════════════════

  private getPaymentProvider(provider: string) {
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
    data: Partial<Omit<Transaction, 'userId'>>,
  ) {
    const transaction = new this.transactionModel({
      ...data,
      userId: new Types.ObjectId(userId),
      referralUserId: data.referralUserId
        ? new Types.ObjectId(data.referralUserId.toString())
        : undefined,
    });
    return transaction.save();
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔥 РАСЧЁТ СТОИМОСТИ ГЕНЕРАЦИИ
  // ═══════════════════════════════════════════════════════════════

  async calculateGenerationCost(
    modelSlug: string,
    inputTokens?: number,
    outputTokens?: number,
    params?: Record<string, any>,
  ): Promise<{
    costInDollars: number;
    costInTokens: number;
    matchedTier?: string;
  }> {
    const model = await this.modelModel.findOne({ slug: modelSlug });
    if (!model) throw new NotFoundException(`Model ${modelSlug} not found`);

    // ─── TEXT MODELS ───────────────────────────────────────────
    if (model.type === 'text') {
      const newInputPrice = Number(model.pricePerMillionInputTokens) || 0;
      const newOutputPrice = Number(model.pricePerMillionOutputTokens) || 0;

      if (newInputPrice > 0 || newOutputPrice > 0) {
        const inputCost =
          ((inputTokens || 0) * newInputPrice) / 1_000_000;
        const outputCost =
          ((outputTokens || 0) * newOutputPrice) / 1_000_000;

        const costInTokens = finalizeTokenCost(inputCost + outputCost);

        const providerInputCost =
          ((inputTokens || 0) *
            (Number(model.providerCostPerMillionInput) || 0)) /
          1_000_000;
        const providerOutputCost =
          ((outputTokens || 0) *
            (Number(model.providerCostPerMillionOutput) || 0)) /
          1_000_000;
        const costInDollars =
          Math.round((providerInputCost + providerOutputCost) * 1_000_000) /
          1_000_000;

        return { costInDollars, costInTokens };
      }

      // ⚠️ Fallback на старую формулу
      const legacyInputDollars =
        ((inputTokens || 0) *
          (Number(model.costPerMillionInputTokens) || 0)) /
        1_000_000;
      const legacyOutputDollars =
        ((outputTokens || 0) *
          (Number(model.costPerMillionOutputTokens) || 0)) /
        1_000_000;
      const costInDollars = legacyInputDollars + legacyOutputDollars;

      const tokensPerDollar = Number(model.tokensPerDollar) || 30;
      const costInTokens = finalizeTokenCost(
        costInDollars * tokensPerDollar,
      );

      return { costInDollars, costInTokens };
    }

    // ─── MEDIA MODELS ──────────────────────────────────────────
    if (
      model.pricingMatrix &&
      Array.isArray(model.pricingMatrix) &&
      model.pricingMatrix.length > 0 &&
      params
    ) {
      const matched = this.matchPricingTier(model.pricingMatrix, params);
      if (matched) {
        const costInTokens = finalizeTokenCost(matched.costInTokens);
        const costInDollars = matched.costInDollars;

        return {
          costInDollars,
          costInTokens,
          matchedTier: matched.label,
        };
      }
    }

    // Fallback на фиксированную цену
    const fixedDollars = Number(model.fixedCostPerGeneration) || 0;
    const tokensPerDollar = Number(model.tokensPerDollar) || 30;
    const costInTokens = finalizeTokenCost(fixedDollars * tokensPerDollar);

    return { costInDollars: fixedDollars, costInTokens };
  }

  /**
   * Ищет подходящую строку в pricingMatrix по переданным параметрам.
   */
  private matchPricingTier(
    matrix: Array<{
      conditions: Record<string, any>;
      costInTokens: number;
      costInDollars: number;
      label?: string;
    }>,
    params: Record<string, any>,
  ): {
    costInTokens: number;
    costInDollars: number;
    label?: string;
  } | null {
    for (const tier of matrix) {
      const conditions = tier.conditions || {};
      const conditionKeys = Object.keys(conditions);

      if (conditionKeys.length === 0) {
        return {
          costInTokens: tier.costInTokens,
          costInDollars: tier.costInDollars,
          label: tier.label,
        };
      }

      const allMatch = conditionKeys.every((key) => {
        const expected = conditions[key];
        const actual = params[key];
        // Нестрогое сравнение для number vs string ('5' == 5)
        // eslint-disable-next-line eqeqeq
        return expected == actual;
      });

      if (allMatch) {
        return {
          costInTokens: tier.costInTokens,
          costInDollars: tier.costInDollars,
          label: tier.label,
        };
      }
    }

    return null;
  }
}