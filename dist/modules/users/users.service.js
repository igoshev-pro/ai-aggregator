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
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const user_schema_1 = require("./schemas/user.schema");
const uuid_1 = require("uuid");
let UsersService = class UsersService {
    constructor(userModel) {
        this.userModel = userModel;
    }
    async findOrCreateByTelegram(telegramUser, referralCode) {
        let user = await this.userModel.findOne({ telegramId: telegramUser.id });
        if (user) {
            user.firstName = telegramUser.first_name;
            user.lastName = telegramUser.last_name || '';
            user.username = telegramUser.username || '';
            user.photoUrl = telegramUser.photo_url || '';
            user.isPremiumTelegram = telegramUser.is_premium || false;
            user.lastActiveAt = new Date();
            await user.save();
            return user;
        }
        const newUser = {
            telegramId: telegramUser.id,
            firstName: telegramUser.first_name,
            lastName: telegramUser.last_name || '',
            username: telegramUser.username || '',
            photoUrl: telegramUser.photo_url || '',
            languageCode: telegramUser.language_code || 'en',
            isPremiumTelegram: telegramUser.is_premium || false,
            referralCode: this.generateReferralCode(),
            tokenBalance: 0,
            bonusTokens: 50,
            lastActiveAt: new Date(),
        };
        if (referralCode) {
            const referrer = await this.userModel.findOne({ referralCode });
            if (referrer) {
                newUser.referredBy = referrer._id;
                newUser.bonusTokens = 100;
                referrer.referralCount += 1;
                referrer.bonusTokens += 50;
                referrer.referralEarnings += 50;
                await referrer.save();
            }
        }
        user = new this.userModel(newUser);
        await user.save();
        return user;
    }
    async findById(id) {
        const user = await this.userModel.findById(id);
        if (!user)
            throw new common_1.NotFoundException('User not found');
        return user;
    }
    async findByTelegramId(telegramId) {
        const user = await this.userModel.findOne({ telegramId });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        return user;
    }
    async deductTokens(userId, amount, _type) {
        const user = await this.findById(userId);
        const totalAvailable = user.tokenBalance + user.bonusTokens;
        if (totalAvailable < amount) {
            throw new common_1.BadRequestException(`Insufficient tokens. Required: ${amount}, Available: ${totalAvailable}`);
        }
        if (user.bonusTokens >= amount) {
            user.bonusTokens -= amount;
        }
        else {
            const remainingFromBalance = amount - user.bonusTokens;
            user.bonusTokens = 0;
            user.tokenBalance -= remainingFromBalance;
        }
        user.totalTokensSpent += amount;
        await user.save();
        return user;
    }
    async addTokens(userId, amount) {
        const user = await this.userModel.findByIdAndUpdate(userId, {
            $inc: { tokenBalance: amount, totalDeposited: amount },
            $set: { lastActiveAt: new Date() },
        }, { new: true });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        return user;
    }
    async addBonusTokens(userId, amount) {
        const user = await this.userModel.findByIdAndUpdate(userId, { $inc: { bonusTokens: amount } }, { new: true });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        return user;
    }
    async refundTokens(userId, amount) {
        const user = await this.userModel.findByIdAndUpdate(userId, { $inc: { tokenBalance: amount, totalTokensSpent: -amount } }, { new: true });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        return user;
    }
    async updateSettings(userId, settings) {
        const user = await this.userModel.findByIdAndUpdate(userId, { $set: { settings } }, { new: true });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        return user;
    }
    async checkDailyLimit(userId, maxDaily) {
        const user = await this.findById(userId);
        const now = new Date();
        if (!user.dailyGenerationsResetAt || user.dailyGenerationsResetAt < now) {
            user.dailyGenerations = 0;
            user.dailyGenerationsResetAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            await user.save();
        }
        return user.dailyGenerations < maxDaily;
    }
    async incrementDailyGenerations(userId) {
        await this.userModel.findByIdAndUpdate(userId, {
            $inc: { dailyGenerations: 1 },
        });
    }
    async getLeaderboard(limit = 10) {
        return this.userModel
            .find({ isActive: true })
            .sort({ referralCount: -1 })
            .limit(limit)
            .select('firstName username referralCount referralEarnings');
    }
    async getStats() {
        const [totalUsers, activeToday, premiumUsers] = await Promise.all([
            this.userModel.countDocuments(),
            this.userModel.countDocuments({
                lastActiveAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            }),
            this.userModel.countDocuments({
                subscriptionPlan: { $ne: 'free' },
            }),
        ]);
        return { totalUsers, activeToday, premiumUsers };
    }
    generateReferralCode() {
        return (0, uuid_1.v4)().substring(0, 8).toUpperCase();
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)(user_schema_1.User.name)),
    __metadata("design:paramtypes", [mongoose_2.Model])
], UsersService);
//# sourceMappingURL=users.service.js.map