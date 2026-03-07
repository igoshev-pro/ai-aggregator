import { ReferralService } from './referral.service';
export declare class ReferralController {
    private readonly referralService;
    constructor(referralService: ReferralService);
    getStats(userId: string): Promise<{
        success: boolean;
        data: {
            referralCode: string;
            referralLink: string;
            totalReferrals: number;
            totalEarnings: number;
            referrals: {
                user: import("mongoose").Types.ObjectId;
                bonusEarned: number;
                hasPurchased: boolean;
                joinedAt: any;
            }[];
        };
    }>;
}
