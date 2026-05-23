import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, FilterQuery } from 'mongoose';
import {
  Transaction,
  TransactionDocument,
} from '../billing/schemas/transaction.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  TransactionType,
  PaymentStatus,
} from '@/common/interfaces';

interface ListParams {
  page: number;
  limit: number;
  search?: string;
  userId?: string;
  type?: TransactionType | 'all';
  status?: PaymentStatus | 'all';
  provider?: string;
  modelSlug?: string;
  promoCode?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMin?: number;
  amountMax?: number;
  sortBy?: string;
  order?: 'asc' | 'desc';
}

interface AdminUserLite {
  _id: Types.ObjectId;
  username?: string;
  firstName?: string;
  lastName?: string;
  photoUrl?: string;
  telegramId?: number | null;
  email?: string | null;
}

interface ListResult {
  items: Array<Record<string, any> & { user: AdminUserLite | null }>;
  total: number;
  page: number;
  pages: number;
  totals: { count: number; tokens: number; rub: number };
}

interface TxDetailsResult {
  transaction: Record<string, any>;
  user: AdminUserLite | null;
  referralUser: AdminUserLite | null;
  relatedTransactions: Array<Record<string, any>>;
}

interface StatsResult {
  period: { days: number; since: Date };
  summary: {
    totalCount: number;
    depositsRub: number;
    subscriptionsRub: number;
    totalRevenueRub: number;
    tokensDeposited: number;
    tokensSpent: number;
    pendingCount: number;
    failedCount: number;
  };
  byType: any[];
  byStatus: any[];
  byProvider: any[];
  revenueByDay: any[];
  generationsByDay: any[];
  topModels: any[];
  topSpenders: any[];
  promoStats: any[];
  refunds: { count: number; tokens: number };
}

@Injectable()
export class AdminTransactionsService {
  private readonly logger = new Logger(AdminTransactionsService.name);

  constructor(
    @InjectModel(Transaction.name)
    private transactionModel: Model<TransactionDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // Список транзакций с фильтрами / поиском / сортировкой
  // ═══════════════════════════════════════════════════════════════

  async list(params: ListParams): Promise<ListResult> {
    const filter: FilterQuery<TransactionDocument> = {};

    // userId — точечный фильтр
    if (params.userId) {
      if (!Types.ObjectId.isValid(params.userId)) {
        throw new BadRequestException('Invalid userId');
      }
      filter.userId = new Types.ObjectId(params.userId);
    }

    // Типовые фильтры
    if (params.type && params.type !== 'all') filter.type = params.type;
    if (params.status && params.status !== 'all') {
      filter.paymentStatus = params.status;
    }
    if (params.provider) filter.paymentProvider = params.provider;
    if (params.modelSlug) filter.modelSlug = params.modelSlug;
    if (params.promoCode) {
      filter.promoCode = params.promoCode.trim().toUpperCase();
    }

    // Период
    if (params.dateFrom || params.dateTo) {
      filter.createdAt = {};
      if (params.dateFrom) {
        const d = new Date(params.dateFrom);
        if (isNaN(d.getTime())) throw new BadRequestException('Invalid dateFrom');
        (filter.createdAt as any).$gte = d;
      }
      if (params.dateTo) {
        const d = new Date(params.dateTo);
        if (isNaN(d.getTime())) throw new BadRequestException('Invalid dateTo');
        (filter.createdAt as any).$lte = d;
      }
    }

    // Диапазон суммы (по абсолютному значению токенов)
    if (params.amountMin !== undefined || params.amountMax !== undefined) {
      filter.amount = {};
      if (params.amountMin !== undefined && Number.isFinite(params.amountMin)) {
        (filter.amount as any).$gte = params.amountMin;
      }
      if (params.amountMax !== undefined && Number.isFinite(params.amountMax)) {
        (filter.amount as any).$lte = params.amountMax;
      }
    }

    // Поиск — по externalPaymentId / generationId / description / promoCode
    if (params.search && params.search.trim()) {
      const term = params.search.trim();
      const rx = new RegExp(
        term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );

      const orArr: any[] = [
        { externalPaymentId: rx },
        { generationId: rx },
        { description: rx },
        { promoCode: rx },
      ];

      // Если поиск — валидный ObjectId, добавим как userId
      if (Types.ObjectId.isValid(term)) {
        orArr.push({ userId: new Types.ObjectId(term) });
        orArr.push({ _id: new Types.ObjectId(term) });
      }

      // Поиск по telegramId / username / email юзера
      const asNumber = Number(term);
      const userOr: any[] = [
        { username: rx },
        { firstName: rx },
        { lastName: rx },
        { email: rx },
      ];
      if (!isNaN(asNumber)) userOr.push({ telegramId: asNumber });

      const matchedUsers: Array<{ _id: Types.ObjectId }> = await this.userModel
        .find({ $or: userOr })
        .select('_id')
        .limit(50)
        .lean<{ _id: Types.ObjectId }[]>()
        .exec();

      if (matchedUsers.length > 0) {
        orArr.push({
          userId: { $in: matchedUsers.map((u) => u._id) },
        });
      }

      filter.$or = orArr;
    }

    // Сортировка
    const allowedSort = new Set([
      'createdAt',
      'amount',
      'paymentAmountRub',
      'type',
      'paymentStatus',
    ]);
    const sortField = allowedSort.has(params.sortBy || '')
      ? (params.sortBy as string)
      : 'createdAt';
    const sort: any = { [sortField]: params.order === 'asc' ? 1 : -1 };

    // Пагинация
    const safePage = Math.max(1, Number(params.page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const skip = (safePage - 1) * safeLimit;

    const [items, total, totalsAgg]: [any[], number, any[]] = await Promise.all([
      this.transactionModel
        .find(filter)
        .sort(sort)
        .skip(skip)
        .limit(safeLimit)
        .lean<any[]>()
        .exec(),
      this.transactionModel.countDocuments(filter),
      this.transactionModel.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalTokens: { $sum: '$amount' },
            totalRub: { $sum: { $ifNull: ['$paymentAmountRub', 0] } },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    // Подтягиваем юзеров одной пачкой
    const userIds: string[] = Array.from(
      new Set(
        items
          .map((t: any) => t.userId?.toString())
          .filter((x: string | undefined): x is string => Boolean(x)),
      ),
    );

    const users: AdminUserLite[] = await this.userModel
      .find({ _id: { $in: userIds.map((id) => new Types.ObjectId(id)) } })
      .select('_id username firstName lastName photoUrl telegramId email')
      .lean<AdminUserLite[]>()
      .exec();

    const userMap = new Map<string, AdminUserLite>(
      users.map((u) => [u._id.toString(), u]),
    );

    const itemsWithUser = items.map((t: any) => ({
      ...t,
      user: (userMap.get(t.userId?.toString()) || null) as AdminUserLite | null,
    }));

    const totals = totalsAgg[0] || { totalTokens: 0, totalRub: 0, count: 0 };

    return {
      items: itemsWithUser,
      total,
      page: safePage,
      pages: Math.ceil(total / safeLimit) || 1,
      totals: {
        count: totals.count,
        tokens: totals.totalTokens,
        rub: totals.totalRub,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Детали транзакции
  // ═══════════════════════════════════════════════════════════════

  async getById(id: string): Promise<TxDetailsResult> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid transaction id');
    }

    const tx: any = await this.transactionModel
      .findById(id)
      .lean<any>()
      .exec();
    if (!tx) throw new NotFoundException('Transaction not found');

    const userPromise: Promise<AdminUserLite | null> = tx.userId
      ? this.userModel
          .findById(tx.userId)
          .select(
            '_id username firstName lastName photoUrl telegramId email tokenBalance bonusTokens cashbackBalance',
          )
          .lean<AdminUserLite>()
          .exec()
          .then((u) => u || null)
      : Promise.resolve(null);

    const referralPromise: Promise<AdminUserLite | null> = tx.referralUserId
      ? this.userModel
          .findById(tx.referralUserId)
          .select('_id username firstName lastName photoUrl telegramId')
          .lean<AdminUserLite>()
          .exec()
          .then((u) => u || null)
      : Promise.resolve(null);

    const relatedPromise: Promise<any[]> =
      tx.generationId || tx.externalPaymentId
        ? this.transactionModel
            .find({
              _id: { $ne: tx._id },
              $or: [
                tx.generationId ? { generationId: tx.generationId } : null,
                tx.externalPaymentId
                  ? { externalPaymentId: tx.externalPaymentId }
                  : null,
              ].filter(Boolean) as any[],
            })
            .sort({ createdAt: -1 })
            .limit(10)
            .lean<any[]>()
            .exec()
        : Promise.resolve([]);

    const [user, referralUser, relatedTransactions] = await Promise.all([
      userPromise,
      referralPromise,
      relatedPromise,
    ]);

    return {
      transaction: tx,
      user,
      referralUser,
      relatedTransactions,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Статистика для дашборда
  // ═══════════════════════════════════════════════════════════════

  async getStats(days = 30): Promise<StatsResult> {
    const safeDays = Math.min(365, Math.max(1, Number(days) || 30));
    const since = new Date();
    since.setDate(since.getDate() - safeDays);

    const matchPeriod = { createdAt: { $gte: since } };

    const [
      summary,
      byType,
      byStatus,
      byProvider,
      revenueByDay,
      generationsByDay,
      topModels,
      topSpenders,
      promoStats,
      refundsStats,
    ]: [
      any[],
      any[],
      any[],
      any[],
      any[],
      any[],
      any[],
      any[],
      any[],
      any[],
    ] = await Promise.all([
      // ─── Общая сводка ────────────────────────────────────────
      this.transactionModel.aggregate([
        { $match: matchPeriod },
        {
          $group: {
            _id: null,
            totalCount: { $sum: 1 },
            totalRevenueRub: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$type', TransactionType.DEPOSIT] },
                      { $eq: ['$paymentStatus', PaymentStatus.COMPLETED] },
                    ],
                  },
                  { $ifNull: ['$paymentAmountRub', 0] },
                  0,
                ],
              },
            },
            totalSubscriptionRub: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$type', TransactionType.SUBSCRIPTION] },
                      { $eq: ['$paymentStatus', PaymentStatus.COMPLETED] },
                    ],
                  },
                  { $ifNull: ['$paymentAmountRub', 0] },
                  0,
                ],
              },
            },
            tokensDeposited: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$type', TransactionType.DEPOSIT] },
                      { $eq: ['$paymentStatus', PaymentStatus.COMPLETED] },
                    ],
                  },
                  '$amount',
                  0,
                ],
              },
            },
            tokensSpent: {
              $sum: {
                $cond: [
                  { $eq: ['$type', TransactionType.GENERATION] },
                  { $abs: '$amount' },
                  0,
                ],
              },
            },
            pendingCount: {
              $sum: {
                $cond: [
                  { $eq: ['$paymentStatus', PaymentStatus.PENDING] },
                  1,
                  0,
                ],
              },
            },
            failedCount: {
              $sum: {
                $cond: [
                  { $eq: ['$paymentStatus', PaymentStatus.FAILED] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),

      // ─── По типам ────────────────────────────────────────────
      this.transactionModel.aggregate([
        { $match: matchPeriod },
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 },
            tokens: { $sum: '$amount' },
            rub: { $sum: { $ifNull: ['$paymentAmountRub', 0] } },
          },
        },
        { $sort: { count: -1 } },
      ]),

      // ─── По статусам ─────────────────────────────────────────
      this.transactionModel.aggregate([
        { $match: matchPeriod },
        {
          $group: {
            _id: '$paymentStatus',
            count: { $sum: 1 },
            rub: { $sum: { $ifNull: ['$paymentAmountRub', 0] } },
          },
        },
      ]),

      // ─── По провайдерам оплаты ───────────────────────────────
      this.transactionModel.aggregate([
        {
          $match: {
            ...matchPeriod,
            paymentProvider: { $exists: true, $ne: null },
            paymentStatus: PaymentStatus.COMPLETED,
          },
        },
        {
          $group: {
            _id: '$paymentProvider',
            count: { $sum: 1 },
            rub: { $sum: { $ifNull: ['$paymentAmountRub', 0] } },
            tokens: { $sum: '$amount' },
          },
        },
        { $sort: { rub: -1 } },
      ]),

      // ─── Выручка по дням ─────────────────────────────────────
      this.transactionModel.aggregate([
        {
          $match: {
            ...matchPeriod,
            type: {
              $in: [TransactionType.DEPOSIT, TransactionType.SUBSCRIPTION],
            },
            paymentStatus: PaymentStatus.COMPLETED,
          },
        },
        {
          $group: {
            _id: {
              date: {
                $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
              },
              type: '$type',
            },
            rub: { $sum: { $ifNull: ['$paymentAmountRub', 0] } },
            tokens: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.date': 1 } },
      ]),

      // ─── Расход токенов по дням ──────────────────────────────
      this.transactionModel.aggregate([
        {
          $match: {
            ...matchPeriod,
            type: TransactionType.GENERATION,
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
            },
            tokens: { $sum: { $abs: '$amount' } },
            count: { $sum: 1 },
            costDollars: { $sum: { $ifNull: ['$metadata.costInDollars', 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // ─── Топ моделей ─────────────────────────────────────────
      this.transactionModel.aggregate([
        {
          $match: {
            ...matchPeriod,
            type: TransactionType.GENERATION,
            modelSlug: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: '$modelSlug',
            count: { $sum: 1 },
            tokens: { $sum: { $abs: '$amount' } },
            costDollars: { $sum: { $ifNull: ['$metadata.costInDollars', 0] } },
          },
        },
        { $sort: { tokens: -1 } },
        { $limit: 10 },
      ]),

      // ─── Топ-10 платящих юзеров ──────────────────────────────
      this.transactionModel.aggregate([
        {
          $match: {
            ...matchPeriod,
            type: {
              $in: [TransactionType.DEPOSIT, TransactionType.SUBSCRIPTION],
            },
            paymentStatus: PaymentStatus.COMPLETED,
          },
        },
        {
          $group: {
            _id: '$userId',
            totalRub: { $sum: { $ifNull: ['$paymentAmountRub', 0] } },
            totalTokens: { $sum: '$amount' },
            paymentsCount: { $sum: 1 },
          },
        },
        { $sort: { totalRub: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            userId: '$_id',
            totalRub: 1,
            totalTokens: 1,
            paymentsCount: 1,
            user: {
              _id: '$user._id',
              username: '$user.username',
              firstName: '$user.firstName',
              lastName: '$user.lastName',
              photoUrl: '$user.photoUrl',
              telegramId: '$user.telegramId',
              email: '$user.email',
            },
          },
        },
      ]),

      // ─── Промокоды ───────────────────────────────────────────
      this.transactionModel.aggregate([
        {
          $match: {
            ...matchPeriod,
            promoCode: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: '$promoCode',
            usageCount: { $sum: 1 },
            bonusTokens: {
              $sum: {
                $cond: [
                  { $eq: ['$type', TransactionType.PROMO_CODE] },
                  '$amount',
                  0,
                ],
              },
            },
          },
        },
        { $sort: { usageCount: -1 } },
        { $limit: 10 },
      ]),

      // ─── Рефанды ─────────────────────────────────────────────
      this.transactionModel.aggregate([
        {
          $match: {
            ...matchPeriod,
            type: TransactionType.REFUND,
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            tokens: { $sum: '$amount' },
          },
        },
      ]),
    ]);

    const s = summary[0] || {
      totalCount: 0,
      totalRevenueRub: 0,
      totalSubscriptionRub: 0,
      tokensDeposited: 0,
      tokensSpent: 0,
      pendingCount: 0,
      failedCount: 0,
    };

    return {
      period: { days: safeDays, since },
      summary: {
        totalCount: s.totalCount,
        depositsRub: s.totalRevenueRub,
        subscriptionsRub: s.totalSubscriptionRub,
        totalRevenueRub: s.totalRevenueRub + s.totalSubscriptionRub,
        tokensDeposited: s.tokensDeposited,
        tokensSpent: s.tokensSpent,
        pendingCount: s.pendingCount,
        failedCount: s.failedCount,
      },
      byType,
      byStatus,
      byProvider,
      revenueByDay,
      generationsByDay,
      topModels,
      topSpenders,
      promoStats,
      refunds: refundsStats[0] || { count: 0, tokens: 0 },
    };
  }
}