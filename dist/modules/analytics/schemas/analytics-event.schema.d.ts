import { Document, Types } from 'mongoose';
export type AnalyticsEventDocument = AnalyticsEvent & Document;
export declare class AnalyticsEvent {
    event: string;
    userId: Types.ObjectId;
    sessionId: string;
    properties: Record<string, any>;
    source: string;
    platform: string;
    userAgent: string;
    ip: string;
}
export declare const AnalyticsEventSchema: import("mongoose").Schema<AnalyticsEvent, import("mongoose").Model<AnalyticsEvent, any, any, any, Document<unknown, any, AnalyticsEvent, any, {}> & AnalyticsEvent & {
    _id: Types.ObjectId;
} & {
    __v: number;
}, any>, {}, {}, {}, {}, import("mongoose").DefaultSchemaOptions, AnalyticsEvent, Document<unknown, {}, import("mongoose").FlatRecord<AnalyticsEvent>, {}, import("mongoose").DefaultSchemaOptions> & import("mongoose").FlatRecord<AnalyticsEvent> & {
    _id: Types.ObjectId;
} & {
    __v: number;
}>;
