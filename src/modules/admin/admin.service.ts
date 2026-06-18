import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { BillingService } from '../billing/billing.service';
import { Generation, GenerationDocument } from '../generation/schemas/generation.schema';
import { Transaction, TransactionDocument } from '../billing/schemas/transaction.schema';
import {
  UserRole,
  TransactionType,
  PaymentStatus,
  GenerationStatus,
} from '@/common/interfaces';
import { AIModel, ModelDocument } from '../ai-providers/schemas/model.schema';
import {
  TokenomicsSettings,
  TokenomicsSettingsDocument,
} from './schemas/tokenomics-settings.schema';

type BalanceType = 'tokenBalance' | 'bonusTokens' | 'cashbackBalance';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Generation.name) private generationModel: Model<GenerationDocument>,
    @InjectModel(Transaction.name) private transactionModel: Model<TransactionDocument>,
    @InjectModel(AIModel.name) private aiModelModel: Model<ModelDocument>,
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
    @Inject(forwardRef(() => AiProvidersService))
    private aiProvidersService: AiProvidersService,
    @Inject(forwardRef(() => BillingService))
    private billingService: BillingService,
    @InjectModel(TokenomicsSettings.name)
    private tokenomicsModel: Model<TokenomicsSettingsDocument>,
  ) {}

  // ─── Dashboard ──────────────────────────────────────────────────

  async getDashboardStats() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers,
      activeToday,
      newToday,
      newThisMonth,
      totalGenerations,
      generationsToday,
      revenue,
      activeSubscriptions,
    ] = await Promise.all([
      this.userModel.countDocuments({ isDeleted: { $ne: true } }),
      this.userModel.countDocuments({
        isDeleted: { $ne: true },
        lastActiveAt: { $gte: today },
      }),
      this.userModel.countDocuments({
        isDeleted: { $ne: true },
        createdAt: { $gte: today },
      }),
      this.userModel.countDocuments({
        isDeleted: { $ne: true },
        createdAt: { $gte: thisMonth },
      }),
      this.generationModel.countDocuments(),
      this.generationModel.countDocuments({ createdAt: { $gte: today } }),
      this.transactionModel.aggregate([
        {
          $match: {
            type: TransactionType.DEPOSIT,
            paymentStatus: PaymentStatus.COMPLETED,
            createdAt: { $gte: thisMonth },
          },
        },
        { $group: { _id: null, total: { $sum: '$paymentAmountRub' } } },
      ]),
      this.userModel.countDocuments({
        isDeleted: { $ne: true },
        subscriptionPlan: { $ne: 'free' },
        subscriptionExpiresAt: { $gt: now },
      }),
    ]);

    return {
      users: { total: totalUsers, activeToday, newToday, newThisMonth },
      generations: { total: totalGenerations, today: generationsToday },
      revenue: { thisMonth: revenue[0]?.total || 0 },
      subscriptions: { active: activeSubscriptions },
    };
  }

  // ─── Users management ──────────────────────────────────────────

  /**
   * Список пользователей с фильтрами/поиском/сортировкой.
   * Возвращает в формате удобном для фронта (items + total + page + pages).
   */
  async getUsers(
    page: number,
    limit: number,
    search?: string,
    role?: UserRole | 'all',
    banned?: 'all' | 'active' | 'banned',
    sortBy: string = 'createdAt',
    order: 'asc' | 'desc' = 'desc',
  ) {
    const filter: any = { isDeleted: { $ne: true } };

    if (search && search.trim()) {
      const term = search.trim();
      const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const orArr: any[] = [
        { username: rx },
        { firstName: rx },
        { lastName: rx },
        { email: rx },
      ];
      const asNumber = Number(term);
      if (!isNaN(asNumber)) orArr.push({ telegramId: asNumber });
      filter.$or = orArr;
    }

    if (role && role !== 'all') filter.role = role;
    if (banned === 'banned') filter.isBanned = true;
    if (banned === 'active') filter.isBanned = { $ne: true };

    const allowedSort = new Set([
      'createdAt',
      'lastActiveAt',
      'totalDeposited',
      'totalTokensSpent',
      'tokenBalance',
    ]);
    const sortField = allowedSort.has(sortBy) ? sortBy : 'createdAt';
    const sort: any = { [sortField]: order === 'asc' ? 1 : -1 };

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (safePage - 1) * safeLimit;

    const [items, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort(sort)
        .skip(skip)
        .limit(safeLimit)
        .select('-__v -passwordHash')
        .lean()
        .exec(),
      this.userModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page: safePage,
      pages: Math.ceil(total / safeLimit) || 1,
    };
  }

  /**
   * Детали одного пользователя + последние транзакции и генерации.
   */
    /**
   * Детали одного пользователя + последние транзакции и генерации.
   * 🆕 Дополнительно возвращает активную подписку и состояние free-лимитов.
   */
  async getUserById(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }

    const user = await this.userModel
      .findOne({ _id: userId, isDeleted: { $ne: true } })
      .select('-__v -passwordHash')
      .lean()
      .exec();

    if (!user) throw new NotFoundException('User not found');

    const uOid = new Types.ObjectId(userId);

    const [
      recentTransactions,
      recentGenerations,
      generationsCount,
      transactionsCount,
      referrer,
      invitedUsers,
    ] = await Promise.all([
      this.transactionModel
        .find({ userId: uOid })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean()
        .exec(),
      this.generationModel
        .find({ userId: uOid })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean()
        .exec(),
      this.generationModel.countDocuments({ userId: uOid }),
      this.transactionModel.countDocuments({ userId: uOid }),
      user.referredBy
        ? this.userModel
            .findById(user.referredBy)
            .select('_id username firstName lastName photoUrl telegramId')
            .lean()
            .exec()
        : Promise.resolve(null),
      this.userModel
        .find({ referredBy: uOid, isDeleted: { $ne: true } })
        .select('_id username firstName lastName photoUrl telegramId createdAt')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean()
        .exec(),
    ]);

    // 🆕 Активная подписка + конфиг плана + использование free-моделей
    let subscriptionInfo: any = null;
    try {
      const planConfig = await this.billingService.getPlanConfigPublic(
        user.subscriptionPlan,
      );

      // Активная запись Subscription из коллекции (для аудита: source/admin/promo)
      const activeSubscription = await this.billingService
        .getActiveSubscription(userId)
        .catch(() => null);

      const isActive =
        user.subscriptionPlan !== 'free' &&
        !!user.subscriptionExpiresAt &&
        new Date(user.subscriptionExpiresAt) > new Date();

      // Использование free-моделей (для каждой модели в плане)
      const freeModelsUsage: Array<{
        modelSlug: string;
        displayName: string;
        hourlyLimit: number | null;
        dailyLimit: number | null;
        hourlyUsed: number;
        dailyUsed: number;
        requiredParams?: Record<string, any> | null;
      }> = [];

      if (planConfig?.freeModels?.length) {
        for (const fm of planConfig.freeModels) {
          const usage = await this.billingService
            .getFreeAccessUsage(userId, fm.modelSlug)
            .catch(() => null);
          if (!usage) continue;

          freeModelsUsage.push({
            modelSlug: fm.modelSlug,
            displayName: fm.displayName,
            hourlyLimit: usage.hourlyLimit,
            dailyLimit: usage.dailyLimit,
            hourlyUsed: usage.hourlyUsed,
            dailyUsed: usage.dailyUsed,
            requiredParams: usage.requiredParams,
          });
        }
      }

      subscriptionInfo = {
        plan: user.subscriptionPlan,
        planName: planConfig?.name || (user.subscriptionPlan === 'free' ? 'Free' : null),
        expiresAt: user.subscriptionExpiresAt || null,
        isActive,
        tokensPerMonth: planConfig?.tokensPerMonth || 0,
        bonusTokens: planConfig?.bonusTokens || 0,
        modelsAccess: planConfig?.modelsAccess || 'limited',
        // Источник активации (admin/payment/promo) из последней Subscription записи
        source: activeSubscription
          ? (activeSubscription as any).metadata?.adminActivated
            ? 'admin'
            : (activeSubscription as any).metadata?.activatedByPromo
              ? 'promo'
              : 'payment'
          : null,
        startedAt: activeSubscription?.startDate || null,
        adminReason:
          (activeSubscription as any)?.metadata?.reason || null,
        freeModels: freeModelsUsage,
      };
    } catch (err: any) {
      this.logger.warn(
        `Failed to build subscriptionInfo for user ${userId}: ${err.message}`,
      );
    }

    return {
      user,
      stats: {
        generationsCount,
        transactionsCount,
        invitedCount: invitedUsers.length,
      },
      subscription: subscriptionInfo, // 🆕
      recentTransactions,
      recentGenerations,
      referrer,
      invitedUsers,
    };
  }

  /**
   * Смена роли пользователя.
   * Только SUPER_ADMIN (guard на контроллере), здесь — защита от self-edit.
   */
  async changeUserRole(adminId: string, userId: string, role: UserRole) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }
    if (userId === adminId) {
      throw new BadRequestException('Нельзя менять собственную роль');
    }

    const allowed = [UserRole.USER, UserRole.ADMIN, UserRole.SUPER_ADMIN] as any[];
    // moderator поддерживаем если есть в enum
    if ((UserRole as any).MODERATOR) allowed.push((UserRole as any).MODERATOR);

    if (!allowed.includes(role)) {
      throw new BadRequestException(`Invalid role: ${role}`);
    }

    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const prevRole = user.role;
    user.role = role;
    await user.save();

    this.logger.warn(
      `Role changed: user=${userId} ${prevRole} → ${role} by admin=${adminId}`,
    );

    return user.toObject();
  }

  /**
   * Бан / разбан пользователя.
   */
  async toggleBan(
    adminId: string,
    userId: string,
    ban: boolean,
    reason?: string,
  ) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }
    if (userId === adminId) {
      throw new BadRequestException('Нельзя забанить самого себя');
    }

    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (
      ban &&
      (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN)
    ) {
      throw new BadRequestException(
        'Нельзя забанить администратора. Сначала снимите роль.',
      );
    }

    user.isBanned = ban;
    user.banReason = ban ? (reason || '').trim() : '';
    if (ban) user.isActive = false;
    else if (!user.isDeleted) user.isActive = true;

    await user.save();

        this.logger.warn(
      `User ${userId} ${ban ? 'BANNED' : 'UNBANNED'} by admin=${adminId}${
        reason ? ` reason="${reason}"` : ''
      }`,
    );

    return user.toObject();
  }

  /**
   * Корректировка любого из трёх балансов: tokenBalance / bonusTokens / cashbackBalance.
   * Пишет транзакцию TransactionType.ADMIN_ADJUSTMENT с подробной metadata.
   */
  async adminAdjustBalanceV2(
    adminId: string,
    userId: string,
    balanceType: BalanceType,
    amount: number,
    reason: string,
  ) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }
    if (!['tokenBalance', 'bonusTokens', 'cashbackBalance'].includes(balanceType)) {
      throw new BadRequestException('Invalid balance type');
    }
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount === 0) {
      throw new BadRequestException('Amount must be non-zero number');
    }
    if (!Number.isInteger(numAmount)) {
      throw new BadRequestException('Amount must be integer');
    }
    if (!reason || reason.trim().length < 3) {
      throw new BadRequestException('Reason is required (min 3 chars)');
    }

    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (user.isDeleted) {
      throw new BadRequestException('Cannot adjust balance of deleted user');
    }

    const before = (user as any)[balanceType] as number;
    const after = before + numAmount;
    if (after < 0) {
      throw new BadRequestException(
        `Недостаточно средств: ${balanceType}=${before}, попытка изменения ${numAmount}`,
      );
    }

    (user as any)[balanceType] = after;

    // Если зачисляем cashback — обновим cashbackEarnedTotal
    if (balanceType === 'cashbackBalance' && numAmount > 0) {
      user.cashbackEarnedTotal = (user.cashbackEarnedTotal || 0) + numAmount;
    }

    await user.save();

    // Записываем транзакцию
    const totalBalance =
      user.tokenBalance + user.bonusTokens + user.cashbackBalance;
    const totalBalanceBefore = totalBalance - numAmount;

    await this.transactionModel.create({
      userId: new Types.ObjectId(userId),
      type: TransactionType.ADMIN_ADJUSTMENT,
      amount: numAmount,
      description: `Админ-корректировка (${balanceType}): ${reason}`,
      paymentStatus: PaymentStatus.COMPLETED,
      balanceBefore: totalBalanceBefore,
      balanceAfter: totalBalance,
      metadata: {
        adminUserId: adminId,
        balanceType,
        reason,
        valueBefore: before,
        valueAfter: after,
      },
    });

    this.logger.warn(
      `Balance adjusted: user=${userId} ${balanceType} ${before} → ${after} (${
        numAmount > 0 ? '+' : ''
      }${numAmount}) by admin=${adminId} | ${reason}`,
    );

    return {
      userId,
      balanceType,
      before,
      after,
      amount: numAmount,
      totals: {
        tokenBalance: user.tokenBalance,
        bonusTokens: user.bonusTokens,
        cashbackBalance: user.cashbackBalance,
        total: totalBalance,
      },
    };
  }

  /**
   * Soft-delete + анонимизация пользователя.
   */
  async deleteUser(adminId: string, userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }

    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (user._id.toString() === adminId) {
      throw new BadRequestException('Нельзя удалить собственный аккаунт');
    }
    if (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN) {
      throw new BadRequestException(
        'Нельзя удалить администратора. Сначала снимите роль.',
      );
    }
    if (user.isDeleted) {
      throw new BadRequestException('Пользователь уже удалён');
    }

    user.isDeleted = true;
    user.deletedAt = new Date();
    user.deletedBy = new Types.ObjectId(adminId);
    user.isBanned = true;
    user.isActive = false;
    user.banReason = 'Аккаунт удалён администратором';

    // Анонимизация PII
    if (user.email) user.email = `deleted_${user._id}@deleted.local`;
    user.telegramId = null as any;
    user.googleId = null as any;
    user.firstName = 'Deleted';
    user.lastName = 'User';
    user.username = '';
    user.photoUrl = '';
    user.passwordHash = null as any;
    user.referralCode = `DEL_${user._id.toString().slice(-6)}`;

    await user.save();

    this.logger.warn(`User ${userId} deleted by admin ${adminId}`);

    return { deleted: true, userId };
  }

    // ─── Subscription management ───────────────────────────────────

  /**
   * 🆕 Ручная установка/снятие подписки для пользователя.
   * Делегирует BillingService.adminActivateSubscription, который:
   *  - создаёт запись в коллекции Subscription (для аудита)
   *  - обновляет user.subscriptionPlan + user.subscriptionExpiresAt
   *  - опционально начисляет токены плана
   */
  async setUserSubscription(
    adminId: string,
    userId: string,
    body: {
      plan: any; // SubscriptionPlan
      durationDays?: number;
      expiresAt?: string;
      grantTokens?: boolean;
      reason?: string;
    },
  ) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }

    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (user.isDeleted) {
      throw new BadRequestException(
        'Cannot set subscription for deleted user',
      );
    }

        const result = await this.billingService.adminActivateSubscription(
      adminId,
      userId,
      body.plan,
      {
        durationDays: body.durationDays,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        grantTokens: !!body.grantTokens,
        reason: body.reason,
      },
    );

    // Перечитываем юзера (балансы могли измениться если grantTokens=true)
    const fresh = await this.userModel
      .findById(userId)
      .select('-__v -passwordHash')
      .lean()
      .exec();

    return {
      user: fresh,
      subscription: {
        plan: result.plan,
        expiresAt: result.expiresAt
          ? result.expiresAt.toISOString()
          : null,
        grantedTokens: result.grantedTokens,
        grantedBonusTokens: result.grantedBonusTokens,
      },
    };
  }

  // ─── Providers ──────────────────────────────────────────────────

  async getProviders() {
    return this.aiProvidersService.getAllProviders();
  }

  async updateProvider(slug: string, updates: any) {
    return this.aiProvidersService.updateProvider(slug, updates);
  }

  // ─── Models ─────────────────────────────────────────────────────

  async getModelsFiltered(filters: {
    search?: string;
    type?: string;
    isActive?: string;
    isPremium?: string;
  }) {
    const q: any = {};

    if (filters.type) q.type = filters.type;
    if (filters.isActive === 'true') q.isActive = true;
    if (filters.isActive === 'false') q.isActive = false;
    if (filters.isPremium === 'true') q.isPremium = true;
    if (filters.isPremium === 'false') q.isPremium = false;

    if (filters.search) {
      const rx = new RegExp(filters.search.trim(), 'i');
      q.$or = [{ slug: rx }, { name: rx }, { displayName: rx }];
    }

    const items = await this.aiModelModel
      .find(q)
      .sort({ type: 1, sortOrder: 1, displayName: 1 })
      .lean()
      .exec();

    return { items, total: items.length };
  }

  async getModelBySlug(slug: string) {
    const model = await this.aiModelModel.findOne({ slug }).lean().exec();
    if (!model) throw new NotFoundException(`Model "${slug}" not found`);
    return model;
  }

  async updateModel(slug: string, updates: any) {
    const updated = await this.aiModelModel
      .findOneAndUpdate({ slug }, { $set: updates }, { new: true })
      .lean()
      .exec();
    if (!updated) throw new NotFoundException(`Model "${slug}" not found`);
    this.logger.log(`Model "${slug}" updated: ${Object.keys(updates).join(', ')}`);
    return updated;
  }

  async toggleModelActive(slug: string) {
    const model = await this.aiModelModel.findOne({ slug }).exec();
    if (!model) throw new NotFoundException(`Model "${slug}" not found`);
    model.isActive = !model.isActive;
    await model.save();
    return model.toObject();
  }

  async createModel(data: any) {
    const exists = await this.aiModelModel.findOne({ slug: data.slug }).lean();
    if (exists) {
      throw new BadRequestException(`Model with slug "${data.slug}" already exists`);
    }
    const created = await this.aiModelModel.create(data);
    this.logger.log(`Model "${data.slug}" created`);
    return created.toObject();
  }

  async deleteModel(slug: string, hard = false) {
    if (hard) {
      const res = await this.aiModelModel.deleteOne({ slug }).exec();
      if (!res.deletedCount) throw new NotFoundException(`Model "${slug}" not found`);
      this.logger.warn(`Model "${slug}" HARD-deleted`);
      return { deleted: true, hard: true };
    }
    const updated = await this.aiModelModel
      .findOneAndUpdate({ slug }, { $set: { isActive: false } }, { new: true })
      .lean();
    if (!updated) throw new NotFoundException(`Model "${slug}" not found`);
    this.logger.log(`Model "${slug}" soft-deleted (isActive=false)`);
    return { deleted: true, hard: false, model: updated };
  }

  // ─── Analytics ──────────────────────────────────────────────────

  async getRevenueAnalytics(days: number) {
    return this.billingService.getRevenueStats(days);
  }

  async getGenerationAnalytics(days: number) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [byDay, byType, byStatus] = await Promise.all([
      this.generationModel.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              type: '$type',
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.date': 1 } },
      ]),
      this.generationModel.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 },
            avgResponseTime: { $avg: '$responseTimeMs' },
            successCount: {
              $sum: { $cond: [{ $eq: ['$status', GenerationStatus.COMPLETED] }, 1, 0] },
            },
            failCount: {
              $sum: { $cond: [{ $eq: ['$status', GenerationStatus.FAILED] }, 1, 0] },
            },
          },
        },
      ]),
      this.generationModel.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    return { byDay, byType, byStatus };
  }

  async getModelUsageAnalytics() {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    return this.generationModel.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: '$modelSlug',
          totalRequests: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ['$status', GenerationStatus.COMPLETED] }, 1, 0] },
          },
          failed: {
            $sum: { $cond: [{ $eq: ['$status', GenerationStatus.FAILED] }, 1, 0] },
          },
          avgResponseTime: { $avg: '$responseTimeMs' },
          totalTokensSpent: { $sum: '$tokensCost' },
        },
      },
      {
        $addFields: {
          successRate: {
            $cond: [
              { $gt: ['$totalRequests', 0] },
              { $multiply: [{ $divide: ['$completed', '$totalRequests'] }, 100] },
              0,
            ],
          },
        },
      },
      { $sort: { totalRequests: -1 } },
    ]);
  }

  // ─── Tokenomics ─────────────────────────────────────────────────

  async getTokenomics() {
    const doc = await this.tokenomicsModel.findOne().lean().exec();
    if (doc) return doc;

    const created = await this.tokenomicsModel.create({
      tokenToDollarRate: 0.01,
      freeTokensOnSignup: 50,
      minPurchaseTokens: 100,
      refundOnError: true,
      purchasePacks: [
        { tokens: 100, priceRub: 99, bonusTokens: 0, label: 'Старт' },
        { tokens: 500, priceRub: 449, bonusTokens: 50, label: 'Популярная', highlight: true },
        { tokens: 1000, priceRub: 849, bonusTokens: 150 },
        { tokens: 5000, priceRub: 3990, bonusTokens: 1000, label: 'Выгодная' },
      ],
    });

    return created.toObject();
  }

  async updateTokenomics(adminId: string, updates: any) {
    const existing = await this.tokenomicsModel.findOne().exec();

    if (!existing) {
      const created = await this.tokenomicsModel.create({ ...updates, updatedBy: adminId });
      this.logger.log(`Tokenomics created by ${adminId}`);
      return created.toObject();
    }

    Object.assign(existing, updates, { updatedBy: adminId });
    await existing.save();
    this.logger.log(`Tokenomics updated by ${adminId}`);
    return existing.toObject();
  }
}

    