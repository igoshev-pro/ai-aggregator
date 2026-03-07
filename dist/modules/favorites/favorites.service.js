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
exports.FavoritesService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const favorite_schema_1 = require("./schemas/favorite.schema");
let FavoritesService = class FavoritesService {
    constructor(favoriteModel) {
        this.favoriteModel = favoriteModel;
    }
    async toggleFavorite(userId, type, itemId, metadata) {
        const existing = await this.favoriteModel.findOne({
            userId: new mongoose_2.Types.ObjectId(userId),
            type,
            itemId,
        });
        if (existing) {
            await this.favoriteModel.findByIdAndDelete(existing._id);
            return { isFavorite: false };
        }
        const favorite = new this.favoriteModel({
            userId: new mongoose_2.Types.ObjectId(userId),
            type,
            itemId,
            title: metadata?.title,
            previewUrl: metadata?.previewUrl,
            metadata,
        });
        await favorite.save();
        return { isFavorite: true };
    }
    async getFavorites(userId, type, page = 1, limit = 20) {
        const filter = { userId: new mongoose_2.Types.ObjectId(userId) };
        if (type)
            filter.type = type;
        const skip = (page - 1) * limit;
        const [favorites, total] = await Promise.all([
            this.favoriteModel
                .find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .exec(),
            this.favoriteModel.countDocuments(filter),
        ]);
        return {
            favorites,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        };
    }
    async isFavorite(userId, type, itemId) {
        const count = await this.favoriteModel.countDocuments({
            userId: new mongoose_2.Types.ObjectId(userId),
            type,
            itemId,
        });
        return count > 0;
    }
};
exports.FavoritesService = FavoritesService;
exports.FavoritesService = FavoritesService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)(favorite_schema_1.Favorite.name)),
    __metadata("design:paramtypes", [mongoose_2.Model])
], FavoritesService);
//# sourceMappingURL=favorites.service.js.map