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
import { Subscription, SubscriptionDocument } from './schemas/subscription.schema';
import { PromoCode, PromoCodeDocument } from './schemas/promo-code.schema';
import { UsersService } from '../users/users.service';
import { YookassaProvider } from './providers/yookassa.provider';
import { CryptomusProvider } from './providers/cryptomus.provider';
import { StarsProvider } from './providers/stars.provider';
import {
  TransactionType,
  PaymentStatus,
  SubscriptionPlan,
} from '@/common/interfaces';

// ─── Пакеты токенов ──────────────────────────────────────────────
const TOKEN_PACKAGES = [
  { id: 'pack_100', tokens: 100, priceRub: 99, label: '100 токенов' },
  { id: 'pack_300', tokens: 300, priceRub: 249, label: '300 токенов', popular: true },
  { id: 'pack_700', tokens: 700, priceRub: 499, label: '700 токенов' },
  { id: 'pack_1500', tokens: 1500, priceRub: 899, label: '1500 токенов' },
  { id: 'pack_5000', tokens: 5000, priceRub: 2499, label: '5000 токенов', best: true },
];

// ─── Планы подписки ──────────────────────────────────────────────
const SUBSCRIPTION_PLANS: Record<string, any> = {
  [SubscriptionPlan.BASIC]: {
    name: 'Basic',
    priceRub: 299,
    tokensPerMonth: 500,
    features: {
      maxDailyGenerations: 50,
      priorityQueue: false,
      exclusiveModels: false,
      noWatermark: false,
      maxContextMessages: 20,
    },
  },
  [SubscriptionPlan.PRO]: {
    name: 'Pro',
    priceRub: 699,
    tokensPerMonth: 1500,
    features: {
      maxDailyGenerations: 200,
      priorityQueue: true,
      exclusiveModels: true,
      noWatermark: true,
      maxContextMessages: 50,
    },
  },
  [SubscriptionPlan.UNLIMITED]: {
    name: 'Unlimited',
    priceRub: 1999,
    tokensPerMonth: 5000,
    features: {
      maxDailyGenerations: 999999,
      priorityQueue: true,
      exclusiveModels: true,
      noWatermark: true,
      maxContextMessages: 100,
    },
  },
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
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
    private yookassaProvider: YookassaProvider,
    private cryptomusProvider: CryptomusProvider,
    private starsProvider: StarsProvider,
  ) {}

  getTokenPackages() {
    return TOKEN_PACKAGES;
  }

  getSubscriptionPlans() {
    return SUBSCRIPTION_PLANS;
  }

  // ─── Оплата пакета токенов ──────────────────────────────────────

  async createTokenPayment(
    userId: string,
    packageId: string,
    provider: 'yookassa' | 'cryptomus' | 'stars',
    returnUrl?: string,
  ) {
    const pack = TOKEN_PACKAGES.find((p) => p.id === packageId);
    if (!pack) throw new BadRequestException('Invalid package');

    const user = await this.usersService.findById(userId);
    const paymentProvider = this.getPaymentProvider(provider);

    const result = await paymentProvider.createPayment({
      amount: pack.priceRub,
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
    });

    return {
      paymentId: result.paymentId,
      paymentUrl: result.paymentUrl,
      package: pack,
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
      this.logger.warn(`Webhook verification failed for ${provider}`);
      return { processed: false };
    }

    const transaction = await this.transactionModel.findOne({
      externalPaymentId: result.paymentId,
      paymentStatus: PaymentStatus.PENDING,
    });

    if (!transaction) {
      this.logger.warn(`No pending transaction for payment ${result.paymentId}`);
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

      if (transaction.type === TransactionType.SUBSCRIPTION && transaction.metadata?.plan) {
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

  private async processReferralBonus(transaction: TransactionDocument) {
    const userDoc = await this.usersService.findById(transaction.userId.toString());
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
    amount: number,
    generationType: string,
    modelSlug: string,
    generationId: string,
  ) {
    const user = await this.usersService.findById(userId);

    await this.createTransaction(userId, {
      type: TransactionType.GENERATION,
      amount: -amount,
      description: `Генерация ${generationType}: ${modelSlug}`,
      paymentStatus: PaymentStatus.COMPLETED,
      generationId,
      generationType,
      modelSlug,
      balanceBefore: user.tokenBalance + user.bonusTokens + amount,
      balanceAfter: user.tokenBalance + user.bonusTokens,
    });
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
    if (promo.maxUses !== null && promo.currentUses >= promo.maxUses) {
      throw new BadRequestException('Промокод исчерпан');
    }
    if (promo.usedByUsers.includes(userId)) {
      throw new BadRequestException('Вы уже использовали этот промокод');
    }

    const user = await this.usersService.addBonusTokens(userId, promo.bonusTokens);

    promo.currentUses += 1;
    promo.usedByUsers.push(userId);
    await promo.save();

    await this.createTransaction(userId, {
      type: TransactionType.PROMO_CODE,
      amount: promo.bonusTokens,
      description: `Промокод ${promo.code}: +${promo.bonusTokens} токенов`,
      paymentStatus: PaymentStatus.COMPLETED,
      promoCode: promo.code,
      balanceBefore: user.tokenBalance + user.bonusTokens - promo.bonusTokens,
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
    returnUrl?: string,
  ) {
    if (plan === SubscriptionPlan.FREE) {
      throw new BadRequestException('Cannot subscribe to free plan');
    }

    const planConfig = SUBSCRIPTION_PLANS[plan];
    if (!planConfig) throw new BadRequestException('Invalid plan');

    const paymentProvider = this.getPaymentProvider(provider);

    const result = await paymentProvider.createPayment({
      amount: planConfig.priceRub,
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
      metadata: { plan, planConfig },
    });

    return {
      paymentId: result.paymentId,
      paymentUrl: result.paymentUrl,
      plan: planConfig,
    };
  }

  async activateSubscription(userId: string, plan: SubscriptionPlan) {
    const planConfig = SUBSCRIPTION_PLANS[plan];
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
      plan,
      startDate: now,
      endDate,
      isActive: true,
      tokensPerMonth: planConfig.tokensPerMonth,
      priceRub: planConfig.priceRub,
      features: planConfig.features,
    });
    await subscription.save();

    const user = await this.usersService.findById(userId);
    user.subscriptionPlan = plan;
    user.subscriptionExpiresAt = endDate;
    await user.save();

    await this.usersService.addTokens(userId, planConfig.tokensPerMonth);

    this.logger.log(`✅ Subscription ${plan} activated for user ${userId}`);
  }

  // ─── Баланс ─────────────────────────────────────────────────────

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
      { $group: { _id: null, total: { $sum: { $abs: '$amount' } } } },
    ]);

    return {
      tokenBalance: user.tokenBalance,
      bonusTokens: user.bonusTokens,
      totalAvailable: user.tokenBalance + user.bonusTokens,
      totalSpent: user.totalTokensSpent,
      totalDeposited: user.totalDeposited,
      todaySpent: todaySpent[0]?.total || 0,
      subscription: activeSubscription
        ? {
            plan: activeSubscription.plan,
            expiresAt: activeSubscription.endDate,
            tokensPerMonth: activeSubscription.tokensPerMonth,
            features: activeSubscription.features,
          }
        : null,
      dailyGenerations: user.dailyGenerations,
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
      this.transactionModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.transactionModel.countDocuments(filter),
    ]);

    return {
      transactions,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
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

      const user = await this.usersService.findById(sub.userId.toString());
      user.subscriptionPlan = SubscriptionPlan.FREE;
      user.subscriptionExpiresAt = null;
      await user.save();

      this.logger.log(`Subscription expired for user ${sub.userId}, plan: ${sub.plan}`);
    }

    if (expired.length > 0) {
      this.logger.log(`Deactivated ${expired.length} expired subscriptions`);
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
    const existing = await this.promoCodeModel.findOne({ code: data.code.toUpperCase() });
    if (existing) throw new BadRequestException('Promo code already exists');

    const promo = new this.promoCodeModel({ ...data, code: data.code.toUpperCase() });
    return promo.save();
  }

  async getAllPromoCodes() {
    return this.promoCodeModel.find().sort({ createdAt: -1 }).exec();
  }

  async deactivatePromoCode(code: string) {
    const promo = await this.promoCodeModel.findOne({ code: code.toUpperCase() });
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
      await this.usersService.deductTokens(targetUserId, Math.abs(amount), 'admin_adjustment');
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

    return { balanceBefore, balanceAfter: updatedUser.tokenBalance, adjustment: amount };
  }

  // ─── Статистика ─────────────────────────────────────────────────

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
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            totalRub: { $sum: '$paymentAmountRub' },
            totalTokens: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      this.transactionModel.aggregate([
        { $match: { type: TransactionType.GENERATION, createdAt: { $gte: since } } },
        {
          $group: {
            _id: '$modelSlug',
            count: { $sum: 1 },
            tokensSpent: { $sum: { $abs: '$amount' } },
          },
        },
        { $sort: { count: -1 } },
      ]),
      this.subscriptionModel.countDocuments({ createdAt: { $gte: since }, isActive: true }),
    ]);

    return { revenue, generations, newSubscriptions };
  }

  // ─── Private helpers ────────────────────────────────────────────

  private getPaymentProvider(provider: string) {
    switch (provider) {
      case 'yookassa': return this.yookassaProvider;
      case 'cryptomus': return this.cryptomusProvider;
      case 'stars': return this.starsProvider;
      default: throw new BadRequestException(`Unknown payment provider: ${provider}`);
    }
  }

  /**
   * Создаёт транзакцию. userId передаётся отдельно как string,
   * внутри конвертируется в ObjectId.
   */
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
}