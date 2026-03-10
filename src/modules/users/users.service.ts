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

  async findOrCreateByTelegram(telegramUser: TelegramUser, referralCode?: string): Promise<UserDocument> {
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

    // New user
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
      bonusTokens: 50,
      lastActiveAt: new Date(),
    });

    // Handle referral
    if (referralCode) {
      const referrer = await this.userModel.findOne({ referralCode });
      if (referrer) {
        user.referredBy = referrer._id;
        user.bonusTokens = 100;
        referrer.referralCount += 1;
        referrer.bonusTokens += 50;
        referrer.referralEarnings += 50;
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

  async deductTokens(userId: string, amount: number, _type: string): Promise<UserDocument> {
    const user = await this.findById(userId);

    const totalAvailable = user.tokenBalance + user.bonusTokens;
    if (totalAvailable < amount) {
      throw new BadRequestException(
        `Insufficient tokens. Required: ${amount}, Available: ${totalAvailable}`,
      );
    }

    if (user.bonusTokens >= amount) {
      user.bonusTokens -= amount;
    } else {
      const remainingFromBalance = amount - user.bonusTokens;
      user.bonusTokens = 0;
      user.tokenBalance -= remainingFromBalance;
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