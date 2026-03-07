import { BaseProvider, ProviderConfig, TextGenerationRequest, ImageGenerationRequest, VideoGenerationRequest, AudioGenerationRequest, GenerationResult, StreamChunk, TaskStatusResult } from './base-provider.abstract';
export declare class ReplicateProvider extends BaseProvider {
    private client;
    constructor(config: ProviderConfig);
    generateText(_request: TextGenerationRequest): Promise<GenerationResult>;
    generateTextStream(_request: TextGenerationRequest): AsyncGenerator<StreamChunk>;
    generateImage(request: ImageGenerationRequest): Promise<GenerationResult>;
    generateVideo(request: VideoGenerationRequest): Promise<GenerationResult>;
    generateAudio(request: AudioGenerationRequest): Promise<GenerationResult>;
    checkTaskStatus(taskId: string): Promise<TaskStatusResult>;
    healthCheck(): Promise<boolean>;
    private parseProgress;
    private handleError;
}
