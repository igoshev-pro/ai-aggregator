import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { BillingService } from '../billing/billing.service';
import { Generation, GenerationDocument } from '../generation/schemas/generation.schema';
import { Transaction, TransactionDocument } from '../billing/schemas/transaction.schema';
import { UserRole, TransactionType, PaymentStatus, GenerationStatus } from '@/common/interfaces';
import { AIModel, ModelDocument } from '../ai-providers/schemas/model.schema';

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
      this.userModel.countDocuments(),
      this.userModel.countDocuments({ lastActiveAt: { $gte: today } }),
      this.userModel.countDocuments({ createdAt: { $gte: today } }),
      this.userModel.countDocuments({ createdAt: { $gte: thisMonth } }),
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
        subscriptionPlan: { $ne: 'free' },
        subscriptionExpiresAt: { $gt: now },
      }),
    ]);

    return {
      users: {
        total: totalUsers,
        activeToday,
        newToday,
        newThisMonth,
      },
      generations: {
        total: totalGenerations,
        today: generationsToday,
      },
      revenue: {
        thisMonth: revenue[0]?.total || 0,
      },
      subscriptions: {
        active: activeSubscriptions,
      },
    };
  }

  // ─── Users management ──────────────────────────────────────────

  async getUsers(
    page: number,
    limit: number,
    search?: string,
    role?: UserRole,
  ) {
    const filter: any = {};

    if (search) {
      filter.$or = [
        { username: { $regex: search, $options: 'i' } },
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { telegramId: isNaN(Number(search)) ? undefined : Number(search) },
      ].filter(Boolean);
    }

    if (role) filter.role = role;

    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-__v')
        .exec(),
      this.userModel.countDocuments(filter),
    ]);

    return {
      users,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async changeUserRole(userId: string, role: UserRole) {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { role },
      { new: true },
    );
    return user;
  }

  async toggleBan(userId: string, ban: boolean, reason?: string) {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      {
        isBanned: ban,
        banReason: ban ? reason : null,
      },
      { new: true },
    );
    return user;
  }

  async adjustBalance(
    adminId: string,
    userId: string,
    amount: number,
    reason: string,
  ) {
    return this.billingService.adminAdjustBalance(adminId, userId, amount, reason);
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
  if (!model) throw new Error(`Model "${slug}" not found`);
  return model;
}

async updateModel(slug: string, updates: any) {
  const updated = await this.aiModelModel
    .findOneAndUpdate({ slug }, { $set: updates }, { new: true })
    .lean()
    .exec();
  if (!updated) throw new Error(`Model "${slug}" not found`);
  this.logger.log(`Model "${slug}" updated: ${Object.keys(updates).join(', ')}`);
  return updated;
}

async toggleModelActive(slug: string) {
  const model = await this.aiModelModel.findOne({ slug }).exec();
  if (!model) throw new Error(`Model "${slug}" not found`);
  model.isActive = !model.isActive;
  await model.save();
  return model.toObject();
}

async createModel(data: any) {
  const exists = await this.aiModelModel.findOne({ slug: data.slug }).lean();
  if (exists) throw new Error(`Model with slug "${data.slug}" already exists`);
  const created = await this.aiModelModel.create(data);
  this.logger.log(`Model "${data.slug}" created`);
  return created.toObject();
}

async deleteModel(slug: string, hard = false) {
  if (hard) {
    const res = await this.aiModelModel.deleteOne({ slug }).exec();
    if (!res.deletedCount) throw new Error(`Model "${slug}" not found`);
    this.logger.warn(`Model "${slug}" HARD-deleted`);
    return { deleted: true, hard: true };
  }
  const updated = await this.aiModelModel
    .findOneAndUpdate({ slug }, { $set: { isActive: false } }, { new: true })
    .lean();
  if (!updated) throw new Error(`Model "${slug}" not found`);
  this.logger.log(`Model "${slug}" soft-deleted (isActive=false)`);
  return { deleted: true, hard: false, model: updated };
}

  // ─── Promo codes ────────────────────────────────────────────────

  async getPromoCodes() {
    return this.billingService.getAllPromoCodes();
  }

  async createPromoCode(adminId: string, data: any) {
    return this.billingService.createPromoCode({
      ...data,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      createdBy: adminId,
    });
  }

  async deactivatePromo(code: string) {
    return this.billingService.deactivatePromoCode(code);
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
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
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
}