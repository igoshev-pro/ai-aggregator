import { GenerationService } from './generation.service';
import { ImageGenerationDto, VideoGenerationDto, AudioGenerationDto } from './dto/image-generation.dto';
import { GenerationType } from '@/common/interfaces';
export declare class GenerationController {
    private readonly generationService;
    constructor(generationService: GenerationService);
    generateImage(userId: string, dto: ImageGenerationDto): Promise<{
        success: boolean;
        data: {
            generationId: string;
            status: import("@/common/interfaces").GenerationStatus;
            tokensCost: number;
        };
    }>;
    generateVideo(userId: string, dto: VideoGenerationDto): Promise<{
        success: boolean;
        data: {
            generationId: string;
            status: import("@/common/interfaces").GenerationStatus;
            tokensCost: number;
        };
    }>;
    generateAudio(userId: string, dto: AudioGenerationDto): Promise<{
        success: boolean;
        data: {
            generationId: string;
            status: import("@/common/interfaces").GenerationStatus;
            tokensCost: number;
        };
    }>;
    getStatus(userId: string, generationId: string): Promise<{
        success: boolean;
        data: {
            id: import("mongoose").Types.ObjectId;
            type: GenerationType;
            modelSlug: string;
            status: import("@/common/interfaces").GenerationStatus;
            progress: number;
            eta: number;
            resultUrls: string[];
            resultContent: string;
            tokensCost: number;
            errorMessage: string;
            prompt: string;
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
            createdAt: any;
            completedAt: Date;
            responseTimeMs: number;
        };
    }>;
    getHistory(userId: string, type?: GenerationType, page?: number, limit?: number): Promise<{
        success: boolean;
        data: {
            generations: {
                id: import("mongoose").Types.ObjectId;
                type: GenerationType;
                modelSlug: string;
                status: import("@/common/interfaces").GenerationStatus;
                prompt: string;
                resultUrls: string[];
                tokensCost: number;
                isFavorite: boolean;
                createdAt: any;
                completedAt: Date;
            }[];
            pagination: {
                page: number;
                limit: number;
                total: number;
                pages: number;
            };
        };
    }>;
    getFavorites(userId: string, page?: number, limit?: number): Promise<{
        success: boolean;
        data: {
            generations: (import("mongoose").Document<unknown, {}, import("./schemas/generation.schema").GenerationDocument, {}, {}> & import("./schemas/generation.schema").Generation & import("mongoose").Document<import("mongoose").Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
                _id: import("mongoose").Types.ObjectId;
            }> & {
                __v: number;
            })[];
            pagination: {
                page: number;
                limit: number;
                total: number;
                pages: number;
            };
        };
    }>;
    toggleFavorite(userId: string, generationId: string): Promise<{
        success: boolean;
        data: {
            isFavorite: boolean;
        };
    }>;
}
