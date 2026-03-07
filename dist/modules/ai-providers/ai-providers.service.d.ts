import { Model } from 'mongoose';
import { AIModel, ModelDocument } from './schemas/model.schema';
import { Provider, ProviderDocument } from './schemas/provider.schema';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { GenerationResult, TextGenerationRequest, ImageGenerationRequest, VideoGenerationRequest, AudioGenerationRequest, StreamChunk, TaskStatusResult } from './providers/base-provider.abstract';
import { GenerationType } from '@/common/interfaces';
export declare class AiProvidersService {
    private modelModel;
    private providerModel;
    private registry;
    private readonly logger;
    constructor(modelModel: Model<ModelDocument>, providerModel: Model<ProviderDocument>, registry: ProviderRegistryService);
    getModelsByType(type: GenerationType): Promise<ModelDocument[]>;
    getAllModels(): Promise<ModelDocument[]>;
    getModelBySlug(slug: string): Promise<ModelDocument>;
    getModelCost(slug: string): Promise<number>;
    generateText(modelSlug: string, request: Omit<TextGenerationRequest, 'model'>): Promise<GenerationResult>;
    generateTextStream(modelSlug: string, request: Omit<TextGenerationRequest, 'model'>): AsyncGenerator<StreamChunk>;
    generateImage(modelSlug: string, request: Omit<ImageGenerationRequest, 'model'>): Promise<GenerationResult>;
    generateVideo(modelSlug: string, request: Omit<VideoGenerationRequest, 'model'>): Promise<GenerationResult>;
    generateAudio(modelSlug: string, request: Omit<AudioGenerationRequest, 'model'>): Promise<GenerationResult>;
    checkTaskStatus(providerSlug: string, taskId: string): Promise<TaskStatusResult>;
    getAllProviders(): Promise<ProviderDocument[]>;
    updateProvider(slug: string, updates: Partial<Provider>): Promise<ProviderDocument>;
    updateModel(slug: string, updates: Partial<AIModel>): Promise<ModelDocument>;
    private executeWithFallback;
    private updateModelStats;
}
