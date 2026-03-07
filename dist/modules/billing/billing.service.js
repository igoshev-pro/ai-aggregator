"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var BillingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const schedule_1 = require("@nestjs/schedule");
const transaction_schema_1 = require("./schemas/transaction.schema");
const subscription_schema_1 = require("./schemas/subscription.schema");
const promo_code_schema_1 = require("./schemas/promo-code.schema");
const users_service_1 = require("../users/users.service");
const yookassa_provider_1 = require("./providers/yookassa.provider");
const cryptomus_provider_1 = require("./providers/cryptomus.provider");
const stars_provider_1 = require("./providers/stars.provider");
const interfaces_1 = require("../../common/interfaces");
const TOKEN_PACKAGES = [
    { id: 'pack_100', tokens: 100, priceRub: 99, label: '100 токенов' },
    { id: 'pack_300', tokens: 300, priceRub: 249, label: '300 токенов', popular: true },
    { id: 'pack_700', tokens: 700, priceRub: 499, label: '700 токенов' },
    { id: 'pack_1500', tokens: 1500, priceRub: 899, label: '1500 токенов' },
    { id: 'pack_5000', tokens: 5000, priceRub: 2499, label: '5000 токенов', best: true },
];
const SUBSCRIPTION_PLANS = {
    [interfaces_1.SubscriptionPlan.BASIC]: {
        name: 'Basic',
        priceRub: 299,
        tokensPerMonth: 500,
        features: {
            maxDailyGenerations: 50,
            priorityQueue: false,
            exclusiveModels: false,
            noWatermark: false,
            maxContextMessages: 20,
        },
    },
    [interfaces_1.SubscriptionPlan.PRO]: {
        name: 'Pro',
        priceRub: 699,
        tokensPerMonth: 1500,
        features: {
            maxDailyGenerations: 200,
            priorityQueue: true,
            exclusiveModels: true,
            noWatermark: true,
            maxContextMessages: 50,
        },
    },
    [interfaces_1.SubscriptionPlan.UNLIMITED]: {
        name: 'Unlimited',
        priceRub: 1999,
        tokensPerMonth: 5000,
        features: {
            maxDailyGenerations: 999999,
            priorityQueue: true,
            exclusiveModels: true,
            noWatermark: true,
            maxContextMessages: 100,
        },
    },
};
let BillingService = BillingService_1 = class BillingService {
    constructor(transactionModel, subscriptionModel, promoCodeModel, usersService, yookassaProvider, cryptomusProvider, starsProvider) {
        this.transactionModel = transactionModel;
        this.subscriptionModel = subscriptionModel;
        this.promoCodeModel = promoCodeModel;
        this.usersService = usersService;
        this.yookassaProvider = yookassaProvider;
        this.cryptomusProvider = cryptomusProvider;
        this.starsProvider = starsProvider;
        this.logger = new common_1.Logger(BillingService_1.name);
    }
    getTokenPackages() {
        return TOKEN_PACKAGES;
    }
    getSubscriptionPlans() {
        return SUBSCRIPTION_PLANS;
    }
    async createTokenPayment(userId, packageId, provider, returnUrl) {
        const pack = TOKEN_PACKAGES.find((p) => p.id === packageId);
        if (!pack)
            throw new common_1.BadRequestException('Invalid package');
        const user = await this.usersService.findById(userId);
        const paymentProvider = this.getPaymentProvider(provider);
        const result = await paymentProvider.createPayment({
            amount: pack.priceRub,
            tokens: pack.tokens,
            userId,
            description: `Пополнение: ${pack.label}`,
            returnUrl,
        });
        if (!result.success) {
            throw new common_1.BadRequestException(result.error || 'Payment creation failed');
        }
        await this.createTransaction(userId, {
            type: interfaces_1.TransactionType.DEPOSIT,
            amount: pack.tokens,
            description: `Пополнение: ${pack.label}`,
            paymentStatus: interfaces_1.PaymentStatus.PENDING,
            externalPaymentId: result.paymentId,
            paymentProvider: provider,
            paymentAmountRub: pack.priceRub,
            balanceBefore: user.tokenBalance,
            balanceAfter: user.tokenBalance,
        });
        return {
            paymentId: result.paymentId,
            paymentUrl: result.paymentUrl,
            package: pack,
        };
    }
    async handlePaymentWebhook(provider, body, headers) {
        const paymentProvider = this.getPaymentProvider(provider);
        const result = await paymentProvider.verifyWebhook(body, headers);
        if (!result.success) {
            this.logger.warn(`Webhook verification failed for ${provider}`);
            return { processed: false };
        }
        const transaction = await this.transactionModel.findOne({
            externalPaymentId: result.paymentId,
            paymentStatus: interfaces_1.PaymentStatus.PENDING,
        });
        if (!transaction) {
            this.logger.warn(`No pending transaction for payment ${result.paymentId}`);
            return { processed: false };
        }
        if (result.status === 'completed') {
            const user = await this.usersService.addTokens(transaction.userId.toString(), transaction.amount);
            transaction.paymentStatus = interfaces_1.PaymentStatus.COMPLETED;
            transaction.balanceAfter = user.tokenBalance;
            await transaction.save();
            if (transaction.type === interfaces_1.TransactionType.SUBSCRIPTION && transaction.metadata?.plan) {
                await this.activateSubscription(transaction.userId.toString(), transaction.metadata.plan);
            }
            await this.processReferralBonus(transaction);
            this.logger.log(`✅ Payment ${result.paymentId} completed: ${transaction.amount} tokens → user ${transaction.userId}`);
            return { processed: true, status: 'completed' };
        }
        if (result.status === 'failed') {
            transaction.paymentStatus = interfaces_1.PaymentStatus.FAILED;
            await transaction.save();
            return { processed: true, status: 'failed' };
        }
        return { processed: false, status: 'pending' };
    }
    async processReferralBonus(transaction) {
        const userDoc = await this.usersService.findById(transaction.userId.toString());
        if (!userDoc.referredBy)
            return;
        const referralBonus = Math.floor(transaction.amount * 0.1);
        if (referralBonus <= 0)
            return;
        await this.usersService.addBonusTokens(userDoc.referredBy.toString(), referralBonus);
        await this.createTransaction(userDoc.referredBy.toString(), {
            type: interfaces_1.TransactionType.REFERRAL_BONUS,
            amount: referralBonus,
            description: `Реферальный бонус от покупки пользователя ${userDoc.firstName}`,
            paymentStatus: interfaces_1.PaymentStatus.COMPLETED,
            referralUserId: transaction.userId,
        });
    }
    async chargeForGeneration(userId, amount, generationType, modelSlug, generationId) {
        const user = await this.usersService.findById(userId);
        await this.createTransaction(userId, {
            type: interfaces_1.TransactionType.GENERATION,
            amount: -amount,
            description: `Генерация ${generationType}: ${modelSlug}`,
            paymentStatus: interfaces_1.PaymentStatus.COMPLETED,
            generationId,
            generationType,
            modelSlug,
            balanceBefore: user.tokenBalance + user.bonusTokens + amount,
            balanceAfter: user.tokenBalance + user.bonusTokens,
        });
    }
    async recordRefund(userId, amount, description, generationId) {
        const user = await this.usersService.findById(userId);
        await this.createTransaction(userId, {
            type: interfaces_1.TransactionType.REFUND,
            amount,
            description,
            paymentStatus: interfaces_1.PaymentStatus.COMPLETED,
            generationId,
            balanceBefore: user.tokenBalance - amount,
            balanceAfter: user.tokenBalance,
        });
    }
    async applyPromoCode(userId, code) {
        const promo = await this.promoCodeModel.findOne({
            code: code.toUpperCase(),
            isActive: true,
        });
        if (!promo)
            throw new common_1.BadRequestException('Промокод не найден');
        if (promo.expiresAt && promo.expiresAt < new Date()) {
            throw new common_1.BadRequestException('Промокод истёк');
        }
        if (promo.maxUses !== null && promo.currentUses >= promo.maxUses) {
            throw new common_1.BadRequestException('Промокод исчерпан');
        }
        if (promo.usedByUsers.includes(userId)) {
            throw new common_1.BadRequestException('Вы уже использовали этот промокод');
        }
        const user = await this.usersService.addBonusTokens(userId, promo.bonusTokens);
        promo.currentUses += 1;
        promo.usedByUsers.push(userId);
        await promo.save();
        await this.createTransaction(userId, {
            type: interfaces_1.TransactionType.PROMO_CODE,
            amount: promo.bonusTokens,
            description: `Промокод ${promo.code}: +${promo.bonusTokens} токенов`,
            paymentStatus: interfaces_1.PaymentStatus.COMPLETED,
            promoCode: promo.code,
            balanceBefore: user.tokenBalance + user.bonusTokens - promo.bonusTokens,
            balanceAfter: user.tokenBalance + user.bonusTokens,
        });
        return {
            bonusTokens: promo.bonusTokens,
            newBalance: user.tokenBalance + user.bonusTokens,
        };
    }
    async createSubscription(userId, plan, provider, returnUrl) {
        if (plan === interfaces_1.SubscriptionPlan.FREE) {
            throw new common_1.BadRequestException('Cannot subscribe to free plan');
        }
        const planConfig = SUBSCRIPTION_PLANS[plan];
        if (!planConfig)
            throw new common_1.BadRequestException('Invalid plan');
        const paymentProvider = this.getPaymentProvider(provider);
        const result = await paymentProvider.createPayment({
            amount: planConfig.priceRub,
            tokens: planConfig.tokensPerMonth,
            userId,
            description: `Подписка ${planConfig.name}`,
            returnUrl,
        });
        if (!result.success) {
            throw new common_1.BadRequestException(result.error || 'Payment failed');
        }
        await this.createTransaction(userId, {
            type: interfaces_1.TransactionType.SUBSCRIPTION,
            amount: planConfig.tokensPerMonth,
            description: `Подписка ${planConfig.name}`,
            paymentStatus: interfaces_1.PaymentStatus.PENDING,
            externalPaymentId: result.paymentId,
            paymentProvider: provider,
            paymentAmountRub: planConfig.priceRub,
            metadata: { plan, planConfig },
        });
        return {
            paymentId: result.paymentId,
            paymentUrl: result.paymentUrl,
            plan: planConfig,
        };
    }
    async activateSubscription(userId, plan) {
        const planConfig = SUBSCRIPTION_PLANS[plan];
        if (!planConfig)
            return;
        const now = new Date();
        const endDate = new Date(now);
        endDate.setMonth(endDate.getMonth() + 1);
        await this.subscriptionModel.updateMany({ userId: new mongoose_2.Types.ObjectId(userId), isActive: true }, { isActive: false });
        const subscription = new this.subscriptionModel({
            userId: new mongoose_2.Types.ObjectId(userId),
            plan,
            startDate: now,
            endDate,
            isActive: true,
            tokensPerMonth: planConfig.tokensPerMonth,
            priceRub: planConfig.priceRub,
            features: planConfig.features,
        });
        await subscription.save();
        const user = await this.usersService.findById(userId);
        user.subscriptionPlan = plan;
        user.subscriptionExpiresAt = endDate;
        await user.save();
        await this.usersService.addTokens(userId, planConfig.tokensPerMonth);
        this.logger.log(`✅ Subscription ${plan} activated for user ${userId}`);
    }
    async getBalance(userId) {
        const user = await this.usersService.findById(userId);
        const activeSubscription = await this.subscriptionModel.findOne({
            userId: new mongoose_2.Types.ObjectId(userId),
            isActive: true,
            endDate: { $gt: new Date() },
        });
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todaySpent = await this.transactionModel.aggregate([
            {
                $match: {
                    userId: new mongoose_2.Types.ObjectId(userId),
                    type: interfaces_1.TransactionType.GENERATION,
                    createdAt: { $gte: todayStart },
                },
            },
            { $group: { _id: null, total: { $sum: { $abs: '$amount' } } } },
        ]);
        return {
            tokenBalance: user.tokenBalance,
            bonusTokens: user.bonusTokens,
            totalAvailable: user.tokenBalance + user.bonusTokens,
            totalSpent: user.totalTokensSpent,
            totalDeposited: user.totalDeposited,
            todaySpent: todaySpent[0]?.total || 0,
            subscription: activeSubscription
                ? {
                    plan: activeSubscription.plan,
                    expiresAt: activeSubscription.endDate,
                    tokensPerMonth: activeSubscription.tokensPerMonth,
                    features: activeSubscription.features,
                }
                : null,
            dailyGenerations: user.dailyGenerations,
        };
    }
    async getTransactionHistory(userId, type, page = 1, limit = 20) {
        const filter = { userId: new mongoose_2.Types.ObjectId(userId) };
        if (type)
            filter.type = type;
        const skip = (page - 1) * limit;
        const [transactions, total] = await Promise.all([
            this.transactionModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
            this.transactionModel.countDocuments(filter),
        ]);
        return {
            transactions,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        };
    }
    async checkExpiredSubscriptions() {
        const expired = await this.subscriptionModel.find({
            isActive: true,
            endDate: { $lt: new Date() },
        });
        for (const sub of expired) {
            sub.isActive = false;
            await sub.save();
            const user = await this.usersService.findById(sub.userId.toString());
            user.subscriptionPlan = interfaces_1.SubscriptionPlan.FREE;
            user.subscriptionExpiresAt = null;
            await user.save();
            this.logger.log(`Subscription expired for user ${sub.userId}, plan: ${sub.plan}`);
        }
        if (expired.length > 0) {
            this.logger.log(`Deactivated ${expired.length} expired subscriptions`);
        }
    }
    async createPromoCode(data) {
        const existing = await this.promoCodeModel.findOne({ code: data.code.toUpperCase() });
        if (existing)
            throw new common_1.BadRequestException('Promo code already exists');
        const promo = new this.promoCodeModel({ ...data, code: data.code.toUpperCase() });
        return promo.save();
    }
    async getAllPromoCodes() {
        return this.promoCodeModel.find().sort({ createdAt: -1 }).exec();
    }
    async deactivatePromoCode(code) {
        const promo = await this.promoCodeModel.findOne({ code: code.toUpperCase() });
        if (!promo)
            throw new common_1.NotFoundException('Promo code not found');
        promo.isActive = false;
        await promo.save();
        return promo;
    }
    async adminAdjustBalance(adminUserId, targetUserId, amount, reason) {
        const user = await this.usersService.findById(targetUserId);
        const balanceBefore = user.tokenBalance;
        if (amount > 0) {
            await this.usersService.addTokens(targetUserId, amount);
        }
        else {
            await this.usersService.deductTokens(targetUserId, Math.abs(amount), 'admin_adjustment');
        }
        const updatedUser = await this.usersService.findById(targetUserId);
        await this.createTransaction(targetUserId, {
            type: interfaces_1.TransactionType.ADMIN_ADJUSTMENT,
            amount,
            description: `Админ-корректировка: ${reason}`,
            paymentStatus: interfaces_1.PaymentStatus.COMPLETED,
            balanceBefore,
            balanceAfter: updatedUser.tokenBalance,
            metadata: { adminUserId, reason },
        });
        return { balanceBefore, balanceAfter: updatedUser.tokenBalance, adjustment: amount };
    }
    async getRevenueStats(days = 30) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        const [revenue, generations, newSubscriptions] = await Promise.all([
            this.transactionModel.aggregate([
                {
                    $match: {
                        type: interfaces_1.TransactionType.DEPOSIT,
                        paymentStatus: interfaces_1.PaymentStatus.COMPLETED,
                        createdAt: { $gte: since },
                    },
                },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                        totalRub: { $sum: '$paymentAmountRub' },
                        totalTokens: { $sum: '$amount' },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { _id: 1 } },
            ]),
            this.transactionModel.aggregate([
                { $match: { type: interfaces_1.TransactionType.GENERATION, createdAt: { $gte: since } } },
                {
                    $group: {
                        _id: '$modelSlug',
                        count: { $sum: 1 },
                        tokensSpent: { $sum: { $abs: '$amount' } },
                    },
                },
                { $sort: { count: -1 } },
            ]),
            this.subscriptionModel.countDocuments({ createdAt: { $gte: since }, isActive: true }),
        ]);
        return { revenue, generations, newSubscriptions };
    }
    getPaymentProvider(provider) {
        switch (provider) {
            case 'yookassa': return this.yookassaProvider;
            case 'cryptomus': return this.cryptomusProvider;
            case 'stars': return this.starsProvider;
            default: throw new common_1.BadRequestException(`Unknown payment provider: ${provider}`);
        }
    }
    async createTransaction(userId, data) {
        const transaction = new this.transactionModel({
            ...data,
            userId: new mongoose_2.Types.ObjectId(userId),
            referralUserId: data.referralUserId
                ? new mongoose_2.Types.ObjectId(data.referralUserId.toString())
                : undefined,
        });
        return transaction.save();
    }
};
exports.BillingService = BillingService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_HOUR),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BillingService.prototype, "checkExpiredSubscriptions", null);
exports.BillingService = BillingService = BillingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)(transaction_schema_1.Transaction.name)),
    __param(1, (0, mongoose_1.InjectModel)(subscription_schema_1.Subscription.name)),
    __param(2, (0, mongoose_1.InjectModel)(promo_code_schema_1.PromoCode.name)),
    __param(3, (0, common_1.Inject)((0, common_1.forwardRef)(() => users_service_1.UsersService))),
    __metadata("design:paramtypes", [mongoose_2.Model,
        mongoose_2.Model,
        mongoose_2.Model,
        users_service_1.UsersService,
        yookassa_provider_1.YookassaProvider,
        cryptomus_provider_1.CryptomusProvider,
        stars_provider_1.StarsProvider])
], BillingService);
//# sourceMappingURL=billing.service.js.map