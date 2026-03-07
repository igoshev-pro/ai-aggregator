import { Model, Types } from 'mongoose';
import { Transaction, TransactionDocument } from './schemas/transaction.schema';
import { SubscriptionDocument } from './schemas/subscription.schema';
import { PromoCode, PromoCodeDocument } from './schemas/promo-code.schema';
import { UsersService } from '../users/users.service';
import { YookassaProvider } from './providers/yookassa.provider';
import { CryptomusProvider } from './providers/cryptomus.provider';
import { StarsProvider } from './providers/stars.provider';
import { TransactionType, SubscriptionPlan } from '@/common/interfaces';
export declare class BillingService {
    private transactionModel;
    private subscriptionModel;
    private promoCodeModel;
    private usersService;
    private yookassaProvider;
    private cryptomusProvider;
    private starsProvider;
    private readonly logger;
    constructor(transactionModel: Model<TransactionDocument>, subscriptionModel: Model<SubscriptionDocument>, promoCodeModel: Model<PromoCodeDocument>, usersService: UsersService, yookassaProvider: YookassaProvider, cryptomusProvider: CryptomusProvider, starsProvider: StarsProvider);
    getTokenPackages(): ({
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
    getSubscriptionPlans(): Record<string, any>;
    createTokenPayment(userId: string, packageId: string, provider: 'yookassa' | 'cryptomus' | 'stars', returnUrl?: string): Promise<{
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
    }>;
    handlePaymentWebhook(provider: 'yookassa' | 'cryptomus' | 'stars', body: any, headers: any): Promise<{
        processed: boolean;
        status?: undefined;
    } | {
        processed: boolean;
        status: string;
    }>;
    private processReferralBonus;
    chargeForGeneration(userId: string, amount: number, generationType: string, modelSlug: string, generationId: string): Promise<void>;
    recordRefund(userId: string, amount: number, description: string, generationId: string): Promise<void>;
    applyPromoCode(userId: string, code: string): Promise<{
        bonusTokens: number;
        newBalance: number;
    }>;
    createSubscription(userId: string, plan: SubscriptionPlan, provider: 'yookassa' | 'cryptomus' | 'stars', returnUrl?: string): Promise<{
        paymentId: string;
        paymentUrl: string | undefined;
        plan: any;
    }>;
    activateSubscription(userId: string, plan: SubscriptionPlan): Promise<void>;
    getBalance(userId: string): Promise<{
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
    }>;
    getTransactionHistory(userId: string, type?: TransactionType, page?: number, limit?: number): Promise<{
        transactions: (import("mongoose").Document<unknown, {}, TransactionDocument, {}, {}> & Transaction & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
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
    checkExpiredSubscriptions(): Promise<void>;
    createPromoCode(data: {
        code: string;
        description: string;
        bonusTokens: number;
        discountPercent?: number;
        maxUses?: number;
        maxUsesPerUser?: number;
        expiresAt?: Date;
        createdBy: string;
    }): Promise<import("mongoose").Document<unknown, {}, PromoCodeDocument, {}, {}> & PromoCode & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
        _id: Types.ObjectId;
    }> & {
        __v: number;
    }>;
    getAllPromoCodes(): Promise<(import("mongoose").Document<unknown, {}, PromoCodeDocument, {}, {}> & PromoCode & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
        _id: Types.ObjectId;
    }> & {
        __v: number;
    })[]>;
    deactivatePromoCode(code: string): Promise<import("mongoose").Document<unknown, {}, PromoCodeDocument, {}, {}> & PromoCode & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
        _id: Types.ObjectId;
    }> & {
        __v: number;
    }>;
    adminAdjustBalance(adminUserId: string, targetUserId: string, amount: number, reason: string): Promise<{
        balanceBefore: number;
        balanceAfter: number;
        adjustment: number;
    }>;
    getRevenueStats(days?: number): Promise<{
        revenue: any[];
        generations: any[];
        newSubscriptions: number;
    }>;
    private getPaymentProvider;
    private createTransaction;
}
