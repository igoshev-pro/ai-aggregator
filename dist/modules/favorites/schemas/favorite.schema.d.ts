import { Document, Types } from 'mongoose';
export type FavoriteDocument = Favorite & Document;
export declare class Favorite {
    userId: Types.ObjectId;
    type: string;
    itemId: string;
    title: string;
    previewUrl: string;
    metadata: Record<string, any>;
}
export declare const FavoriteSchema: import("mongoose").Schema<Favorite, import("mongoose").Model<Favorite, any, any, any, Document<unknown, any, Favorite, any, {}> & Favorite & {
    _id: Types.ObjectId;
} & {
    __v: number;
}, any>, {}, {}, {}, {}, import("mongoose").DefaultSchemaOptions, Favorite, Document<unknown, {}, import("mongoose").FlatRecord<Favorite>, {}, import("mongoose").DefaultSchemaOptions> & import("mongoose").FlatRecord<Favorite> & {
    _id: Types.ObjectId;
} & {
    __v: number;
}>;
