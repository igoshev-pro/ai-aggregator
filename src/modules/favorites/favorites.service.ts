import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Favorite, FavoriteDocument } from './schemas/favorite.schema';

@Injectable()
export class FavoritesService {
  constructor(
    @InjectModel(Favorite.name) private favoriteModel: Model<FavoriteDocument>,
  ) {}

  async toggleFavorite(
    userId: string,
    type: string,
    itemId: string,
    metadata?: { title?: string; previewUrl?: string; [key: string]: any },
  ) {
    const existing = await this.favoriteModel.findOne({
      userId: new Types.ObjectId(userId),
      type,
      itemId,
    });

    if (existing) {
      await this.favoriteModel.findByIdAndDelete(existing._id);
      return { isFavorite: false };
    }

    const favorite = new this.favoriteModel({
      userId: new Types.ObjectId(userId),
      type,
      itemId,
      title: metadata?.title,
      previewUrl: metadata?.previewUrl,
      metadata,
    });
    await favorite.save();
    return { isFavorite: true };
  }

  async getFavorites(userId: string, type?: string, page = 1, limit = 20) {
    const filter: any = { userId: new Types.ObjectId(userId) };
    if (type) filter.type = type;

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

  async isFavorite(userId: string, type: string, itemId: string): Promise<boolean> {
    const count = await this.favoriteModel.countDocuments({
      userId: new Types.ObjectId(userId),
      type,
      itemId,
    });
    return count > 0;
  }
}