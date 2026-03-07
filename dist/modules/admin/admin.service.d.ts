import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { BillingService } from '../billing/billing.service';
import { GenerationDocument } from '../generation/schemas/generation.schema';
import { TransactionDocument } from '../billing/schemas/transaction.schema';
import { UserRole } from '@/common/interfaces';
export declare class AdminService {
    private userModel;
    private generationModel;
    private transactionModel;
    private usersService;
    private aiProvidersService;
    private billingService;
    private readonly logger;
    constructor(userModel: Model<UserDocument>, generationModel: Model<GenerationDocument>, transactionModel: Model<TransactionDocument>, usersService: UsersService, aiProvidersService: AiProvidersService, billingService: BillingService);
    getDashboardStats(): Promise<{
        users: {
            total: number;
            activeToday: number;
            newToday: number;
            newThisMonth: number;
        };
        generations: {
            total: number;
            today: number;
        };
        revenue: {
            thisMonth: any;
        };
        subscriptions: {
            active: number;
        };
    }>;
    getUsers(page: number, limit: number, search?: string, role?: UserRole): Promise<{
        users: (import("mongoose").Document<unknown, {}, UserDocument, {}, {}> & User & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
            _id: Types.ObjectId;
        }> & {
            __v: number;
        })[];
        pagination: {
            page: number;
            limit: number;
            total: number;
            pages: number;
        };
    }>;
    changeUserRole(userId: string, role: UserRole): Promise<(import("mongoose").Document<unknown, {}, UserDocument, {}, {}> & User & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
        _id: Types.ObjectId;
    }> & {
        __v: number;
    }) | null>;
    toggleBan(userId: string, ban: boolean, reason?: string): Promise<(import("mongoose").Document<unknown, {}, UserDocument, {}, {}> & User & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
        _id: Types.ObjectId;
    }> & {
        __v: number;
    }) | null>;
    adjustBalance(adminId: string, userId: string, amount: number, reason: string): Promise<{
        balanceBefore: number;
        balanceAfter: number;
        adjustment: number;
    }>;
    getProviders(): Promise<import("../ai-providers/schemas/provider.schema").ProviderDocument[]>;
    updateProvider(slug: string, updates: any): Promise<import("../ai-providers/schemas/provider.schema").ProviderDocument>;
    getModels(): Promise<import("../ai-providers/schemas/model.schema").ModelDocument[]>;
    updateModel(slug: string, updates: any): Promise<import("../ai-providers/schemas/model.schema").ModelDocument>;
    getPromoCodes(): Promise<(import("mongoose").Document<unknown, {}, import("../billing/schemas/promo-code.schema").PromoCodeDocument, {}, {}> & import("../billing/schemas/promo-code.schema").PromoCode & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
        _id: Types.ObjectId;
    }> & {
        __v: number;
    })[]>;
    createPromoCode(adminId: string, data: any): Promise<import("mongoose").Document<unknown, {}, import("../billing/schemas/promo-code.schema").PromoCodeDocument, {}, {}> & import("../billing/schemas/promo-code.schema").PromoCode & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
        _id: Types.ObjectId;
    }> & {
        __v: number;
    }>;
    deactivatePromo(code: string): Promise<import("mongoose").Document<unknown, {}, import("../billing/schemas/promo-code.schema").PromoCodeDocument, {}, {}> & import("../billing/schemas/promo-code.schema").PromoCode & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
        _id: Types.ObjectId;
    }> & {
        __v: number;
    }>;
    getRevenueAnalytics(days: number): Promise<{
        revenue: any[];
        generations: any[];
        newSubscriptions: number;
    }>;
    getGenerationAnalytics(days: number): Promise<{
        byDay: any[];
        byType: any[];
        byStatus: any[];
    }>;
    getModelUsageAnalytics(): Promise<any[]>;
}
