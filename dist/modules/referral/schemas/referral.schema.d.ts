import { Document, Types } from 'mongoose';
export type ReferralDocument = Referral & Document;
export declare class Referral {
    referrerId: Types.ObjectId;
    referredId: Types.ObjectId;
    bonusEarned: number;
    hasPurchased: boolean;
    firstPurchaseAt: Date;
}
export declare const ReferralSchema: import("mongoose").Schema<Referral, import("mongoose").Model<Referral, any, any, any, Document<unknown, any, Referral, any, {}> & Referral & {
    _id: Types.ObjectId;
} & {
    __v: number;
}, any>, {}, {}, {}, {}, import("mongoose").DefaultSchemaOptions, Referral, Document<unknown, {}, import("mongoose").FlatRecord<Referral>, {}, import("mongoose").DefaultSchemaOptions> & import("mongoose").FlatRecord<Referral> & {
    _id: Types.ObjectId;
} & {
    __v: number;
}>;
