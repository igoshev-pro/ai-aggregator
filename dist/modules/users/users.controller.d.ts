import { UsersService } from './users.service';
export declare class UsersController {
    private readonly usersService;
    constructor(usersService: UsersService);
    getProfile(userId: string): Promise<{
        success: boolean;
        data: {
            id: import("mongoose").Types.ObjectId;
            telegramId: number;
            firstName: string;
            lastName: string;
            username: string;
            photoUrl: string;
            tokenBalance: number;
            bonusTokens: number;
            totalAvailable: number;
            totalTokensSpent: number;
            subscriptionPlan: import("../../common/interfaces").SubscriptionPlan;
            subscriptionExpiresAt: Date | null;
            referralCode: string;
            referralCount: number;
            referralEarnings: number;
            settings: {
                defaultTextModel?: string;
                defaultImageModel?: string;
                defaultVideoModel?: string;
                theme?: string;
                language?: string;
                notifications?: boolean;
            };
            role: import("../../common/interfaces").UserRole;
        };
    }>;
    updateSettings(userId: string, settings: any): Promise<{
        success: boolean;
        data: {
            defaultTextModel?: string;
            defaultImageModel?: string;
            defaultVideoModel?: string;
            theme?: string;
            language?: string;
            notifications?: boolean;
        };
    }>;
}
