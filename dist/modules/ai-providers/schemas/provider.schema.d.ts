import { Document } from 'mongoose';
export type ProviderDocument = Provider & Document;
export declare class Provider {
    slug: string;
    name: string;
    baseUrl: string;
    isActive: boolean;
    priority: number;
    healthStatus: {
        isHealthy: boolean;
        lastCheck: Date;
        responseTime: number;
        errorRate: number;
        consecutiveErrors: number;
    };
    rateLimits: {
        requestsPerMinute: number;
        requestsPerDay: number;
        currentMinuteCount: number;
        currentDayCount: number;
    };
    config: Record<string, any>;
}
export declare const ProviderSchema: import("mongoose").Schema<Provider, import("mongoose").Model<Provider, any, any, any, Document<unknown, any, Provider, any, {}> & Provider & {
    _id: import("mongoose").Types.ObjectId;
} & {
    __v: number;
}, any>, {}, {}, {}, {}, import("mongoose").DefaultSchemaOptions, Provider, Document<unknown, {}, import("mongoose").FlatRecord<Provider>, {}, import("mongoose").DefaultSchemaOptions> & import("mongoose").FlatRecord<Provider> & {
    _id: import("mongoose").Types.ObjectId;
} & {
    __v: number;
}>;
