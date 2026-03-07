import { AiProvidersService } from './ai-providers.service';
import { GenerationType } from '@/common/interfaces';
export declare class AiProvidersController {
    private readonly aiProvidersService;
    constructor(aiProvidersService: AiProvidersService);
    getModels(type?: GenerationType): Promise<{
        success: boolean;
        data: {
            slug: string;
            name: string;
            displayName: string;
            description: string;
            icon: string;
            type: GenerationType;
            tokenCost: number;
            isPremium: boolean;
            capabilities: string[];
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
        }[];
    }>;
    getModel(slug: string): Promise<{
        success: boolean;
        data: {
            slug: string;
            name: string;
            displayName: string;
            description: string;
            icon: string;
            type: GenerationType;
            tokenCost: number;
            isPremium: boolean;
            capabilities: string[];
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
            stats: {
                totalRequests: number;
                avgResponseTime: number;
                successRate: number;
            };
        };
    }>;
}
