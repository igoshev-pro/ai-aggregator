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

const MIN_WITHDRAWAL_AMOUNT = 100; // минимум 100 спичек = 100₽

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  // Кэш username бота, чтобы не дёргать Telegram API на каждый запрос
  private cachedBotUsername: string | null = null;

  constructor(
    @InjectModel(Referral.name) private referralModel: Model<ReferralDocument>,
    @InjectModel(Withdrawal.name)
    private withdrawalModel: Model<WithdrawalDocument>,
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
  ) {}

  // ─── Резолв имени бота ───────────────────────────────────────

    /**
   * Получить username бота:
   * 1. Из env (TG_BOT_USERNAME / TELEGRAM_BOT_USERNAME / BOT_USERNAME).
   * 2. Если в env пусто — спрашиваем у Telegram через getMe.
   * 3. Кэшируем результат.
   */
  private async resolveBotUsername(): Promise<string> {
    if (this.cachedBotUsername) return this.cachedBotUsername;

    // 1. Из env
    const fromEnv =
      process.env.TG_BOT_USERNAME ||
      process.env.TELEGRAM_BOT_USERNAME ||
      process.env.BOT_USERNAME;

    if (fromEnv && fromEnv.trim().length > 0) {
      const username = fromEnv.replace(/^@/, '').trim();
      this.cachedBotUsername = username;
      this.logger.log(`🤖 Bot username from env: @${username}`);
      return username;
    }

    // 2. Через Telegram API getMe
    const token =
      process.env.TG_BOT_TOKEN ||
      process.env.TELEGRAM_BOT_TOKEN ||
      process.env.BOT_TOKEN;

    if (token) {
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${token}/getMe`,
        );
        const json: any = await res.json();
        if (json?.ok && json?.result?.username) {
          const username: string = json.result.username;
          this.cachedBotUsername = username;
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

  // ─── Старый формат (для обратной совместимости) ──────────────

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
      referralLink: `https://t.me/${botUsername}?start=ref_${user.referralCode}`,
      totalReferrals: user.referralCount,
      totalEarnings: user.referralEarnings,
      referrals: referrals.map((r) => ({
        user: r.referredId,
        bonusEarned: r.bonusEarned,
        hasPurchased: r.hasPurchased,
        joinedAt: r['createdAt'],
      })),
    };
  }

  // ─── Новый формат — для фронта ReferralPage ──────────────────

  async getReferralInfo(userId: string) {
    const user = await this.usersService.findById(userId);
    const botUsername = await this.resolveBotUsername();

    const referrals = await this.referralModel
      .find({ referrerId: new Types.ObjectId(userId) })
      .populate('referredId', 'firstName username photoUrl createdAt')
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();

    const activeReferrals = referrals.filter((r) => r.hasPurchased).length;
    const totalEarned = user.referralEarnings || 0;

    return {
      referralCode: user.referralCode,
      referralLink: `https://t.me/${botUsername}?start=ref_${user.referralCode}`,
      botUsername,

      // Статистика
      referralCount: user.referralCount,
      activeReferrals,
      totalEarned,

      // Кэшбек (доступно к выводу)
      cashbackBalance: user.cashbackBalance || 0,
      cashbackEarnedTotal: user.cashbackEarnedTotal || 0,

      // Лимиты вывода
      minWithdrawal: MIN_WITHDRAWAL_AMOUNT,

      // Список приглашённых
      referrals: referrals.map((r) => {
        const ref: any = r.referredId;
        return {
          id: ref?._id?.toString() || '',
          firstName: ref?.firstName || 'User',
          username: ref?.username || null,
          photoUrl: ref?.photoUrl || null,
          joinedAt: r['createdAt'] || new Date(),
          earned: r.bonusEarned || 0,
          hasPurchased: r.hasPurchased || false,
        };
      }),
    };
  }

  // ─── Запись о реферальной связи ──────────────────────────────

  /**
   * Создаёт запись в коллекции Referral.
   * Вызывается после успешной регистрации нового юзера с referralCode.
   * Идемпотентно: повторный вызов не создаст дубликат.
   */
  async recordReferral(referrerId: string, referredId: string): Promise<void> {
    const existing = await this.referralModel.findOne({
      referredId: new Types.ObjectId(referredId),
    });
    if (existing) {
      this.logger.warn(`Referral already exists for referredId=${referredId}`);
      return;
    }

    const referral = new this.referralModel({
      referrerId: new Types.ObjectId(referrerId),
      referredId: new Types.ObjectId(referredId),
      bonusEarned: 10, // мгновенный бонус за приглашение
      hasPurchased: false,
    });
    await referral.save();

    this.logger.log(
      `✅ Referral recorded: referrer=${referrerId} → referred=${referredId}`,
    );
  }

  /**
   * Отметить что реферал сделал покупку (вызывается из billing.service).
   * Также инкрементит bonusEarned на сумму кэшбека.
   */
  async markReferralPurchase(
    referredUserId: string,
    cashbackAmount: number,
  ): Promise<void> {
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
      $inc: { bonusEarned: cashbackAmount },
    };

    if (!referral.hasPurchased) {
      update.$set = {
        hasPurchased: true,
        firstPurchaseAt: new Date(),
      };
    }

    await this.referralModel.updateOne({ _id: referral._id }, update);
  }

  // ─── Вывод средств ───────────────────────────────────────────

  async createWithdrawal(
    userId: string,
    amount: number,
    method: WithdrawalMethod,
    requisites: string,
  ) {
    if (!amount || amount < MIN_WITHDRAWAL_AMOUNT) {
      throw new BadRequestException(
        `Минимальная сумма вывода: ${MIN_WITHDRAWAL_AMOUNT} спичек`,
      );
    }

    if (!Object.values(WithdrawalMethod).includes(method)) {
      throw new BadRequestException('Неверный способ вывода');
    }

    const cleanRequisites = (requisites || '').trim();
    if (cleanRequisites.length < 4) {
      throw new BadRequestException('Укажите корректные реквизиты');
    }

    // Проверка на активные заявки (нельзя создавать новую, пока есть в обработке)
    const pendingExists = await this.withdrawalModel.findOne({
      userId: new Types.ObjectId(userId),
      status: { $in: [WithdrawalStatus.PENDING, WithdrawalStatus.APPROVED] },
    });
    if (pendingExists) {
      throw new BadRequestException(
        'У вас уже есть активная заявка на вывод. Дождитесь её обработки.',
      );
    }

    // Резервируем сумму (атомарно)
    await this.usersService.reserveCashbackForWithdrawal(userId, amount);

    const withdrawal = new this.withdrawalModel({
      userId: new Types.ObjectId(userId),
      amount,
      amountRub: amount, // 1 спичка = 1₽
      method,
      requisites: cleanRequisites,
      status: WithdrawalStatus.PENDING,
    });
    await withdrawal.save();

    this.logger.log(
      `💸 Withdrawal created: user=${userId} amount=${amount} method=${method}`,
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

  async getWithdrawals(userId: string) {
    const items = await this.withdrawalModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();

    return items.map((w) => ({
      id: w._id.toString(),
      amount: w.amount,
      amountRub: w.amountRub,
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

  // ─── Админ-методы ────────────────────────────────────────────

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

    this.logger.log(`✅ Withdrawal ${w._id} marked as paid by admin ${adminId}`);
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

    // Возвращаем зарезервированную сумму
    await this.usersService.refundCashback(w.userId.toString(), w.amount);

    w.status = WithdrawalStatus.REJECTED;
    w.adminNote = adminNote;
    w.processedBy = new Types.ObjectId(adminId);
    w.processedAt = new Date();
    await w.save();

    this.logger.log(
      `❌ Withdrawal ${w._id} rejected, ${w.amount} cashback returned to user ${w.userId}`,
    );
    return w;
  }

  async adminGetAllWithdrawals(status?: WithdrawalStatus, page = 1, limit = 30) {
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
}