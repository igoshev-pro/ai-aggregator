// src/modules/billing/billing.service.ts
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  Inject,
  forwardRef,
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
const RUB_TO_USD_RATE = 75; // 75₽ = $1

// ─── Типы ───────────────────────────────────────────────────────
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

// ─── Fallback константы (используются если БД пустая) ────────────
const FALLBACK_TOKEN_PACKAGES: TokenPackageConfig[] = [
  { id: 'pack_100',  tokens: 100,  priceRub: 99,   label: '100 токенов' },
  { id: 'pack_300',  tokens: 300,  priceRub: 249,  label: '300 токенов', popular: true },
  { id: 'pack_700',  tokens: 700,  priceRub: 499,  label: '700 токенов' },
  { id: 'pack_1500', tokens: 1500, priceRub: 899,  label: '1500 токенов' },
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

// Маппинг deprecated планов на новые (для обратной совместимости)
const PLAN_MIGRATION: Record<string, SubscriptionPlan> = {
  [SubscriptionPlan.PRO]: SubscriptionPlan.PLUS,
  [SubscriptionPlan.UNLIMITED]: SubscriptionPlan.ULTIMATE,
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  // ─── In-memory кэш на 60 сек ───────────────────────────────────
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
    // 🆕 Промокоды теперь рулит отдельный сервис
    private promoCodeService: PromoCodeService,
    private yookassaProvider: YookassaProvider,
    private cryptomusProvider: CryptomusProvider,
    private starsProvider: StarsProvider,
    private freedompayProvider: FreedomPayProvider,
    private tochkaProvider: TochkaProvider,
    private heleketProvider: HeleketProvider,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // Кэш planов и пакетов из БД (с fallback на хардкод)
  // ═══════════════════════════════════════════════════════════════

  /** Сбросить кэш — вызывается из AdminBillingService после изменений */
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
      this.logger.log(
        `[Tochka] ignoring webhook type: ${payload.webhookType}`,
      );
      return { ok: true };
    }

    const transaction = await this.transactionModel.findOne({
      externalPaymentId: payload.operationId,
      paymentProvider: 'tochka',
    });

    if (!transaction) {
      this.logger.warn(
        `[Tochka] transaction not found: op=${payload.operationId}`,
      );
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
  // Пакеты токенов (из БД с fallback)
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
  // Планы подписки (из БД с fallback)
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
  // 🆕 Превью промокода — для UI до оплаты
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
  // Оплата пакета токенов (с поддержкой промокода)
  // ═══════════════════════════════════════════════════════════════

  async createTokenPayment(
    userId: string,
    packageId: string,
    provider: ProviderName,
    currency: 'RUB' | 'USD' = 'RUB',
    returnUrl?: string,
    promoCode?: string, // 🆕
  ) {
    const pack = await this.findPackageById(packageId);
    if (!pack) throw new BadRequestException('Invalid package');

    const user = await this.usersService.findById(userId);
    const paymentProvider = this.getPaymentProvider(provider);

    const bonusTokensFromPack = Math.floor(
      (pack.tokens * (pack.bonusPercent || 0)) / 100,
    );
    const totalTokens = pack.tokens + bonusTokensFromPack;

    // ── Применяем промокод ──────────────────────────────────────
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
      const newUser = await this.usersService.addTokens(
        userId,
        pack.tokens,
      );
      // Бонусные токены (от пакета + от промокода)
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
        balanceBefore: user.tokenBalance + user.bonusTokens,
        balanceAfter: finalUser.tokenBalance + finalUser.bonusTokens,
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
      balanceBefore: user.tokenBalance,
      balanceAfter: user.tokenBalance,
      metadata: {
        currency,
        paymentAmount,
        originalPriceRub: pack.priceRub,
        finalPriceRub,
        baseTokens: pack.tokens,
        bonusTokens: bonusTokensFromPack,
        // Сохраняем эффект промокода — применим после успешного webhook'а
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
  // Webhook обработка (с применением промокода после оплаты)
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
      transaction.balanceAfter = user.tokenBalance;
      await transaction.save();

      // ── Применяем промокод (если был сохранён в metadata) ──────
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
          // Бонус-токены сверху (если промокод даёт)
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

          // Отмечаем использование промокода
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

      // ── Активация подписки ─────────────────────────────────────
      if (
        transaction.type === TransactionType.SUBSCRIPTION &&
        transaction.metadata?.plan
      ) {
        await this.activateSubscription(
          transaction.userId.toString(),
          transaction.metadata.plan as SubscriptionPlan,
        );
      }

      // ── Реферальный бонус ──────────────────────────────────────
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
  // Реферальный бонус (кэшбек 10% от покупок)
  // ═══════════════════════════════════════════════════════════════

  private async processReferralBonus(transaction: TransactionDocument) {
    const userDoc = await this.usersService.findById(
      transaction.userId.toString(),
    );
    if (!userDoc.referredBy) return;

    const cashbackAmount = Math.floor(transaction.amount * 0.1);
    if (cashbackAmount <= 0) return;

    const referrerId = userDoc.referredBy.toString();

    await this.usersService.addCashback(referrerId, cashbackAmount);

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
      metadata: { cashback: true, sourceAmount: transaction.amount },
    });

    this.logger.log(
      `💰 Cashback +${cashbackAmount} → user ${referrerId} (10% of ${transaction.amount})`,
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
      await this.createTransaction(userId, {
        type: TransactionType.GENERATION,
        amount: 0,
        description: `Генерация ${generationType}: ${modelSlug} (бесплатно по подписке)`,
        paymentStatus: PaymentStatus.COMPLETED,
        generationId,
        generationType,
        modelSlug,
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

    const user = await this.usersService.findById(userId);
    const { costInDollars, costInTokens, matchedTier } =
      await this.calculateGenerationCost(
        modelSlug,
        inputTokens,
        outputTokens,
        params,
      );

    await this.usersService.deductTokens(userId, costInTokens, 'generation');

    await this.createTransaction(userId, {
      type: TransactionType.GENERATION,
      amount: -costInTokens,
      description: `Генерация ${generationType}: ${modelSlug}${matchedTier ? ` (${matchedTier})` : ''}`,
      paymentStatus: PaymentStatus.COMPLETED,
      generationId,
      generationType,
      modelSlug,
      balanceBefore: user.tokenBalance + user.bonusTokens + costInTokens,
      balanceAfter: user.tokenBalance + user.bonusTokens,
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
    const user = await this.usersService.findById(userId);

    await this.createTransaction(userId, {
      type: TransactionType.GENERATION,
      amount: -params.costInTokens,
      description: `Генерация ${params.generationType}: ${params.modelSlug}${
        params.matchedTier ? ` (${params.matchedTier})` : ''
      }`,
      paymentStatus: PaymentStatus.COMPLETED,
      generationId: params.generationId,
      generationType: params.generationType,
      modelSlug: params.modelSlug,
      balanceBefore: user.tokenBalance + user.bonusTokens + params.costInTokens,
      balanceAfter: user.tokenBalance + user.bonusTokens,
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
      `📝 Recorded media generation: ${params.modelSlug} | -${params.costInTokens}🔥 | user=${userId}`,
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
      return {
        costInTokens: 0,
        costInDollars: 0,
        freeAccess: true,
        balanceBefore: user.tokenBalance + user.bonusTokens,
        balanceAfter: user.tokenBalance + user.bonusTokens,
      };
    }

    const user = await this.usersService.findById(userId);
    const balanceBefore = user.tokenBalance + user.bonusTokens;

    const { costInDollars, costInTokens, matchedTier } =
      await this.calculateGenerationCost(
        modelSlug,
        undefined,
        undefined,
        generationParams,
      );

    if (balanceBefore < costInTokens) {
      throw new BadRequestException(
        `Недостаточно токенов. Требуется: ${costInTokens}🔥, доступно: ${balanceBefore}🔥`,
      );
    }

    await this.usersService.deductTokens(userId, costInTokens, 'generation');

    return {
      costInTokens,
      costInDollars,
      matchedTier,
      freeAccess: false,
      balanceBefore,
      balanceAfter: balanceBefore - costInTokens,
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
    const user = await this.usersService.findById(userId);

    await this.createTransaction(userId, {
      type: TransactionType.REFUND,
      amount,
      description,
      paymentStatus: PaymentStatus.COMPLETED,
      generationId,
      balanceBefore: user.tokenBalance + user.bonusTokens - amount,
      balanceAfter: user.tokenBalance + user.bonusTokens,
      metadata: {
        refund: true,
      },
    });

    this.logger.log(
      `↩️ Refund transaction recorded: +${amount}🔥 → user ${userId} | ${description}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // 🆕 Промокоды — standalone применение (для bonus_tokens)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Применение промокода ОТДЕЛЬНО (не при оплате).
   * Работает только для type=BONUS_TOKENS.
   * Для скидок и subscription_days промокод применяется через
   * createTokenPayment / createSubscription (передаётся параметром promoCode).
   */
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

    const user = await this.usersService.addBonusTokens(
      userId,
      validation.bonusTokens,
    );

    await this.promoCodeService.markUsed(promo._id, userId, {
      bonusTokens: validation.bonusTokens,
    });

    await this.createTransaction(userId, {
      type: TransactionType.PROMO_CODE,
      amount: validation.bonusTokens,
      description: `Промокод ${promo.code}: +${validation.bonusTokens} 🔥 спичек`,
      paymentStatus: PaymentStatus.COMPLETED,
      promoCode: promo.code,
      balanceBefore:
        user.tokenBalance + user.bonusTokens - validation.bonusTokens,
      balanceAfter: user.tokenBalance + user.bonusTokens,
      metadata: {
        promoId: promo._id.toString(),
        promoType: promo.type,
      },
    });

    return {
      success: true,
      effectLabel: validation.effectLabel,
      bonusTokens: validation.bonusTokens,
      newBalance: user.tokenBalance + user.bonusTokens,
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
    promoCode?: string, // 🆕
  ) {
    if (plan === SubscriptionPlan.FREE) {
      throw new BadRequestException('Cannot subscribe to free plan');
    }

    const planConfig = await this.getPlanConfig(plan);
    if (!planConfig) throw new BadRequestException('Invalid plan');

    const effectivePlan = (PLAN_MIGRATION[plan] || plan) as SubscriptionPlan;
    const paymentProvider = this.getPaymentProvider(provider);

    // ── Применяем промокод ─────────────────────────────────────
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
      description: `Подписка ${planConfig.name}${
        promoValidation ? ` [промокод ${promoValidation.promo.code}]` : ''
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

    const user = await this.usersService.findById(userId);
    user.subscriptionPlan = effectivePlan;
    user.subscriptionExpiresAt = endDate;
    await user.save();

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

  /**
   * 🆕 Активация подписки на N дней (для промокодов SUBSCRIPTION_DAYS).
   * Если уже есть активная подписка того же плана — продлеваем её на N дней.
   * Иначе — создаём новую на N дней. Токены не начисляются.
   */
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
    let subscription: SubscriptionDocument;

    if (existing && existing.plan === effectivePlan) {
      // Продлеваем существующую подписку
      endDate = new Date(existing.endDate);
      endDate.setDate(endDate.getDate() + days);
      existing.endDate = endDate;
      await existing.save();
      subscription = existing;
    } else {
      // Деактивируем старые подписки (если есть другой план)
      if (existing) {
        existing.isActive = false;
        await existing.save();
      }

      endDate = new Date(now);
      endDate.setDate(endDate.getDate() + days);

      subscription = new this.subscriptionModel({
        userId: new Types.ObjectId(userId),
        plan: effectivePlan,
        startDate: now,
        endDate,
        isActive: true,
        tokensPerMonth: 0, // токены не начисляем
        priceRub: 0,
        features: planConfig.features,
      });
      await subscription.save();
    }

    const user = await this.usersService.findById(userId);
    user.subscriptionPlan = effectivePlan;
    user.subscriptionExpiresAt = endDate;
    await user.save();

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
      tokenBalance: user.tokenBalance,
      bonusTokens: user.bonusTokens,
      totalAvailable: user.tokenBalance + user.bonusTokens,
      totalSpent: user.totalTokensSpent,
      totalDeposited: user.totalDeposited,
      todaySpent: todaySpent[0]?.total || 0,
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
  // Cron — проверка истёкших подписок
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

      const user = await this.usersService.findById(sub.userId.toString());
      user.subscriptionPlan = SubscriptionPlan.FREE;
      user.subscriptionExpiresAt = null;
      await user.save();

      this.logger.log(
        `Subscription expired for user ${sub.userId}, plan: ${sub.plan}`,
      );
    }

    if (expired.length > 0) {
      this.logger.log(`Deactivated ${expired.length} expired subscriptions`);
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

      const user = await this.usersService.findById(sub.userId.toString());
      user.subscriptionPlan = newPlan;
      await user.save();

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
    const user = await this.usersService.findById(targetUserId);
    const balanceBefore = user.tokenBalance;

    if (amount > 0) {
      await this.usersService.addTokens(targetUserId, amount);
    } else {
      await this.usersService.deductTokens(
        targetUserId,
        Math.abs(amount),
        'admin_adjustment',
      );
    }

    const updatedUser = await this.usersService.findById(targetUserId);

    await this.createTransaction(targetUserId, {
      type: TransactionType.ADMIN_ADJUSTMENT,
      amount,
      description: `Админ-корректировка: ${reason}`,
      paymentStatus: PaymentStatus.COMPLETED,
      balanceBefore,
      balanceAfter: updatedUser.tokenBalance,
      metadata: { adminUserId, reason },
    });

    return {
      balanceBefore,
      balanceAfter: updatedUser.tokenBalance,
      adjustment: amount,
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

    return {
      slug: model.slug,
      name: model.name,
      displayName: model.displayName,
      type: model.type,
      defaultCost: {
        costInTokens: model.minTokenCost,
        costInDollars: model.fixedCostPerGeneration,
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

  /**
   * Единый метод расчёта стоимости генерации.
   *
   * Для text-моделей:
   *   - costPerMillionInputTokens + costPerMillionOutputTokens
   *
   * Для media-моделей (image/video/audio):
   *   - Если есть pricingMatrix → ищем подходящую строку по params
   *   - Иначе → fixedCostPerGeneration (fallback)
   */
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

    // ─── TEXT MODELS ─────────────────────────────────────────────
    if (model.type === 'text') {
      const inputCost =
        ((inputTokens || 0) * (model.costPerMillionInputTokens || 0)) /
        1_000_000;
      const outputCost =
        ((outputTokens || 0) * (model.costPerMillionOutputTokens || 0)) /
        1_000_000;
      const costInDollars = inputCost + outputCost;

      let costInTokens = Math.ceil(
        costInDollars * (model.tokensPerDollar || 100),
      );
      costInTokens = Math.max(costInTokens, model.minTokenCost || 1);

      return { costInDollars, costInTokens };
    }

    // ─── MEDIA MODELS (image/video/audio) ────────────────────────
    if (
      model.pricingMatrix &&
      Array.isArray(model.pricingMatrix) &&
      model.pricingMatrix.length > 0 &&
      params
    ) {
      const matched = this.matchPricingTier(model.pricingMatrix, params);
      if (matched) {
        const costInDollars = matched.costInDollars;
        let costInTokens = matched.costInTokens;

        costInTokens = Math.max(costInTokens, model.minTokenCost || 1);

        return {
          costInDollars,
          costInTokens,
          matchedTier: matched.label,
        };
      }
    }

    // Fallback на фиксированную цену
    const costInDollars = model.fixedCostPerGeneration || 0;
    let costInTokens = Math.ceil(
      costInDollars * (model.tokensPerDollar || 100),
    );
    costInTokens = Math.max(costInTokens, model.minTokenCost || 1);

    return { costInDollars, costInTokens };
  }

  /**
   * Ищет подходящую строку в pricingMatrix по переданным параметрам.
   *
   * Логика:
   *   - Перебираем матрицу СВЕРХУ ВНИЗ (порядок важен)
   *   - Для каждой строки сравниваем все ключи conditions с params
   *   - Если все ключи совпали → возвращаем эту строку
   *   - Пустые conditions ({}) — wildcard (всегда матчит)
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

      // Пустые conditions = wildcard
      if (conditionKeys.length === 0) {
        return {
          costInTokens: tier.costInTokens,
          costInDollars: tier.costInDollars,
          label: tier.label,
        };
      }

      // Проверяем что ВСЕ ключи conditions совпадают с params
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