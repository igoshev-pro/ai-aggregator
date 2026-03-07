import { Document } from 'mongoose';
export type PromoCodeDocument = PromoCode & Document;
export declare class PromoCode {
    code: string;
    description: string;
    bonusTokens: number;
    discountPercent: number;
    maxUses: number;
    currentUses: number;
    maxUsesPerUser: number;
    expiresAt: Date;
    isActive: boolean;
    usedByUsers: string[];
    createdBy: string;
}
export declare const PromoCodeSchema: import("mongoose").Schema<PromoCode, import("mongoose").Model<PromoCode, any, any, any, Document<unknown, any, PromoCode, any, {}> & PromoCode & {
    _id: import("mongoose").Types.ObjectId;
} & {
    __v: number;
}, any>, {}, {}, {}, {}, import("mongoose").DefaultSchemaOptions, PromoCode, Document<unknown, {}, import("mongoose").FlatRecord<PromoCode>, {}, import("mongoose").DefaultSchemaOptions> & import("mongoose").FlatRecord<PromoCode> & {
    _id: import("mongoose").Types.ObjectId;
} & {
    __v: number;
}>;
