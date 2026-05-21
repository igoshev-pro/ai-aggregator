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
import { PromoCode, PromoCodeDocument } from './schemas/promo-code.schema';
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


// ─── Курс конвертации ────────────────────────────────────────────
const RUB_TO_USD_RATE = 75; // 75₽ = $1


// ─── Пакеты токенов ──────────────────────────────────────────────
const TOKEN_PACKAGES = [
  {
    id: 'pack_100',
    tokens: 100,
    priceRub: 99,
    label: '100 токенов',
  },
  {
    id: 'pack_300',
    tokens: 300,
    priceRub: 249,
    label: '300 токенов',
    popular: true,
  },
  {
    id: 'pack_700',
    tokens: 700,
    priceRub: 499,
    label: '700 токенов',
  },
  {
    id: 'pack_1500',
    tokens: 1500,
    priceRub: 899,
    label: '1500 токенов',
  },
  {
    id: 'pack_5000',
    tokens: 5000,
    priceRub: 2499,
    label: '5000 токенов',
    best: true,
  },
];


// ─── Бесплатные модели по подпискам ──────────────────────────────
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
}


const SUBSCRIPTION_PLANS: Record<string, SubscriptionPlanConfig> = {
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
      {
        modelSlug: 'gpt-oss-120b',
        displayName: 'gpt-oss-120b',
        hourlyLimit: 10,
        dailyLimit: 60,
      },
      {
        modelSlug: 'deepseek-v3.2',
        displayName: 'DeepSeek V3.2',
        hourlyLimit: 10,
        dailyLimit: 60,
      },
      {
        modelSlug: 'grok-4.1-fast',
        displayName: 'xAI: Grok 4.1 Fast',
        hourlyLimit: 10,
        dailyLimit: 60,
      },
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
      {
        modelSlug: 'gpt-oss-120b',
        displayName: 'gpt-oss-120b',
        hourlyLimit: null,
        dailyLimit: null,
      },
      {
        modelSlug: 'deepseek-v3.2',
        displayName: 'DeepSeek V3.2',
        hourlyLimit: null,
        dailyLimit: null,
      },
      {
        modelSlug: 'grok-4.1-fast',
        displayName: 'xAI: Grok 4.1 Fast',
        hourlyLimit: null,
        dailyLimit: null,
      },
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
      {
        modelSlug: 'gpt-image-1.5-lite',
        displayName: 'GPT Image 1.5 Lite',
        hourlyLimit: 10,
        dailyLimit: 60,
      },
      {
        modelSlug: 'imagen-4',
        displayName: 'Imagen 4',
        hourlyLimit: 10,
        dailyLimit: 60,
      },
      {
        modelSlug: 'midjourney',
        displayName: 'Midjourney обычный',
        hourlyLimit: 10,
        dailyLimit: 60,
      },
      {
        modelSlug: 'gpt-oss-120b',
        displayName: 'gpt-oss-120b',
        hourlyLimit: null,
        dailyLimit: null,
      },
      {
        modelSlug: 'deepseek-v3.2',
        displayName: 'DeepSeek V3.2',
        hourlyLimit: null,
        dailyLimit: null,
      },
      {
        modelSlug: 'grok-4.1-fast',
        displayName: 'xAI: Grok 4.1 Fast',
        hourlyLimit: null,
        dailyLimit: null,
      },
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

  constructor(
    @InjectModel(Transaction.name)
    private transactionModel: Model<TransactionDocument>,
    @InjectModel(Subscription.name)
    private subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(PromoCode.name)
    private promoCodeModel: Model<PromoCodeDocument>,
    @InjectModel(AIModel.name)
    private modelModel: Model<ModelDocument>,
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
    @Inject(forwardRef(() => ReferralService))
    private referralService: ReferralService,
    private yookassaProvider: YookassaProvider,
    private cryptomusProvider: CryptomusProvider,
    private starsProvider: StarsProvider,
    private freedompayProvider: FreedomPayProvider,
    private tochkaProvider: TochkaProvider,
    private heleketProvider: HeleketProvider,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // WEBHOOKS — без изменений
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
  // Пакеты токенов
  // ═══════════════════════════════════════════════════════════════

  getTokenPackages(currency: 'RUB' | 'USD' = 'RUB') {
    return TOKEN_PACKAGES.map((pack) => ({
      ...pack,
      price: this.convertPrice(pack.priceRub, currency),
      currency,
      currencySymbol: this.getCurrencySymbol(currency),
    }));
  }

  // ═══════════════════════════════════════════════════════════════
  // Планы подписки
  // ═══════════════════════════════════════════════════════════════

  getSubscriptionPlans(currency: 'RUB' | 'USD' = 'RUB') {
    const result: any[] = [];

    for (const [planId, config] of Object.entries(SUBSCRIPTION_PLANS)) {
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
        tokenPriceRub: 3,
        tokenPriceUsd: Math.round((3 / RUB_TO_USD_RATE) * 1000) / 1000,
      });
    }

    return result;
  }

  private getPlanConfig(plan: SubscriptionPlan): SubscriptionPlanConfig | null {
    const effectivePlan = PLAN_MIGRATION[plan] || plan;
    return SUBSCRIPTION_PLANS[effectivePlan] || null;
  }

  // ═══════════════════════════════════════════════════════════════
  // Проверка бесплатного доступа к модели
  // ═══════════════════════════════════════════════════════════════

  async checkFreeModelAccess(
    userId: string,
    modelSlug: string,
  ): Promise<{ isFree: boolean; reason?: string }> {
    const user = await this.usersService.findById(userId);
    const planConfig = this.getPlanConfig(user.subscriptionPlan);

    if (!planConfig) return { isFree: false };

    const freeModel = planConfig.freeModels.find(
      (fm) => fm.modelSlug === modelSlug,
    );
    if (!freeModel) return { isFree: false };

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
  // Оплата пакета токенов — без изменений
  // ═══════════════════════════════════════════════════════════════

  async createTokenPayment(
    userId: string,
    packageId: string,
    provider: 'yookassa' | 'cryptomus' | 'stars' | 'freedompay' | 'tochka' | 'heleket',
    currency: 'RUB' | 'USD' = 'RUB',
    returnUrl?: string,
  ) {
    const pack = TOKEN_PACKAGES.find((p) => p.id === packageId);
    if (!pack) throw new BadRequestException('Invalid package');

    const user = await this.usersService.findById(userId);
    const paymentProvider = this.getPaymentProvider(provider);

    const paymentAmount = this.convertPrice(pack.priceRub, currency);

    const result = await paymentProvider.createPayment({
      amount: paymentAmount,
      currency,
      tokens: pack.tokens,
      userId,
      description: `Пополнение: ${pack.label}`,
      returnUrl,
    });

    if (!result.success) {
      throw new BadRequestException(result.error || 'Payment creation failed');
    }

    await this.createTransaction(userId, {
      type: TransactionType.DEPOSIT,
      amount: pack.tokens,
      description: `Пополнение: ${pack.label}`,
      paymentStatus: PaymentStatus.PENDING,
      externalPaymentId: result.paymentId,
      paymentProvider: provider,
      paymentAmountRub: pack.priceRub,
      balanceBefore: user.tokenBalance,
      balanceAfter: user.tokenBalance,
      metadata: { currency, paymentAmount },
    });

    return {
      paymentId: result.paymentId,
      paymentUrl: result.paymentUrl,
      package: {
        ...pack,
        price: paymentAmount,
        currency,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Webhook обработка — без изменений
  // ═══════════════════════════════════════════════════════════════

    async handlePaymentWebhook(
    provider: 'yookassa' | 'cryptomus' | 'stars' | 'freedompay' | 'tochka' | 'heleket',
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
  // Реферальный бонус (кэшбек 10% от покупок) — без изменений
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
  // 🔥 СПИСАНИЕ ЗА ГЕНЕРАЦИЮ — обновлён (добавлен params)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Списание за генерацию (универсальный метод для text/image/video/audio).
   *
   * Для text-моделей передавай inputTokens/outputTokens.
   * Для media-моделей передавай params (для матричного pricing).
   *
   * @param params - параметры генерации (quality, resolution, duration, mode, sound и т.п.)
   *                 используются для выбора правильной цены из pricingMatrix
   */
  async chargeForGeneration(
    userId: string,
    modelSlug: string,
    generationType: string,
    generationId: string,
    inputTokens?: number,
    outputTokens?: number,
    params?: Record<string, any>,
  ) {
    // Проверяем бесплатный доступ по подписке
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

    // Списываем токены
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
  // 🆕 NEW: ЗАПИСЬ МЕДИА-ГЕНЕРАЦИИ С ГОТОВОЙ ЦЕНОЙ
  // ═══════════════════════════════════════════════════════════════

  /**
   * Альтернатива chargeForGeneration для async-генераций (image/video/audio),
   * где цена уже была рассчитана заранее (до постановки задачи в очередь),
   * списана с баланса в начале, а здесь нужно только зафиксировать транзакцию
   * после получения результата от провайдера.
   *
   * Используется в:
   *   - ImageService.generateImage (после получения готовой картинки)
   *   - VideoService.generateVideo (после coverage задачи провайдером)
   *   - AudioService.generateAudio
   *
   * Если генерация провалилась — используй recordRefund для возврата.
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

  /**
   * 🆕 NEW: Списание токенов для async-генераций ДО постановки в очередь.
   * Возвращает baseline баланса для последующего rollback в случае ошибки.
   *
   * Flow:
   *   1) preChargeMediaGeneration(userId, modelSlug, params) → списали токены
   *   2) Поставили задачу в очередь провайдера
   *   3a) Успех → recordMediaGeneration (фиксируем транзакцию)
   *   3b) Ошибка → recordRefund (возвращаем токены + транзакция-возврат)
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
    // Проверяем бесплатный доступ
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

    // Списываем токены
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
  // Рефанд — ОБНОВЛЁНО: НЕ начисляет токены (это делает caller)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Записывает транзакцию возврата токенов.
   *
   * ⚠️ ВАЖНО: этот метод НЕ начисляет токены на баланс!
   * Возврат токенов — ответственность вызывающего кода
   * (GenerationService.refundGeneration вызывает usersService.refundTokens
   * ДО вызова этого метода).
   *
   * Это сделано чтобы избежать двойного начисления.
   *
   * @param userId        - кому возврат
   * @param amount        - сколько токенов (положительное число)
   * @param description   - причина возврата
   * @param generationId  - связанная генерация
   */
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
  // Промокоды — без изменений
  // ═══════════════════════════════════════════════════════════════

  async applyPromoCode(userId: string, code: string) {
    const promo = await this.promoCodeModel.findOne({
      code: code.toUpperCase(),
      isActive: true,
    });

    if (!promo) throw new BadRequestException('Промокод не найден');
    if (promo.expiresAt && promo.expiresAt < new Date()) {
      throw new BadRequestException('Промокод истёк');
    }
    if (promo.maxUses !== null && promo.currentUses >= promo.maxUses) {
      throw new BadRequestException('Промокод исчерпан');
    }
    if (promo.usedByUsers.includes(userId)) {
      throw new BadRequestException('Вы уже использовали этот промокод');
    }

    const user = await this.usersService.addBonusTokens(
      userId,
      promo.bonusTokens,
    );

    promo.currentUses += 1;
    promo.usedByUsers.push(userId);
    await promo.save();

    await this.createTransaction(userId, {
      type: TransactionType.PROMO_CODE,
      amount: promo.bonusTokens,
      description: `Промокод ${promo.code}: +${promo.bonusTokens} токенов`,
      paymentStatus: PaymentStatus.COMPLETED,
      promoCode: promo.code,
      balanceBefore:
        user.tokenBalance + user.bonusTokens - promo.bonusTokens,
      balanceAfter: user.tokenBalance + user.bonusTokens,
    });

    return {
      bonusTokens: promo.bonusTokens,
      newBalance: user.tokenBalance + user.bonusTokens,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Подписки — без изменений
  // ═══════════════════════════════════════════════════════════════

  async createSubscription(
    userId: string,
    plan: SubscriptionPlan,
    provider: 'yookassa' | 'cryptomus' | 'stars' | 'freedompay' | 'tochka' | 'heleket',
    currency: 'RUB' | 'USD' = 'RUB',
    returnUrl?: string,
  ) {
    if (plan === SubscriptionPlan.FREE) {
      throw new BadRequestException('Cannot subscribe to free plan');
    }

    const planConfig = this.getPlanConfig(plan);
    if (!planConfig) throw new BadRequestException('Invalid plan');

    const effectivePlan = PLAN_MIGRATION[plan] || plan;

    const paymentProvider = this.getPaymentProvider(provider);
    const paymentAmount = this.convertPrice(planConfig.priceRub, currency);

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
      description: `Подписка ${planConfig.name}`,
      paymentStatus: PaymentStatus.PENDING,
      externalPaymentId: result.paymentId,
      paymentProvider: provider,
      paymentAmountRub: planConfig.priceRub,
      metadata: {
        plan: effectivePlan,
        planConfig,
        currency,
        paymentAmount,
      },
    });

    return {
      paymentId: result.paymentId,
      paymentUrl: result.paymentUrl,
      plan: {
        id: effectivePlan,
        name: planConfig.name,
        price: paymentAmount,
        currency,
        tokensPerMonth: planConfig.tokensPerMonth,
        bonusTokens: planConfig.bonusTokens,
      },
    };
  }

    async activateSubscription(userId: string, plan: SubscriptionPlan) {
    const effectivePlan = PLAN_MIGRATION[plan] || plan;
    const planConfig = SUBSCRIPTION_PLANS[effectivePlan];
    if (!planConfig) return;

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

    // Обновляем поля пользователя
    const user = await this.usersService.findById(userId);
    user.subscriptionPlan = effectivePlan;
    user.subscriptionExpiresAt = endDate;
    await user.save();

    // Начисляем основные токены
    await this.usersService.addTokens(userId, planConfig.tokensPerMonth);

    // Начисляем бонусные токены (если есть)
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

  // ═══════════════════════════════════════════════════════════════
  // Баланс — без изменений
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
      const planConfig = this.getPlanConfig(
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
  // Транзакции — без изменений
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
  // Cron — без изменений
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
  // Миграция старых подписок — без изменений
  // ═══════════════════════════════════════════════════════════════

  async migrateDeprecatedSubscriptions() {
    const deprecated = await this.subscriptionModel.find({
      isActive: true,
      plan: { $in: [SubscriptionPlan.PRO, SubscriptionPlan.UNLIMITED] },
    });

    for (const sub of deprecated) {
      const newPlan = PLAN_MIGRATION[sub.plan];
      if (!newPlan) continue;

      sub.plan = newPlan;
      await sub.save();

      const user = await this.usersService.findById(sub.userId.toString());
      user.subscriptionPlan = newPlan;
      await user.save();

      this.logger.log(
        `Migrated subscription for user ${sub.userId}: ${sub.plan} → ${newPlan}`,
      );
    }

    if (deprecated.length > 0) {
      this.logger.log(
        `Migrated ${deprecated.length} deprecated subscriptions`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Админ: промокоды — без изменений
  // ═══════════════════════════════════════════════════════════════

  async createPromoCode(data: {
    code: string;
    description: string;
    bonusTokens: number;
    discountPercent?: number;
    maxUses?: number;
    maxUsesPerUser?: number;
    expiresAt?: Date;
    createdBy: string;
  }) {
    const existing = await this.promoCodeModel.findOne({
      code: data.code.toUpperCase(),
    });
    if (existing) throw new BadRequestException('Promo code already exists');

    const promo = new this.promoCodeModel({
      ...data,
      code: data.code.toUpperCase(),
    });
    return promo.save();
  }

  async getAllPromoCodes() {
    return this.promoCodeModel.find().sort({ createdAt: -1 }).exec();
  }

  async deactivatePromoCode(code: string) {
    const promo = await this.promoCodeModel.findOne({
      code: code.toUpperCase(),
    });
    if (!promo) throw new NotFoundException('Promo code not found');
    promo.isActive = false;
    await promo.save();
    return promo;
  }

  // ═══════════════════════════════════════════════════════════════
  // Админ: корректировка баланса — без изменений
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
  // Статистика — без изменений
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
  // 🆕 NEW: Pricing API для фронта
  // ═══════════════════════════════════════════════════════════════

  /**
   * Возвращает полный pricing-объект модели для фронта:
   *   - pricingMatrix (для вычисления цены по выбранным параметрам)
   *   - uiParameters (для рендера формы)
   *   - defaultCost (базовая стоимость)
   *   - inputCapabilities (нужно ли загружать картинки)
   *
   * Использование на фронте:
   *   GET /api/billing/models/midjourney/pricing
   *   → { matrix: [...], parameters: [...], defaultCost: {...} }
   */
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

  /**
   * 🆕 NEW: Расчёт стоимости генерации для конкретных параметров
   * (без списания) — для preview на фронте.
   *
   * Использование:
   *   POST /api/billing/models/midjourney/estimate
   *   body: { params: { quality: 'high', mode: 'fast' } }
   *   → { costInTokens: 12, costInDollars: 0.10, matchedTier: 'High Quality (Fast)' }
   */
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
  // 🔥 ОБНОВЛЁННЫЙ РАСЧЁТ СТОИМОСТИ — с поддержкой pricingMatrix
  // ═══════════════════════════════════════════════════════════════

  /**
   * Единый метод расчёта стоимости генерации.
   *
   * Для text-моделей:
   *   - costPerMillionInputTokens + costPerMillionOutputTokens (по факту использования)
   *
   * Для media-моделей (image/video/audio):
   *   - Если есть pricingMatrix → ищем подходящую строку по params
   *   - Если нет матрицы или ничего не нашли → fixedCostPerGeneration (fallback)
   *
   * @param modelSlug - slug модели
   * @param inputTokens - для text-моделей
   * @param outputTokens - для text-моделей
   * @param params - параметры генерации для матричной цены (для media)
   *                 пример: { quality: 'high', mode: 'fast', sound: true }
   *
   * @returns costInDollars, costInTokens, matchedTier (label из матрицы, если совпало)
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

      let costInTokens = Math.ceil(costInDollars * (model.tokensPerDollar || 100));
      costInTokens = Math.max(costInTokens, model.minTokenCost || 1);

      return { costInDollars, costInTokens };
    }

    // ─── MEDIA MODELS (image/video/audio) ────────────────────────
    // 1) Пробуем найти подходящую строку в pricingMatrix
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

        // Защита: не меньше минимальной стоимости
        costInTokens = Math.max(costInTokens, model.minTokenCost || 1);

        return {
          costInDollars,
          costInTokens,
          matchedTier: matched.label,
        };
      }
    }

    // 2) Fallback на фиксированную цену
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
   *   - Перебираем матрицу СВЕРХУ ВНИЗ (порядок важен — самые специфичные сверху)
   *   - Для каждой строки сравниваем все ключи conditions с params
   *   - Если все ключи conditions совпали с params → возвращаем эту строку
   *   - Пустые conditions ({}) — это "wildcard", матчит всегда (запасной вариант)
   *
   * @example
   *   matrix = [
   *     { conditions: { quality: 'ultra', mode: 'fast' }, costInTokens: 20 },
   *     { conditions: { quality: 'ultra' }, costInTokens: 15 },
   *     { conditions: {}, costInTokens: 10 },  // default fallback
   *   ]
   *
   *   matchPricingTier(matrix, { quality: 'ultra', mode: 'fast' })  → 20
   *   matchPricingTier(matrix, { quality: 'ultra', mode: 'slow' })  → 15
   *   matchPricingTier(matrix, { quality: 'low' })                  → 10
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

      // Пустые conditions = wildcard, матчит всегда
      if (conditionKeys.length === 0) {
        return {
          costInTokens: tier.costInTokens,
          costInDollars: tier.costInDollars,
          label: tier.label,
        };
      }

      // Проверяем что ВСЕ ключи conditions есть в params и совпадают по значению
      const allMatch = conditionKeys.every((key) => {
        const expected = conditions[key];
        const actual = params[key];

        // Нестрогое сравнение для number vs string ('5' === 5)
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