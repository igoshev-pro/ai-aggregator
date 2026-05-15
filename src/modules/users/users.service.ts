import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { TelegramUser, AuthProvider } from '@/common/interfaces';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  /**
   * Найти или создать пользователя по Telegram ID.
   * При создании с реферальным кодом:
   *  - приглашённый получает 9 🔥 в bonusTokens
   *  - пригласивший получает 10 🔥 в bonusTokens
   *  - создаётся запись в коллекции Referral (через ReferralService.recordReferral,
   *    вызывается из AuthService после успешного создания)
   *
   * ВАЖНО: запись в Referral создаёт ReferralService, чтобы не было циклических импортов.
   * Этот метод только проставляет referredBy и возвращает признак "это новый реферал".
   */
  async findOrCreateByTelegram(
    telegramUser: TelegramUser,
    referralCode?: string,
  ): Promise<UserDocument> {
    let user = await this.userModel.findOne({ telegramId: telegramUser.id });

    if (user) {
      user.firstName = telegramUser.first_name;
      user.lastName = telegramUser.last_name || '';
      user.username = telegramUser.username || '';
      user.photoUrl = telegramUser.photo_url || '';
      user.isPremiumTelegram = telegramUser.is_premium || false;
      user.lastActiveAt = new Date();
      await user.save();
      return user;
    }

    // Новый пользователь — стартовый бонус 9 спичек
    user = new this.userModel({
      authProvider: AuthProvider.TELEGRAM,
      telegramId: telegramUser.id,
      firstName: telegramUser.first_name,
      lastName: telegramUser.last_name || '',
      username: telegramUser.username || '',
      photoUrl: telegramUser.photo_url || '',
      languageCode: telegramUser.language_code || 'en',
      isPremiumTelegram: telegramUser.is_premium || false,
      referralCode: this.generateReferralCode(),
      tokenBalance: 0,
      bonusTokens: 9, // ← стартовый бонус для всех новых юзеров
      lastActiveAt: new Date(),
    });

    // Обработка реферального кода
    if (referralCode) {
      const referrer = await this.userModel.findOne({
        referralCode: referralCode.toUpperCase(),
      });

      // Защита от self-referral
      if (referrer && referrer.telegramId !== telegramUser.id) {
        user.referredBy = referrer._id;

        // Пригласившему +10 🔥
        referrer.referralCount += 1;
        referrer.bonusTokens += 10;
        referrer.referralEarnings += 10;
        await referrer.save();
      }
    }

    await user.save();
    return user;
  }

  async findById(id: string): Promise<UserDocument> {
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByTelegramId(telegramId: number): Promise<UserDocument> {
    const user = await this.userModel.findOne({ telegramId });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email }).select('+passwordHash');
  }

  /**
   * Списание спичек.
   * Приоритет списания (от дешёвых к дорогим для юзера):
   *   1) bonusTokens (промо, не выводятся)
   *   2) cashbackBalance (можно вывести деньгами)
   *   3) tokenBalance (купленные)
   *
   * Логика: сначала тратим то что нельзя вывести. Так юзер не теряет «живые» деньги
   * на дешёвых генерациях, и сохраняет возможность вывода.
   */
  async deductTokens(userId: string, amount: number, _type: string): Promise<UserDocument> {
    const user = await this.findById(userId);

    const totalAvailable = user.tokenBalance + user.bonusTokens + user.cashbackBalance;
    if (totalAvailable < amount) {
      throw new BadRequestException(
        `Insufficient tokens. Required: ${amount}, Available: ${totalAvailable}`,
      );
    }

    let remaining = amount;

    // 1. Bonus tokens (промо)
    if (user.bonusTokens > 0) {
      const fromBonus = Math.min(user.bonusTokens, remaining);
      user.bonusTokens -= fromBonus;
      remaining -= fromBonus;
    }

    // 2. Cashback (можно вывести, но и тратить тоже можно)
    if (remaining > 0 && user.cashbackBalance > 0) {
      const fromCashback = Math.min(user.cashbackBalance, remaining);
      user.cashbackBalance -= fromCashback;
      remaining -= fromCashback;
    }

    // 3. Token balance (купленные)
    if (remaining > 0) {
      user.tokenBalance -= remaining;
    }

    user.totalTokensSpent += amount;
    await user.save();
    return user;
  }

  async addTokens(userId: string, amount: number): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      {
        $inc: { tokenBalance: amount, totalDeposited: amount },
        $set: { lastActiveAt: new Date() },
      },
      { new: true },
    );
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async addBonusTokens(userId: string, amount: number): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $inc: { bonusTokens: amount } },
      { new: true },
    );
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * Начислить кэшбек (10% от покупок рефералов).
   * Идёт в отдельный баланс cashbackBalance — можно вывести реальными деньгами
   * или потратить на генерации.
   */
  async addCashback(userId: string, amount: number): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      {
        $inc: {
          cashbackBalance: amount,
          cashbackEarnedTotal: amount,
          referralEarnings: amount,
        },
      },
      { new: true },
    );
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * Зарезервировать сумму кэшбека под заявку на вывод.
   * Возвращает обновлённого пользователя или бросает ошибку если средств недостаточно.
   */
  async reserveCashbackForWithdrawal(userId: string, amount: number): Promise<UserDocument> {
    const user = await this.findById(userId);
    if (user.cashbackBalance < amount) {
      throw new BadRequestException(
        `Insufficient cashback balance. Required: ${amount}, Available: ${user.cashbackBalance}`,
      );
    }
    user.cashbackBalance -= amount;
    await user.save();
    return user;
  }

  /**
   * Вернуть зарезервированный кэшбек (если админ отклонил заявку).
   */
  async refundCashback(userId: string, amount: number): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $inc: { cashbackBalance: amount } },
      { new: true },
    );
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async refundTokens(userId: string, amount: number): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $inc: { tokenBalance: amount, totalTokensSpent: -amount } },
      { new: true },
    );
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateSettings(userId: string, settings: any): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $set: { settings } },
      { new: true },
    );
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async checkDailyLimit(userId: string, maxDaily: number): Promise<boolean> {
    const user = await this.findById(userId);
    const now = new Date();

    if (!user.dailyGenerationsResetAt || user.dailyGenerationsResetAt < now) {
      user.dailyGenerations = 0;
      user.dailyGenerationsResetAt = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      await user.save();
    }

    return user.dailyGenerations < maxDaily;
  }

  async incrementDailyGenerations(userId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      $inc: { dailyGenerations: 1 },
    });
  }

  async getLeaderboard(limit = 10) {
    return this.userModel
      .find({ isActive: true })
      .sort({ referralCount: -1 })
      .limit(limit)
      .select('firstName username referralCount referralEarnings');
  }

  async getStats() {
    const [totalUsers, activeToday, premiumUsers] = await Promise.all([
      this.userModel.countDocuments(),
      this.userModel.countDocuments({
        lastActiveAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      }),
      this.userModel.countDocuments({
        subscriptionPlan: { $ne: 'free' },
      }),
    ]);
    return { totalUsers, activeToday, premiumUsers };
  }

  private generateReferralCode(): string {
    return uuidv4().substring(0, 8).toUpperCase();
  }
}