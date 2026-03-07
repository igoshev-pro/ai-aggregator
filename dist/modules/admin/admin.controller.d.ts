import { AdminService } from './admin.service';
import { UserRole } from '@/common/interfaces';
export declare class AdminController {
    private readonly adminService;
    constructor(adminService: AdminService);
    getDashboard(): Promise<{
        success: boolean;
        data: {
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
        };
    }>;
    getUsers(page?: number, limit?: number, search?: string, role?: UserRole): Promise<{
        success: boolean;
        data: {
            users: (import("mongoose").Document<unknown, {}, import("../users/schemas/user.schema").UserDocument, {}, {}> & import("../users/schemas/user.schema").User & import("mongoose").Document<import("mongoose").Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
                _id: import("mongoose").Types.ObjectId;
            }> & {
                __v: number;
            })[];
            pagination: {
                page: number;
                limit: number;
                total: number;
                pages: number;
            };
        };
    }>;
    changeRole(userId: string, role: UserRole): Promise<{
        success: boolean;
        data: (import("mongoose").Document<unknown, {}, import("../users/schemas/user.schema").UserDocument, {}, {}> & import("../users/schemas/user.schema").User & import("mongoose").Document<import("mongoose").Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        }) | null;
    }>;
    toggleBan(userId: string, body: {
        ban: boolean;
        reason?: string;
    }): Promise<{
        success: boolean;
        data: (import("mongoose").Document<unknown, {}, import("../users/schemas/user.schema").UserDocument, {}, {}> & import("../users/schemas/user.schema").User & import("mongoose").Document<import("mongoose").Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        }) | null;
    }>;
    adjustBalance(adminId: string, userId: string, body: {
        amount: number;
        reason: string;
    }): Promise<{
        success: boolean;
        data: {
            balanceBefore: number;
            balanceAfter: number;
            adjustment: number;
        };
    }>;
    getProviders(): Promise<{
        success: boolean;
        data: import("../ai-providers/schemas/provider.schema").ProviderDocument[];
    }>;
    updateProvider(slug: string, body: {
        isActive?: boolean;
        priority?: number;
    }): Promise<{
        success: boolean;
        data: import("../ai-providers/schemas/provider.schema").ProviderDocument;
    }>;
    getModels(): Promise<{
        success: boolean;
        data: import("../ai-providers/schemas/model.schema").ModelDocument[];
    }>;
    updateModel(slug: string, body: {
        isActive?: boolean;
        tokenCost?: number;
        isPremium?: boolean;
        sortOrder?: number;
    }): Promise<{
        success: boolean;
        data: import("../ai-providers/schemas/model.schema").ModelDocument;
    }>;
    getPromoCodes(): Promise<{
        success: boolean;
        data: (import("mongoose").Document<unknown, {}, import("../billing/schemas/promo-code.schema").PromoCodeDocument, {}, {}> & import("../billing/schemas/promo-code.schema").PromoCode & import("mongoose").Document<import("mongoose").Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        })[];
    }>;
    createPromoCode(adminId: string, body: {
        code: string;
        description: string;
        bonusTokens: number;
        discountPercent?: number;
        maxUses?: number;
        expiresAt?: string;
    }): Promise<{
        success: boolean;
        data: import("mongoose").Document<unknown, {}, import("../billing/schemas/promo-code.schema").PromoCodeDocument, {}, {}> & import("../billing/schemas/promo-code.schema").PromoCode & import("mongoose").Document<import("mongoose").Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        };
    }>;
    deactivatePromo(code: string): Promise<{
        success: boolean;
        data: import("mongoose").Document<unknown, {}, import("../billing/schemas/promo-code.schema").PromoCodeDocument, {}, {}> & import("../billing/schemas/promo-code.schema").PromoCode & import("mongoose").Document<import("mongoose").Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        };
    }>;
    getRevenue(days?: number): Promise<{
        success: boolean;
        data: {
            revenue: any[];
            generations: any[];
            newSubscriptions: number;
        };
    }>;
    getGenerationAnalytics(days?: number): Promise<{
        success: boolean;
        data: {
            byDay: any[];
            byType: any[];
            byStatus: any[];
        };
    }>;
    getModelAnalytics(): Promise<{
        success: boolean;
        data: any[];
    }>;
}
