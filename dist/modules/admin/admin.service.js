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
var AdminService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const user_schema_1 = require("../users/schemas/user.schema");
const users_service_1 = require("../users/users.service");
const ai_providers_service_1 = require("../ai-providers/ai-providers.service");
const billing_service_1 = require("../billing/billing.service");
const generation_schema_1 = require("../generation/schemas/generation.schema");
const transaction_schema_1 = require("../billing/schemas/transaction.schema");
const interfaces_1 = require("../../common/interfaces");
let AdminService = AdminService_1 = class AdminService {
    constructor(userModel, generationModel, transactionModel, usersService, aiProvidersService, billingService) {
        this.userModel = userModel;
        this.generationModel = generationModel;
        this.transactionModel = transactionModel;
        this.usersService = usersService;
        this.aiProvidersService = aiProvidersService;
        this.billingService = billingService;
        this.logger = new common_1.Logger(AdminService_1.name);
    }
    async getDashboardStats() {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const [totalUsers, activeToday, newToday, newThisMonth, totalGenerations, generationsToday, revenue, activeSubscriptions,] = await Promise.all([
            this.userModel.countDocuments(),
            this.userModel.countDocuments({ lastActiveAt: { $gte: today } }),
            this.userModel.countDocuments({ createdAt: { $gte: today } }),
            this.userModel.countDocuments({ createdAt: { $gte: thisMonth } }),
            this.generationModel.countDocuments(),
            this.generationModel.countDocuments({ createdAt: { $gte: today } }),
            this.transactionModel.aggregate([
                {
                    $match: {
                        type: interfaces_1.TransactionType.DEPOSIT,
                        paymentStatus: interfaces_1.PaymentStatus.COMPLETED,
                        createdAt: { $gte: thisMonth },
                    },
                },
                { $group: { _id: null, total: { $sum: '$paymentAmountRub' } } },
            ]),
            this.userModel.countDocuments({
                subscriptionPlan: { $ne: 'free' },
                subscriptionExpiresAt: { $gt: now },
            }),
        ]);
        return {
            users: {
                total: totalUsers,
                activeToday,
                newToday,
                newThisMonth,
            },
            generations: {
                total: totalGenerations,
                today: generationsToday,
            },
            revenue: {
                thisMonth: revenue[0]?.total || 0,
            },
            subscriptions: {
                active: activeSubscriptions,
            },
        };
    }
    async getUsers(page, limit, search, role) {
        const filter = {};
        if (search) {
            filter.$or = [
                { username: { $regex: search, $options: 'i' } },
                { firstName: { $regex: search, $options: 'i' } },
                { lastName: { $regex: search, $options: 'i' } },
                { telegramId: isNaN(Number(search)) ? undefined : Number(search) },
            ].filter(Boolean);
        }
        if (role)
            filter.role = role;
        const skip = (page - 1) * limit;
        const [users, total] = await Promise.all([
            this.userModel
                .find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .select('-__v')
                .exec(),
            this.userModel.countDocuments(filter),
        ]);
        return {
            users,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        };
    }
    async changeUserRole(userId, role) {
        const user = await this.userModel.findByIdAndUpdate(userId, { role }, { new: true });
        return user;
    }
    async toggleBan(userId, ban, reason) {
        const user = await this.userModel.findByIdAndUpdate(userId, {
            isBanned: ban,
            banReason: ban ? reason : null,
        }, { new: true });
        return user;
    }
    async adjustBalance(adminId, userId, amount, reason) {
        return this.billingService.adminAdjustBalance(adminId, userId, amount, reason);
    }
    async getProviders() {
        return this.aiProvidersService.getAllProviders();
    }
    async updateProvider(slug, updates) {
        return this.aiProvidersService.updateProvider(slug, updates);
    }
    async getModels() {
        return this.aiProvidersService.getAllModels();
    }
    async updateModel(slug, updates) {
        return this.aiProvidersService.updateModel(slug, updates);
    }
    async getPromoCodes() {
        return this.billingService.getAllPromoCodes();
    }
    async createPromoCode(adminId, data) {
        return this.billingService.createPromoCode({
            ...data,
            expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
            createdBy: adminId,
        });
    }
    async deactivatePromo(code) {
        return this.billingService.deactivatePromoCode(code);
    }
    async getRevenueAnalytics(days) {
        return this.billingService.getRevenueStats(days);
    }
    async getGenerationAnalytics(days) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        const [byDay, byType, byStatus] = await Promise.all([
            this.generationModel.aggregate([
                { $match: { createdAt: { $gte: since } } },
                {
                    $group: {
                        _id: {
                            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                            type: '$type',
                        },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { '_id.date': 1 } },
            ]),
            this.generationModel.aggregate([
                { $match: { createdAt: { $gte: since } } },
                {
                    $group: {
                        _id: '$type',
                        count: { $sum: 1 },
                        avgResponseTime: { $avg: '$responseTimeMs' },
                        successCount: {
                            $sum: { $cond: [{ $eq: ['$status', interfaces_1.GenerationStatus.COMPLETED] }, 1, 0] },
                        },
                        failCount: {
                            $sum: { $cond: [{ $eq: ['$status', interfaces_1.GenerationStatus.FAILED] }, 1, 0] },
                        },
                    },
                },
            ]),
            this.generationModel.aggregate([
                { $match: { createdAt: { $gte: since } } },
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 },
                    },
                },
            ]),
        ]);
        return { byDay, byType, byStatus };
    }
    async getModelUsageAnalytics() {
        const since = new Date();
        since.setDate(since.getDate() - 30);
        return this.generationModel.aggregate([
            { $match: { createdAt: { $gte: since } } },
            {
                $group: {
                    _id: '$modelSlug',
                    totalRequests: { $sum: 1 },
                    completed: {
                        $sum: { $cond: [{ $eq: ['$status', interfaces_1.GenerationStatus.COMPLETED] }, 1, 0] },
                    },
                    failed: {
                        $sum: { $cond: [{ $eq: ['$status', interfaces_1.GenerationStatus.FAILED] }, 1, 0] },
                    },
                    avgResponseTime: { $avg: '$responseTimeMs' },
                    totalTokensSpent: { $sum: '$tokensCost' },
                },
            },
            {
                $addFields: {
                    successRate: {
                        $cond: [
                            { $gt: ['$totalRequests', 0] },
                            { $multiply: [{ $divide: ['$completed', '$totalRequests'] }, 100] },
                            0,
                        ],
                    },
                },
            },
            { $sort: { totalRequests: -1 } },
        ]);
    }
};
exports.AdminService = AdminService;
exports.AdminService = AdminService = AdminService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)(user_schema_1.User.name)),
    __param(1, (0, mongoose_1.InjectModel)(generation_schema_1.Generation.name)),
    __param(2, (0, mongoose_1.InjectModel)(transaction_schema_1.Transaction.name)),
    __param(3, (0, common_1.Inject)((0, common_1.forwardRef)(() => users_service_1.UsersService))),
    __param(4, (0, common_1.Inject)((0, common_1.forwardRef)(() => ai_providers_service_1.AiProvidersService))),
    __param(5, (0, common_1.Inject)((0, common_1.forwardRef)(() => billing_service_1.BillingService))),
    __metadata("design:paramtypes", [mongoose_2.Model,
        mongoose_2.Model,
        mongoose_2.Model,
        users_service_1.UsersService,
        ai_providers_service_1.AiProvidersService,
        billing_service_1.BillingService])
], AdminService);
//# sourceMappingURL=admin.service.js.map