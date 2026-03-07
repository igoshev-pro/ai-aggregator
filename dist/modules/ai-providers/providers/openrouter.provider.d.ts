import { BaseProvider, ProviderConfig, TextGenerationRequest, ImageGenerationRequest, VideoGenerationRequest, AudioGenerationRequest, GenerationResult, StreamChunk, TaskStatusResult } from './base-provider.abstract';
export declare class OpenRouterProvider extends BaseProvider {
    private client;
    constructor(config: ProviderConfig);
    generateText(request: TextGenerationRequest): Promise<GenerationResult>;
    generateTextStream(request: TextGenerationRequest): AsyncGenerator<StreamChunk>;
    generateImage(request: ImageGenerationRequest): Promise<GenerationResult>;
    generateVideo(_request: VideoGenerationRequest): Promise<GenerationResult>;
    generateAudio(_request: AudioGenerationRequest): Promise<GenerationResult>;
    checkTaskStatus(_taskId: string): Promise<TaskStatusResult>;
    healthCheck(): Promise<boolean>;
    private handleError;
}
