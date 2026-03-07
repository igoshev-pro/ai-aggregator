import { Document, Types } from 'mongoose';
import { UserRole, SubscriptionPlan } from '@/common/interfaces';
export type UserDocument = User & Document;
export declare class User {
    telegramId: number;
    firstName: string;
    lastName: string;
    username: string;
    photoUrl: string;
    languageCode: string;
    isPremiumTelegram: boolean;
    tokenBalance: number;
    bonusTokens: number;
    totalTokensSpent: number;
    totalDeposited: number;
    role: UserRole;
    subscriptionPlan: SubscriptionPlan;
    subscriptionExpiresAt: Date | null;
    referralCode: string;
    referredBy: Types.ObjectId | null;
    referralCount: number;
    referralEarnings: number;
    dailyGenerations: number;
    dailyGenerationsResetAt: Date | null;
    isActive: boolean;
    isBanned: boolean;
    banReason: string;
    lastActiveAt: Date | null;
    settings: {
        defaultTextModel?: string;
        defaultImageModel?: string;
        defaultVideoModel?: string;
        theme?: string;
        language?: string;
        notifications?: boolean;
    };
}
export declare const UserSchema: import("mongoose").Schema<User, import("mongoose").Model<User, any, any, any, Document<unknown, any, User, any, {}> & User & {
    _id: Types.ObjectId;
} & {
    __v: number;
}, any>, {}, {}, {}, {}, import("mongoose").DefaultSchemaOptions, User, Document<unknown, {}, import("mongoose").FlatRecord<User>, {}, import("mongoose").DefaultSchemaOptions> & import("mongoose").FlatRecord<User> & {
    _id: Types.ObjectId;
} & {
    __v: number;
}>;
