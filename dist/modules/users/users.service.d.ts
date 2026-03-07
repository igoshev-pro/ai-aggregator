import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { TelegramUser } from '@/common/interfaces';
export declare class UsersService {
    private userModel;
    constructor(userModel: Model<UserDocument>);
    findOrCreateByTelegram(telegramUser: TelegramUser, referralCode?: string): Promise<UserDocument>;
    findById(id: string): Promise<UserDocument>;
    findByTelegramId(telegramId: number): Promise<UserDocument>;
    deductTokens(userId: string, amount: number, _type: string): Promise<UserDocument>;
    addTokens(userId: string, amount: number): Promise<UserDocument>;
    addBonusTokens(userId: string, amount: number): Promise<UserDocument>;
    refundTokens(userId: string, amount: number): Promise<UserDocument>;
    updateSettings(userId: string, settings: any): Promise<UserDocument>;
    checkDailyLimit(userId: string, maxDaily: number): Promise<boolean>;
    incrementDailyGenerations(userId: string): Promise<void>;
    getLeaderboard(limit?: number): Promise<(import("mongoose").Document<unknown, {}, UserDocument, {}, {}> & User & import("mongoose").Document<import("mongoose").Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
        _id: import("mongoose").Types.ObjectId;
    }> & {
        __v: number;
    })[]>;
    getStats(): Promise<{
        totalUsers: number;
        activeToday: number;
        premiumUsers: number;
    }>;
    private generateReferralCode;
}
