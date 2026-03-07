import { Request } from 'express';
import { AnalyticsService } from './analytics.service';
export declare class AnalyticsController {
    private readonly analyticsService;
    constructor(analyticsService: AnalyticsService);
    track(userId: string, body: {
        event: string;
        properties?: Record<string, any>;
        source?: string;
        platform?: string;
    }, req: Request): Promise<{
        success: boolean;
    }>;
    trackBatch(userId: string, body: {
        events: {
            event: string;
            properties?: Record<string, any>;
            source?: string;
        }[];
    }): Promise<{
        success: boolean;
    }>;
    getStats(days?: number): Promise<{
        success: boolean;
        data: {
            eventCounts: any[];
            dailyActive: any[];
            topEvents: any[];
            funnelData: {
                registered: number;
                madeGeneration: any;
                madePurchase: any;
            };
        };
    }>;
    getPlatformStats(days?: number): Promise<{
        success: boolean;
        data: any[];
    }>;
}
