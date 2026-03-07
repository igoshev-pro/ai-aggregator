import { Model, Types } from 'mongoose';
import { Favorite, FavoriteDocument } from './schemas/favorite.schema';
export declare class FavoritesService {
    private favoriteModel;
    constructor(favoriteModel: Model<FavoriteDocument>);
    toggleFavorite(userId: string, type: string, itemId: string, metadata?: {
        title?: string;
        previewUrl?: string;
        [key: string]: any;
    }): Promise<{
        isFavorite: boolean;
    }>;
    getFavorites(userId: string, type?: string, page?: number, limit?: number): Promise<{
        favorites: (import("mongoose").Document<unknown, {}, FavoriteDocument, {}, {}> & Favorite & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
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
    isFavorite(userId: string, type: string, itemId: string): Promise<boolean>;
}
