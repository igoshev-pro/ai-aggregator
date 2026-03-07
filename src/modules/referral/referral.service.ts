// src/modules/referral/referral.service.ts
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Referral, ReferralDocument } from './schemas/referral.schema';
import { UsersService } from '../users/users.service';

@Injectable()
export class ReferralService {
  constructor(
    @InjectModel(Referral.name) private referralModel: Model<ReferralDocument>,
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
  ) {}

  async getReferralStats(userId: string) {
    const user = await this.usersService.findById(userId);

    const referrals = await this.referralModel
      .find({ referrerId: new Types.ObjectId(userId) })
      .populate('referredId', 'firstName username createdAt')
      .sort({ createdAt: -1 })
      .exec();

    return {
      referralCode: user.referralCode,
      referralLink: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=ref_${user.referralCode}`,
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

  async recordReferral(referrerId: string, referredId: string) {
    const existing = await this.referralModel.findOne({
      referredId: new Types.ObjectId(referredId),
    });
    if (existing) return;

    const referral = new this.referralModel({
      referrerId: new Types.ObjectId(referrerId),
      referredId: new Types.ObjectId(referredId),
    });
    await referral.save();
  }
}