import { FavoritesService } from './favorites.service';
export declare class FavoritesController {
    private readonly favoritesService;
    constructor(favoritesService: FavoritesService);
    toggle(userId: string, body: {
        type: string;
        itemId: string;
        title?: string;
        previewUrl?: string;
    }): Promise<{
        success: boolean;
        data: {
            isFavorite: boolean;
        };
    }>;
    getFavorites(userId: string, type?: string, page?: number, limit?: number): Promise<{
        success: boolean;
        data: {
            favorites: (import("mongoose").Document<unknown, {}, import("./schemas/favorite.schema").FavoriteDocument, {}, {}> & import("./schemas/favorite.schema").Favorite & import("mongoose").Document<import("mongoose").Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
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
}
