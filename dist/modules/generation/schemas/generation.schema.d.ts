import { Document, Types } from 'mongoose';
import { GenerationType, GenerationStatus } from '@/common/interfaces';
export type GenerationDocument = Generation & Document;
export declare class Generation {
    userId: Types.ObjectId;
    type: GenerationType;
    modelSlug: string;
    status: GenerationStatus;
    prompt: string;
    negativePrompt: string;
    params: {
        width?: number;
        height?: number;
        steps?: number;
        seed?: number;
        numImages?: number;
        style?: string;
        aspectRatio?: string;
        duration?: number;
        fps?: number;
        resolution?: string;
        imageUrl?: string;
        instrumental?: boolean;
        voiceId?: string;
        language?: string;
    };
    resultUrls: string[];
    resultContent: string;
    taskId: string;
    providerSlug: string;
    progress: number;
    eta: number;
    tokensCost: number;
    isRefunded: boolean;
    startedAt: Date;
    completedAt: Date;
    responseTimeMs: number;
    errorMessage: string;
    retryCount: number;
    metadata: Record<string, any>;
    isFavorite: boolean;
}
export declare const GenerationSchema: import("mongoose").Schema<Generation, import("mongoose").Model<Generation, any, any, any, Document<unknown, any, Generation, any, {}> & Generation & {
    _id: Types.ObjectId;
} & {
    __v: number;
}, any>, {}, {}, {}, {}, import("mongoose").DefaultSchemaOptions, Generation, Document<unknown, {}, import("mongoose").FlatRecord<Generation>, {}, import("mongoose").DefaultSchemaOptions> & import("mongoose").FlatRecord<Generation> & {
    _id: Types.ObjectId;
} & {
    __v: number;
}>;
