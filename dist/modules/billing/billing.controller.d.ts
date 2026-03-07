import { BillingService } from './billing.service';
import { TransactionType, SubscriptionPlan } from '@/common/interfaces';
export declare class BillingController {
    private readonly billingService;
    constructor(billingService: BillingService);
    getPackages(): {
        success: boolean;
        data: ({
            id: string;
            tokens: number;
            priceRub: number;
            label: string;
            popular?: undefined;
            best?: undefined;
        } | {
            id: string;
            tokens: number;
            priceRub: number;
            label: string;
            popular: boolean;
            best?: undefined;
        } | {
            id: string;
            tokens: number;
            priceRub: number;
            label: string;
            best: boolean;
            popular?: undefined;
        })[];
    };
    getPlans(): {
        success: boolean;
        data: Record<string, any>;
    };
    getBalance(userId: string): Promise<{
        success: boolean;
        data: {
            tokenBalance: number;
            bonusTokens: number;
            totalAvailable: number;
            totalSpent: number;
            totalDeposited: number;
            todaySpent: any;
            subscription: {
                plan: SubscriptionPlan;
                expiresAt: Date;
                tokensPerMonth: number;
                features: {
                    maxDailyGenerations: number;
                    priorityQueue: boolean;
                    exclusiveModels: boolean;
                    noWatermark: boolean;
                    maxContextMessages: number;
                };
            } | null;
            dailyGenerations: number;
        };
    }>;
    payTokens(userId: string, body: {
        packageId: string;
        provider: 'yookassa' | 'cryptomus' | 'stars';
        returnUrl?: string;
    }): Promise<{
        success: boolean;
        data: {
            paymentId: string;
            paymentUrl: string | undefined;
            package: {
                id: string;
                tokens: number;
                priceRub: number;
                label: string;
                popular?: undefined;
                best?: undefined;
            } | {
                id: string;
                tokens: number;
                priceRub: number;
                label: string;
                popular: boolean;
                best?: undefined;
            } | {
                id: string;
                tokens: number;
                priceRub: number;
                label: string;
                best: boolean;
                popular?: undefined;
            };
        };
    }>;
    paySubscription(userId: string, body: {
        plan: SubscriptionPlan;
        provider: 'yookassa' | 'cryptomus' | 'stars';
        returnUrl?: string;
    }): Promise<{
        success: boolean;
        data: {
            paymentId: string;
            paymentUrl: string | undefined;
            plan: any;
        };
    }>;
    applyPromo(userId: string, body: {
        code: string;
    }): Promise<{
        success: boolean;
        data: {
            bonusTokens: number;
            newBalance: number;
        };
    }>;
    getTransactions(userId: string, type?: TransactionType, page?: number, limit?: number): Promise<{
        success: boolean;
        data: {
            transactions: (import("mongoose").Document<unknown, {}, import("./schemas/transaction.schema").TransactionDocument, {}, {}> & import("./schemas/transaction.schema").Transaction & import("mongoose").Document<import("mongoose").Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
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
    yookassaWebhook(body: any, headers: any): Promise<{
        processed: boolean;
        status?: undefined;
    } | {
        processed: boolean;
        status: string;
    }>;
    cryptomusWebhook(body: any, headers: any): Promise<{
        processed: boolean;
        status?: undefined;
    } | {
        processed: boolean;
        status: string;
    }>;
}
