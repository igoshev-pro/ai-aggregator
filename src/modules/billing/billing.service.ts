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

// ─── Курс конвертации ────────────────────────────────────────────
const RUB_TO_USD_RATE = 90; // 90₽ = $1

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
  hourlyLimit: number | null; // null = безлимит
  dailyLimit: number | null; // null = безлимит
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
    private yookassaProvider: YookassaProvider,
    private cryptomusProvider: CryptomusProvider,
    private starsProvider: StarsProvider,
  ) {}

  // ─── Конвертация валюты ─────────────────────────────────────────

  private convertPrice(
    priceRub: number,
    currency: 'RUB' | 'USD',
  ): number {
    if (currency === 'RUB') return priceRub;
    return Math.round((priceRub / RUB_TO_USD_RATE) * 100) / 100;
  }

  private getCurrencySymbol(currency: 'RUB' | 'USD'): string {
    return currency === 'RUB' ? '₽' : '$';
  }

  // ─── Пакеты токенов ─────────────────────────────────────────────

  getTokenPackages(currency: 'RUB' | 'USD' = 'RUB') {
    return TOKEN_PACKAGES.map((pack) => ({
      ...pack,
      price: this.convertPrice(pack.priceRub, currency),
      currency,
      currencySymbol: this.getCurrencySymbol(currency),
      // Оставляем priceRub для обратной совместимости
    }));
  }

  // ─── Планы подписки ─────────────────────────────────────────────

  getSubscriptionPlans(currency: 'RUB' | 'USD' = 'RUB') {
    const result: any[] = [];

    for (const [planId, config] of Object.entries(SUBSCRIPTION_PLANS)) {
      // Пропускаем deprecated планы в выдаче
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
        tokenPriceUsd:
          Math.round((3 / RUB_TO_USD_RATE) * 1000) / 1000,
      });
    }

    return result;
  }

  // ─── Получить конфиг плана (с поддержкой deprecated) ────────────

  private getPlanConfig(
    plan: SubscriptionPlan,
  ): SubscriptionPlanConfig | null {
    // Если это deprecated план — маппим на новый
    const effectivePlan = PLAN_MIGRATION[plan] || plan;
    return SUBSCRIPTION_PLANS[effectivePlan] || null;
  }

  // ─── Проверка бесплатного доступа к модели ─────────────────────

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

    // Безлимитный доступ
    if (
      freeModel.hourlyLimit === null &&
      freeModel.dailyLimit === null
    ) {
      return { isFree: true };
    }

    // Проверяем лимиты
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

    if (
      freeModel.dailyLimit !== null &&
      dailyCount >= freeModel.dailyLimit
    ) {
      return {
        isFree: false,
        reason: `Дневной лимит ${freeModel.dailyLimit} исчерпан`,
      };
    }

    return { isFree: true };
  }

  // ─── Оплата пакета токенов ──────────────────────────────────────

  async createTokenPayment(
    userId: string,
    packageId: string,
    provider: 'yookassa' | 'cryptomus' | 'stars',
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
      throw new BadRequestException(
        result.error || 'Payment creation failed',
      );
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

  // ─── Webhook обработка ──────────────────────────────────────────

  async handlePaymentWebhook(
    provider: 'yookassa' | 'cryptomus' | 'stars',
    body: any,
    headers: any,
  ) {
    const paymentProvider = this.getPaymentProvider(provider);
    const result = await paymentProvider.verifyWebhook(body, headers);

    if (!result.success) {
      this.logger.warn(
        `Webhook verification failed for ${provider}`,
      );
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
      // Основные токены
      const user = await this.usersService.addTokens(
        transaction.userId.toString(),
        transaction.amount,
      );

      transaction.paymentStatus = PaymentStatus.COMPLETED;
      transaction.balanceAfter = user.tokenBalance;
      await transaction.save();

      // Если это подписка — активируем и начисляем бонусные
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

  // ─── Реферальный бонус ──────────────────────────────────────────

  private async processReferralBonus(
    transaction: TransactionDocument,
  ) {
    const userDoc = await this.usersService.findById(
      transaction.userId.toString(),
    );
    if (!userDoc.referredBy) return;

    const referralBonus = Math.floor(transaction.amount * 0.1);
    if (referralBonus <= 0) return;

    await this.usersService.addBonusTokens(
      userDoc.referredBy.toString(),
      referralBonus,
    );

    await this.createTransaction(userDoc.referredBy.toString(), {
      type: TransactionType.REFERRAL_BONUS,
      amount: referralBonus,
      description: `Реферальный бонус от покупки пользователя ${userDoc.firstName}`,
      paymentStatus: PaymentStatus.COMPLETED,
      referralUserId: transaction.userId,
    });
  }

  // ─── Списание за генерацию ──────────────────────────────────────

  async chargeForGeneration(
    userId: string,
    modelSlug: string,
    generationType: string,
    generationId: string,
    inputTokens?: number,
    outputTokens?: number,
  ) {
    // Проверяем бесплатный доступ по подписке
    const freeAccess = await this.checkFreeModelAccess(
      userId,
      modelSlug,
    );

    if (freeAccess.isFree) {
      // Записываем транзакцию с нулевой стоимостью (для трекинга лимитов)
      await this.createTransaction(userId, {
        type: TransactionType.GENERATION,
        amount: 0,
        description: `Генерация ${generationType}: ${modelSlug} (бесплатно по подписке)`,
        paymentStatus: PaymentStatus.COMPLETED,
        generationId,
        generationType,
        modelSlug,
        metadata: { freeAccess: true, inputTokens, outputTokens },
      });

            return {
        costInTokens: 0,
        costInDollars: 0,
        freeAccess: true,
      };
    }

    const user = await this.usersService.findById(userId);
    const { costInDollars, costInTokens } =
      await this.calculateGenerationCost(
        modelSlug,
        inputTokens,
        outputTokens,
      );

    // Списываем токены
    await this.usersService.deductTokens(
      userId,
      costInTokens,
      'generation',
    );

    await this.createTransaction(userId, {
      type: TransactionType.GENERATION,
      amount: -costInTokens,
      description: `Генерация ${generationType}: ${modelSlug}`,
      paymentStatus: PaymentStatus.COMPLETED,
      generationId,
      generationType,
      modelSlug,
      balanceBefore:
        user.tokenBalance + user.bonusTokens + costInTokens,
      balanceAfter: user.tokenBalance + user.bonusTokens,
      metadata: {
        inputTokens,
        outputTokens,
        costInDollars,
        freeAccess: false,
      },
    });

    return { costInTokens, costInDollars, freeAccess: false };
  }

  // ─── Рефанд ─────────────────────────────────────────────────────

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
      balanceBefore: user.tokenBalance - amount,
      balanceAfter: user.tokenBalance,
    });
  }

  // ─── Промокоды ──────────────────────────────────────────────────

  async applyPromoCode(userId: string, code: string) {
    const promo = await this.promoCodeModel.findOne({
      code: code.toUpperCase(),
      isActive: true,
    });

    if (!promo) throw new BadRequestException('Промокод не найден');
    if (promo.expiresAt && promo.expiresAt < new Date()) {
      throw new BadRequestException('Промокод истёк');
    }
    if (
      promo.maxUses !== null &&
      promo.currentUses >= promo.maxUses
    ) {
      throw new BadRequestException('Промокод исчерпан');
    }
    if (promo.usedByUsers.includes(userId)) {
      throw new BadRequestException(
        'Вы уже использовали этот промокод',
      );
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

  // ─── Подписки ───────────────────────────────────────────────────

  async createSubscription(
    userId: string,
    plan: SubscriptionPlan,
    provider: 'yookassa' | 'cryptomus' | 'stars',
    currency: 'RUB' | 'USD' = 'RUB',
    returnUrl?: string,
  ) {
    if (plan === SubscriptionPlan.FREE) {
      throw new BadRequestException('Cannot subscribe to free plan');
    }

    const planConfig = this.getPlanConfig(plan);
    if (!planConfig) throw new BadRequestException('Invalid plan');

    // Маппим deprecated план на актуальный
    const effectivePlan = PLAN_MIGRATION[plan] || plan;

    const paymentProvider = this.getPaymentProvider(provider);
    const paymentAmount = this.convertPrice(
      planConfig.priceRub,
      currency,
    );

    const result = await paymentProvider.createPayment({
      amount: paymentAmount,
      currency,
      tokens: planConfig.tokensPerMonth,
      userId,
      description: `Подписка ${planConfig.name}`,
      returnUrl,
    });

    if (!result.success) {
      throw new BadRequestException(
        result.error || 'Payment failed',
      );
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

  async activateSubscription(
    userId: string,
    plan: SubscriptionPlan,
  ) {
    // Маппим deprecated план
    const effectivePlan = PLAN_MIGRATION[plan] || plan;
    const planConfig = SUBSCRIPTION_PLANS[effectivePlan];
    if (!planConfig) return;

    const now = new Date();
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + 1);

    // Деактивируем предыдущие подписки
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
    await this.usersService.addTokens(
      userId,
      planConfig.tokensPerMonth,
    );

    // Начисляем бонусные токены (если есть)
    if (planConfig.bonusTokens > 0) {
      await this.usersService.addBonusTokens(
        userId,
        planConfig.bonusTokens,
      );

      await this.createTransaction(userId, {
        type: TransactionType.PROMO_CODE, // используем как бонус
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

  // ─── Баланс ─────────────────────────────────────────────────────

  async getBalance(userId: string) {
    const user = await this.usersService.findById(userId);

    const activeSubscription =
      await this.subscriptionModel.findOne({
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

    // Определяем конфиг подписки для freeModels
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
        tokenPriceUsd:
          Math.round((3 / RUB_TO_USD_RATE) * 1000) / 1000,
      },
    };
  }

  // ─── Транзакции ─────────────────────────────────────────────────

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

  // ─── Cron ───────────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_HOUR)
  async checkExpiredSubscriptions() {
    const expired = await this.subscriptionModel.find({
      isActive: true,
      endDate: { $lt: new Date() },
    });

    for (const sub of expired) {
      sub.isActive = false;
      await sub.save();

      const user = await this.usersService.findById(
        sub.userId.toString(),
      );
      user.subscriptionPlan = SubscriptionPlan.FREE;
      user.subscriptionExpiresAt = null;
      await user.save();

      this.logger.log(
        `Subscription expired for user ${sub.userId}, plan: ${sub.plan}`,
      );
    }

    if (expired.length > 0) {
      this.logger.log(
        `Deactivated ${expired.length} expired subscriptions`,
      );
    }
  }

  // ─── Миграция старых подписок ───────────────────────────────────

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

      const user = await this.usersService.findById(
        sub.userId.toString(),
      );
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

  // ─── Админ: промокоды ──────────────────────────────────────────

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
    if (existing)
      throw new BadRequestException('Promo code already exists');

    const promo = new this.promoCodeModel({
      ...data,
      code: data.code.toUpperCase(),
    });
    return promo.save();
  }

  async getAllPromoCodes() {
    return this.promoCodeModel
      .find()
      .sort({ createdAt: -1 })
      .exec();
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

  // ─── Админ: корректировка баланса ──────────────────────────────

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

    const updatedUser =
      await this.usersService.findById(targetUserId);

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

  // ─── Статистика ─────────────────────────────────────────────────

  async getRevenueStats(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [revenue, generations, newSubscriptions] =
      await Promise.all([
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
              tokensSpent: {
                $sum: { $abs: '$amount' },
              },
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

  // ─── Private helpers ────────────────────────────────────────────

  private getPaymentProvider(provider: string) {
    switch (provider) {
      case 'yookassa':
        return this.yookassaProvider;
      case 'cryptomus':
        return this.cryptomusProvider;
      case 'stars':
        return this.starsProvider;
      default:
        throw new BadRequestException(
          `Unknown payment provider: ${provider}`,
        );
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

  async calculateGenerationCost(
    modelSlug: string,
    inputTokens?: number,
    outputTokens?: number,
  ): Promise<{ costInDollars: number; costInTokens: number }> {
    const model = await this.modelModel.findOne({ slug: modelSlug });
    if (!model) throw new NotFoundException('Model not found');

    let costInDollars = 0;
    let costInTokens = 0;

    if (model.type === 'text') {
      const inputCost =
        ((inputTokens || 0) * model.costPerMillionInputTokens) /
        1_000_000;
      const outputCost =
        ((outputTokens || 0) * model.costPerMillionOutputTokens) /
        1_000_000;
      costInDollars = inputCost + outputCost;
      costInTokens = Math.ceil(
        costInDollars * model.tokensPerDollar,
      );
      costInTokens = Math.max(costInTokens, model.minTokenCost);
    } else {
      costInDollars = model.fixedCostPerGeneration;
      costInTokens = Math.ceil(
        costInDollars * model.tokensPerDollar,
      );
      costInTokens = Math.max(costInTokens, model.minTokenCost);
    }

    return { costInDollars, costInTokens };
  }
}