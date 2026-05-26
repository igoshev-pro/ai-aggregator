// src/modules/referral/referral.service.ts
import {
  Injectable,
  Inject,
  forwardRef,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Referral, ReferralDocument } from './schemas/referral.schema';
import {
  Withdrawal,
  WithdrawalDocument,
  WithdrawalStatus,
  WithdrawalMethod,
} from './schemas/withdrawal.schema';
import { UsersService } from '../users/users.service';

// ─── Константы ──────────────────────────────────────────────────
const MIN_WITHDRAWAL_AMOUNT = 100;          // 100 спичек = 100₽
const MAX_WITHDRAWAL_AMOUNT = 100_000;      // защита от ошибок ввода
const REFERRAL_SIGNUP_BONUS = 10;           // бонус за регистрацию реферала
const CASHBACK_PRECISION = 2;               // округление до 0.01

function roundCashback(value: number): number {
  const factor = Math.pow(10, CASHBACK_PRECISION);
  return Math.round(value * factor) / factor;
}

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  // Кэш username бота
  private cachedBotUsername: string | null = null;
  private cachedBotUsernameAt = 0;
  private readonly BOT_USERNAME_CACHE_TTL_MS = 60 * 60 * 1000; // 1 час

  constructor(
    @InjectModel(Referral.name) private referralModel: Model<ReferralDocument>,
    @InjectModel(Withdrawal.name)
    private withdrawalModel: Model<WithdrawalDocument>,
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // Резолв username бота
  // ═══════════════════════════════════════════════════════════════

  /**
   * Получить username бота:
   * 1. Из env (TG_BOT_USERNAME / TELEGRAM_BOT_USERNAME / BOT_USERNAME).
   * 2. Если в env пусто — спрашиваем у Telegram через getMe.
   * 3. Кэшируем результат на 1 час.
   */
  private async resolveBotUsername(): Promise<string> {
    const now = Date.now();
    if (
      this.cachedBotUsername &&
      now - this.cachedBotUsernameAt < this.BOT_USERNAME_CACHE_TTL_MS
    ) {
      return this.cachedBotUsername;
    }

    // 1. Из env
    const fromEnv =
      process.env.TG_BOT_USERNAME ||
      process.env.TELEGRAM_BOT_USERNAME ||
      process.env.BOT_USERNAME;

    if (fromEnv && fromEnv.trim().length > 0) {
      const username = fromEnv.replace(/^@/, '').trim();
      this.cachedBotUsername = username;
      this.cachedBotUsernameAt = now;
      this.logger.log(`🤖 Bot username from env: @${username}`);
      return username;
    }

    // 2. Через Telegram API getMe (с таймаутом)
    const token =
      process.env.TG_BOT_TOKEN ||
      process.env.TELEGRAM_BOT_TOKEN ||
      process.env.BOT_TOKEN;

    if (token) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(
          `https://api.telegram.org/bot${token}/getMe`,
          { signal: controller.signal },
        );
        clearTimeout(timeoutId);

        const json: any = await res.json();
        if (json?.ok && json?.result?.username) {
          const username: string = json.result.username;
          this.cachedBotUsername = username;
          this.cachedBotUsernameAt = now;
          this.logger.log(`🤖 Bot username from Telegram API: @${username}`);
          return username;
        }
        this.logger.error(`getMe failed: ${JSON.stringify(json)}`);
      } catch (e: any) {
        this.logger.error(`getMe error: ${e?.message || e}`);
      }
    }

    // 3. Фолбэк
    this.logger.warn(
      '⚠️ Bot username NOT configured! Set TG_BOT_USERNAME or TG_BOT_TOKEN in .env',
    );
    return 'UNKNOWN_BOT';
  }

  /** Сбросить кэш (на случай смены бота). */
  invalidateBotUsernameCache() {
    this.cachedBotUsername = null;
    this.cachedBotUsernameAt = 0;
  }

  private buildReferralLink(botUsername: string, referralCode: string): string {
    return `https://t.me/${botUsername}?start=ref_${referralCode}`;
  }

  // ═══════════════════════════════════════════════════════════════
  // Старый формат (для обратной совместимости)
  // ═══════════════════════════════════════════════════════════════

  async getReferralStats(userId: string) {
    const user = await this.usersService.findById(userId);
    const botUsername = await this.resolveBotUsername();

    const referrals = await this.referralModel
      .find({ referrerId: new Types.ObjectId(userId) })
      .populate('referredId', 'firstName username createdAt')
      .sort({ createdAt: -1 })
      .exec();

    return {
      referralCode: user.referralCode,
      referralLink: this.buildReferralLink(botUsername, user.referralCode),
      totalReferrals: user.referralCount,
      totalEarnings: roundCashback(user.referralEarnings || 0),
      referrals: referrals.map((r) => ({
        user: r.referredId,
        bonusEarned: roundCashback(r.bonusEarned || 0),
        hasPurchased: r.hasPurchased,
        joinedAt: r['createdAt'],
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Новый формат — для фронта ReferralPage
  // ═══════════════════════════════════════════════════════════════

  async getReferralInfo(userId: string) {
    const user = await this.usersService.findById(userId);
    const botUsername = await this.resolveBotUsername();

    const [referrals, pendingWithdrawalsAgg] = await Promise.all([
      this.referralModel
        .find({ referrerId: new Types.ObjectId(userId) })
        .populate('referredId', 'firstName username photoUrl createdAt')
        .sort({ createdAt: -1 })
        .limit(50)
        .exec(),
      this.withdrawalModel.aggregate([
        {
          $match: {
            userId: new Types.ObjectId(userId),
            status: { $in: [WithdrawalStatus.PENDING, WithdrawalStatus.APPROVED] },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    const activeReferrals = referrals.filter((r) => r.hasPurchased).length;
    const totalEarned = roundCashback(user.referralEarnings || 0);
    const cashbackBalance = roundCashback(user.cashbackBalance || 0);
    const cashbackEarnedTotal = roundCashback(user.cashbackEarnedTotal || 0);
    const pendingWithdrawal = roundCashback(
      pendingWithdrawalsAgg[0]?.total || 0,
    );

    return {
      referralCode: user.referralCode,
      referralLink: this.buildReferralLink(botUsername, user.referralCode),
      botUsername,

      // Статистика
      referralCount: user.referralCount,
      activeReferrals,
      totalEarned,

      // Кэшбек
      cashbackBalance,
      cashbackEarnedTotal,
      pendingWithdrawal,             // 🆕 сумма в заявках на выводе
      availableForWithdrawal: cashbackBalance, // алиас для удобства фронта

      // Лимиты вывода
      minWithdrawal: MIN_WITHDRAWAL_AMOUNT,
      maxWithdrawal: MAX_WITHDRAWAL_AMOUNT,

      // Список приглашённых
      referrals: referrals.map((r) => {
        const ref: any = r.referredId;
        return {
          id: ref?._id?.toString() || '',
          firstName: ref?.firstName || 'User',
          username: ref?.username || null,
          photoUrl: ref?.photoUrl || null,
          joinedAt: r['createdAt'] || new Date(),
          earned: roundCashback(r.bonusEarned || 0),
          hasPurchased: r.hasPurchased || false,
        };
      }),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Запись о реферальной связи
  // ═══════════════════════════════════════════════════════════════

  /**
   * Создаёт запись в коллекции Referral.
   * Идемпотентно: повторный вызов не создаст дубликат.
   */
  async recordReferral(referrerId: string, referredId: string): Promise<void> {
    // Защита от само-реферала
    if (referrerId === referredId) {
      this.logger.warn(
        `recordReferral: self-referral blocked for user=${referredId}`,
      );
      return;
    }

    const existing = await this.referralModel.findOne({
      referredId: new Types.ObjectId(referredId),
    });
    if (existing) {
      this.logger.warn(
        `Referral already exists for referredId=${referredId} (skip)`,
      );
      return;
    }

    try {
      const referral = new this.referralModel({
        referrerId: new Types.ObjectId(referrerId),
        referredId: new Types.ObjectId(referredId),
        bonusEarned: REFERRAL_SIGNUP_BONUS,
        hasPurchased: false,
      });
      await referral.save();

      this.logger.log(
        `✅ Referral recorded: referrer=${referrerId} → referred=${referredId}`,
      );
    } catch (err: any) {
      // На случай гонки: если unique-индекс по referredId упал — игнорим
      if (err?.code === 11000) {
        this.logger.warn(
          `Referral race condition for referredId=${referredId} — already exists`,
        );
        return;
      }
      throw err;
    }
  }

  /**
   * Отметить что реферал сделал покупку (вызывается из billing.service).
   * Инкрементит bonusEarned на сумму кэшбека.
   */
  async markReferralPurchase(
    referredUserId: string,
    cashbackAmount: number,
  ): Promise<void> {
    if (!cashbackAmount || cashbackAmount <= 0) return;

    const rounded = roundCashback(cashbackAmount);

    const referral = await this.referralModel.findOne({
      referredId: new Types.ObjectId(referredUserId),
    });

    if (!referral) {
      this.logger.warn(
        `markReferralPurchase: no referral record for user ${referredUserId}`,
      );
      return;
    }

    const update: any = {
      $inc: { bonusEarned: rounded },
    };

    if (!referral.hasPurchased) {
      update.$set = {
        hasPurchased: true,
        firstPurchaseAt: new Date(),
      };
    }

    await this.referralModel.updateOne({ _id: referral._id }, update);
  }

  // ═══════════════════════════════════════════════════════════════
  // Вывод средств
  // ═══════════════════════════════════════════════════════════════

  async createWithdrawal(
    userId: string,
    amount: number,
    method: WithdrawalMethod,
    requisites: string,
  ) {
    // 1. Валидация суммы
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      throw new BadRequestException('Некорректная сумма');
    }
    const cleanAmount = roundCashback(amount);

    if (cleanAmount < MIN_WITHDRAWAL_AMOUNT) {
      throw new BadRequestException(
        `Минимальная сумма вывода: ${MIN_WITHDRAWAL_AMOUNT} спичек`,
      );
    }
    if (cleanAmount > MAX_WITHDRAWAL_AMOUNT) {
      throw new BadRequestException(
        `Максимальная сумма вывода: ${MAX_WITHDRAWAL_AMOUNT} спичек`,
      );
    }

    // 2. Валидация метода
    if (!Object.values(WithdrawalMethod).includes(method)) {
      throw new BadRequestException('Неверный способ вывода');
    }

    // 3. Валидация реквизитов
    const cleanRequisites = (requisites || '').trim();
    if (cleanRequisites.length < 4) {
      throw new BadRequestException('Укажите корректные реквизиты');
    }
    this.validateRequisitesByMethod(method, cleanRequisites);

    // 4. Проверка на активные заявки
    const pendingExists = await this.withdrawalModel.findOne({
      userId: new Types.ObjectId(userId),
      status: { $in: [WithdrawalStatus.PENDING, WithdrawalStatus.APPROVED] },
    });
    if (pendingExists) {
      throw new BadRequestException(
        'У вас уже есть активная заявка на вывод. Дождитесь её обработки.',
      );
    }

    // 5. Резервируем сумму (атомарно)
    await this.usersService.reserveCashbackForWithdrawal(userId, cleanAmount);

    // 6. Создаём заявку. Если запись упала — возвращаем кэшбек обратно.
    let withdrawal: WithdrawalDocument;
    try {
      withdrawal = new this.withdrawalModel({
        userId: new Types.ObjectId(userId),
        amount: cleanAmount,
        amountRub: cleanAmount, // 1 спичка = 1₽
        method,
        requisites: cleanRequisites,
        status: WithdrawalStatus.PENDING,
      });
      await withdrawal.save();
    } catch (err: any) {
      this.logger.error(
        `Withdrawal save failed for user ${userId}: ${err?.message}. Refunding cashback.`,
      );
      try {
        await this.usersService.refundCashback(userId, cleanAmount);
      } catch (refundErr: any) {
        this.logger.error(
          `CRITICAL: failed to refund reserved cashback ${cleanAmount} for user ${userId}: ${refundErr?.message}`,
        );
      }
      throw new BadRequestException('Не удалось создать заявку. Попробуйте позже.');
    }

    this.logger.log(
      `💸 Withdrawal created: user=${userId} amount=${cleanAmount} method=${method}`,
    );

    return {
      id: withdrawal._id.toString(),
      amount: withdrawal.amount,
      amountRub: withdrawal.amountRub,
      method: withdrawal.method,
      status: withdrawal.status,
      createdAt: withdrawal['createdAt'],
    };
  }

  /**
   * Минимальная валидация реквизитов по методу вывода.
   * Можно расширить под бизнес-правила.
   */
  private validateRequisitesByMethod(
    method: WithdrawalMethod,
    req: string,
  ): void {
    const digitsOnly = req.replace(/\s|-/g, '');

    if (method === WithdrawalMethod.CARD) {
      if (!/^\d{16,19}$/.test(digitsOnly)) {
        throw new BadRequestException(
          'Номер карты должен содержать 16–19 цифр',
        );
      }
      return;
    }

    if (method === WithdrawalMethod.SBP) {
      // Российский номер: +7 / 8 + 10 цифр, итого 11
      if (!/^(\+?7|8)\d{10}$/.test(digitsOnly)) {
        throw new BadRequestException(
          'Укажите телефон в формате +7XXXXXXXXXX',
        );
      }
      return;
    }

    // Для прочих методов — общая длина
    if (req.length < 4) {
      throw new BadRequestException('Реквизиты слишком короткие');
    }
  }

  async getWithdrawals(userId: string) {
    const items = await this.withdrawalModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();

    return items.map((w) => ({
      id: w._id.toString(),
      amount: roundCashback(w.amount),
      amountRub: roundCashback(w.amountRub),
      method: w.method,
      requisites: this.maskRequisites(w.requisites, w.method),
      status: w.status,
      adminNote: w.adminNote || '',
      createdAt: w['createdAt'],
      processedAt: w.processedAt || null,
    }));
  }

  /**
   * Маскируем реквизиты в выдаче (показываем только последние 4 символа).
   */
  private maskRequisites(req: string, method: WithdrawalMethod): string {
    if (!req) return '';
    if (req.length <= 4) return req;
    const last = req.slice(-4);

    if (method === WithdrawalMethod.CARD) {
      return `**** **** **** ${last}`;
    }
    if (method === WithdrawalMethod.SBP) {
      return `*** *** ${last}`;
    }
    return `...${last}`;
  }

  // ═══════════════════════════════════════════════════════════════
  // Админ-методы
  // ═══════════════════════════════════════════════════════════════

  async adminApproveWithdrawal(
    withdrawalId: string,
    adminId: string,
    adminNote = '',
  ) {
    const w = await this.withdrawalModel.findById(withdrawalId);
    if (!w) throw new NotFoundException('Withdrawal not found');
    if (w.status !== WithdrawalStatus.PENDING) {
      throw new BadRequestException(
        `Cannot approve withdrawal in status: ${w.status}`,
      );
    }

    w.status = WithdrawalStatus.APPROVED;
    w.adminNote = adminNote;
    w.processedBy = new Types.ObjectId(adminId);
    w.processedAt = new Date();
    await w.save();

    this.logger.log(
      `✅ Withdrawal ${w._id} approved by admin ${adminId}`,
    );
    return w;
  }

  async adminMarkPaid(
    withdrawalId: string,
    adminId: string,
    adminNote = '',
  ) {
    const w = await this.withdrawalModel.findById(withdrawalId);
    if (!w) throw new NotFoundException('Withdrawal not found');
    if (
      w.status !== WithdrawalStatus.APPROVED &&
      w.status !== WithdrawalStatus.PENDING
    ) {
      throw new BadRequestException(
        `Cannot mark paid withdrawal in status: ${w.status}`,
      );
    }

    w.status = WithdrawalStatus.PAID;
    w.adminNote = adminNote || w.adminNote;
    w.processedBy = new Types.ObjectId(adminId);
    w.processedAt = new Date();
    await w.save();

    this.logger.log(
      `✅ Withdrawal ${w._id} marked as PAID by admin ${adminId} (${w.amount}🔥 → user ${w.userId})`,
    );
    return w;
  }

  async adminRejectWithdrawal(
    withdrawalId: string,
    adminId: string,
    adminNote = 'Отклонено администратором',
  ) {
    const w = await this.withdrawalModel.findById(withdrawalId);
    if (!w) throw new NotFoundException('Withdrawal not found');
    if (
      w.status !== WithdrawalStatus.PENDING &&
      w.status !== WithdrawalStatus.APPROVED
    ) {
      throw new BadRequestException(
        `Cannot reject withdrawal in status: ${w.status}`,
      );
    }

    // 🆕 Сначала меняем статус (чтобы не вернуть деньги дважды при гонке),
    // потом возвращаем кэшбек. Если возврат упал — логируем CRITICAL.
    w.status = WithdrawalStatus.REJECTED;
    w.adminNote = adminNote;
    w.processedBy = new Types.ObjectId(adminId);
    w.processedAt = new Date();
    await w.save();

    try {
      await this.usersService.refundCashback(w.userId.toString(), w.amount);
      this.logger.log(
        `❌ Withdrawal ${w._id} rejected, ${w.amount}🔥 cashback returned to user ${w.userId}`,
      );
    } catch (err: any) {
      this.logger.error(
        `CRITICAL: withdrawal ${w._id} rejected but refund FAILED for user ${w.userId} (${w.amount}🔥). Error: ${err?.message}`,
      );
      // Помечаем в adminNote для ручной обработки
      w.adminNote = `${w.adminNote} | ⚠️ REFUND FAILED — manual return required`;
      await w.save();
    }

    return w;
  }

  async adminGetAllWithdrawals(
    status?: WithdrawalStatus,
    page = 1,
    limit = 30,
  ) {
    const filter: any = {};
    if (status) filter.status = status;

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.withdrawalModel
        .find(filter)
        .populate('userId', 'firstName username telegramId email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.withdrawalModel.countDocuments(filter),
    ]);

    return {
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

    // ═══════════════════════════════════════════════════════════════
  // 🆕 Админ: сводная статистика выводов
  // ═══════════════════════════════════════════════════════════════

  async adminGetWithdrawalSummary() {
    const agg = await this.withdrawalModel.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
        },
      },
    ]);

    const summary: Record<string, { count: number; totalAmount: number }> = {
      pending: { count: 0, totalAmount: 0 },
      approved: { count: 0, totalAmount: 0 },
      paid: { count: 0, totalAmount: 0 },
      rejected: { count: 0, totalAmount: 0 },
    };

    for (const row of agg) {
      summary[row._id] = {
        count: row.count,
        totalAmount: roundCashback(row.totalAmount || 0),
      };
    }

    const totalAll = Object.values(summary).reduce(
      (acc, v) => acc + v.totalAmount,
      0,
    );
    const countAll = Object.values(summary).reduce(
      (acc, v) => acc + v.count,
      0,
    );

    return {
      summary,
      totals: {
        count: countAll,
        totalAmount: roundCashback(totalAll),
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 🆕 Админ: топ рефереров
  // ═══════════════════════════════════════════════════════════════

  async adminGetTopReferrers(limit = 20) {
    const agg = await this.referralModel.aggregate([
      {
        $group: {
          _id: '$referrerId',
          totalReferrals: { $sum: 1 },
          activeReferrals: {
            $sum: { $cond: ['$hasPurchased', 1, 0] },
          },
          totalEarned: { $sum: '$bonusEarned' },
        },
      },
      { $sort: { totalEarned: -1 } },
      { $limit: limit },
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
          firstName: '$user.firstName',
          username: '$user.username',
          telegramId: '$user.telegramId',
          totalReferrals: 1,
          activeReferrals: 1,
          totalEarned: 1,
        },
      },
    ]);

    return agg.map((row) => ({
      userId: row.userId?.toString() || '',
      firstName: row.firstName || 'User',
      username: row.username || null,
      telegramId: row.telegramId || null,
      totalReferrals: row.totalReferrals || 0,
      activeReferrals: row.activeReferrals || 0,
      totalEarned: roundCashback(row.totalEarned || 0),
      conversionRate:
        row.totalReferrals > 0
          ? Math.round((row.activeReferrals / row.totalReferrals) * 100)
          : 0,
    }));
  }
}