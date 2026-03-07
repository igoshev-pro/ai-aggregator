import { Document, Types } from 'mongoose';
import { GenerationType } from '@/common/interfaces';
export type ModelDocument = AIModel & Document;
export declare class AIModel {
    slug: string;
    name: string;
    displayName: string;
    description: string;
    icon: string;
    type: GenerationType;
    isActive: boolean;
    isPremium: boolean;
    sortOrder: number;
    tokenCost: number;
    providerMappings: {
        providerId: Types.ObjectId;
        providerSlug: string;
        modelId: string;
        priority: number;
        isActive: boolean;
    }[];
    defaultParams: {
        maxTokens?: number;
        temperature?: number;
        topP?: number;
        width?: number;
        height?: number;
        steps?: number;
        duration?: number;
        fps?: number;
    };
    limits: {
        maxInputTokens?: number;
        maxOutputTokens?: number;
        maxImagesPerRequest?: number;
        maxResolution?: string;
        maxDuration?: number;
        cooldownSeconds?: number;
    };
    capabilities: string[];
    stats: {
        totalRequests: number;
        avgResponseTime: number;
        successRate: number;
    };
}
export declare const AIModelSchema: import("mongoose").Schema<AIModel, import("mongoose").Model<AIModel, any, any, any, Document<unknown, any, AIModel, any, {}> & AIModel & {
    _id: Types.ObjectId;
} & {
    __v: number;
}, any>, {}, {}, {}, {}, import("mongoose").DefaultSchemaOptions, AIModel, Document<unknown, {}, import("mongoose").FlatRecord<AIModel>, {}, import("mongoose").DefaultSchemaOptions> & import("mongoose").FlatRecord<AIModel> & {
    _id: Types.ObjectId;
} & {
    __v: number;
}>;
