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
exports.ReferralService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const referral_schema_1 = require("./schemas/referral.schema");
const users_service_1 = require("../users/users.service");
let ReferralService = class ReferralService {
    constructor(referralModel, usersService) {
        this.referralModel = referralModel;
        this.usersService = usersService;
    }
    async getReferralStats(userId) {
        const user = await this.usersService.findById(userId);
        const referrals = await this.referralModel
            .find({ referrerId: new mongoose_2.Types.ObjectId(userId) })
            .populate('referredId', 'firstName username createdAt')
            .sort({ createdAt: -1 })
            .exec();
        return {
            referralCode: user.referralCode,
            referralLink: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=ref_${user.referralCode}`,
            totalReferrals: user.referralCount,
            totalEarnings: user.referralEarnings,
            referrals: referrals.map((r) => ({
                user: r.referredId,
                bonusEarned: r.bonusEarned,
                hasPurchased: r.hasPurchased,
                joinedAt: r['createdAt'],
            })),
        };
    }
    async recordReferral(referrerId, referredId) {
        const existing = await this.referralModel.findOne({
            referredId: new mongoose_2.Types.ObjectId(referredId),
        });
        if (existing)
            return;
        const referral = new this.referralModel({
            referrerId: new mongoose_2.Types.ObjectId(referrerId),
            referredId: new mongoose_2.Types.ObjectId(referredId),
        });
        await referral.save();
    }
};
exports.ReferralService = ReferralService;
exports.ReferralService = ReferralService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)(referral_schema_1.Referral.name)),
    __param(1, (0, common_1.Inject)((0, common_1.forwardRef)(() => users_service_1.UsersService))),
    __metadata("design:paramtypes", [mongoose_2.Model,
        users_service_1.UsersService])
], ReferralService);
//# sourceMappingURL=referral.service.js.map