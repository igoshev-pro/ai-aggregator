import { Model, Types } from 'mongoose';
import { Queue } from 'bull';
import { Generation, GenerationDocument } from './schemas/generation.schema';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { UsersService } from '../users/users.service';
import { BillingService } from '../billing/billing.service';
import { GenerationType, GenerationStatus } from '@/common/interfaces';
import { ImageGenerationDto, VideoGenerationDto, AudioGenerationDto } from './dto/image-generation.dto';
export declare class GenerationService {
    private generationModel;
    private generationQueue;
    private aiProvidersService;
    private usersService;
    private billingService;
    private readonly logger;
    constructor(generationModel: Model<GenerationDocument>, generationQueue: Queue, aiProvidersService: AiProvidersService, usersService: UsersService, billingService: BillingService);
    generateImage(userId: string, dto: ImageGenerationDto): Promise<{
        generationId: string;
        status: GenerationStatus;
        tokensCost: number;
    }>;
    generateVideo(userId: string, dto: VideoGenerationDto): Promise<{
        generationId: string;
        status: GenerationStatus;
        tokensCost: number;
    }>;
    generateAudio(userId: string, dto: AudioGenerationDto): Promise<{
        generationId: string;
        status: GenerationStatus;
        tokensCost: number;
    }>;
    getGenerationStatus(userId: string, generationId: string): Promise<{
        id: Types.ObjectId;
        type: GenerationType;
        modelSlug: string;
        status: GenerationStatus;
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
    }>;
    getUserGenerations(userId: string, type?: GenerationType, page?: number, limit?: number): Promise<{
        generations: {
            id: Types.ObjectId;
            type: GenerationType;
            modelSlug: string;
            status: GenerationStatus;
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
    }>;
    updateGeneration(generationId: string, updates: Partial<Generation>): Promise<GenerationDocument | null>;
    refundGeneration(generationId: string): Promise<void>;
    toggleFavorite(userId: string, generationId: string): Promise<{
        isFavorite: boolean;
    }>;
    getFavorites(userId: string, page?: number, limit?: number): Promise<{
        generations: (import("mongoose").Document<unknown, {}, GenerationDocument, {}, {}> & Generation & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
            _id: Types.ObjectId;
        }> & {
            __v: number;
        })[];
        pagination: {
            page: number;
            limit: number;
            total: number;
            pages: number;
        };
    }>;
    private validateBalance;
}
