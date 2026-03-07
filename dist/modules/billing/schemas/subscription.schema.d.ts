import { Document, Types } from 'mongoose';
import { SubscriptionPlan } from '@/common/interfaces';
export type SubscriptionDocument = Subscription & Document;
export declare class Subscription {
    userId: Types.ObjectId;
    plan: SubscriptionPlan;
    startDate: Date;
    endDate: Date;
    isActive: boolean;
    autoRenew: boolean;
    paymentProvider: string;
    externalSubscriptionId: string;
    tokensPerMonth: number;
    priceRub: number;
    features: {
        maxDailyGenerations: number;
        priorityQueue: boolean;
        exclusiveModels: boolean;
        noWatermark: boolean;
        maxContextMessages: number;
    };
}
export declare const SubscriptionSchema: import("mongoose").Schema<Subscription, import("mongoose").Model<Subscription, any, any, any, Document<unknown, any, Subscription, any, {}> & Subscription & {
    _id: Types.ObjectId;
} & {
    __v: number;
}, any>, {}, {}, {}, {}, import("mongoose").DefaultSchemaOptions, Subscription, Document<unknown, {}, import("mongoose").FlatRecord<Subscription>, {}, import("mongoose").DefaultSchemaOptions> & import("mongoose").FlatRecord<Subscription> & {
    _id: Types.ObjectId;
} & {
    __v: number;
}>;
