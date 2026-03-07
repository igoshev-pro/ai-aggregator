import { Model, Types } from 'mongoose';
import { ReferralDocument } from './schemas/referral.schema';
import { UsersService } from '../users/users.service';
export declare class ReferralService {
    private referralModel;
    private usersService;
    constructor(referralModel: Model<ReferralDocument>, usersService: UsersService);
    getReferralStats(userId: string): Promise<{
        referralCode: string;
        referralLink: string;
        totalReferrals: number;
        totalEarnings: number;
        referrals: {
            user: Types.ObjectId;
            bonusEarned: number;
            hasPurchased: boolean;
            joinedAt: any;
        }[];
    }>;
    recordReferral(referrerId: string, referredId: string): Promise<void>;
}
