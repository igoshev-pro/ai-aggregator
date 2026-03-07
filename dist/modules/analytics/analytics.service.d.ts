import { Model, Types } from 'mongoose';
import { AnalyticsEvent, AnalyticsEventDocument } from './schemas/analytics-event.schema';
export declare class AnalyticsService {
    private analyticsModel;
    private readonly logger;
    constructor(analyticsModel: Model<AnalyticsEventDocument>);
    track(data: {
        event: string;
        userId?: string;
        sessionId?: string;
        properties?: Record<string, any>;
        source?: string;
        platform?: string;
        userAgent?: string;
        ip?: string;
    }): Promise<void>;
    trackBatch(events: {
        event: string;
        userId?: string;
        properties?: Record<string, any>;
        source?: string;
    }[]): Promise<void>;
    getEventStats(days?: number): Promise<{
        eventCounts: any[];
        dailyActive: any[];
        topEvents: any[];
        funnelData: {
            registered: number;
            madeGeneration: any;
            madePurchase: any;
        };
    }>;
    private getFunnelData;
    getPlatformStats(days?: number): Promise<any[]>;
    getUserActivity(userId: string, days?: number): Promise<(import("mongoose").Document<unknown, {}, AnalyticsEventDocument, {}, {}> & AnalyticsEvent & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
        _id: Types.ObjectId;
    }> & {
        __v: number;
    })[]>;
}
