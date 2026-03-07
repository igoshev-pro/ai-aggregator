export interface ProviderConfig {
    apiKey: string;
    baseUrl: string;
    timeout?: number;
    headers?: Record<string, string>;
}
export interface TextGenerationRequest {
    model: string;
    messages: {
        role: string;
        content: string;
    }[];
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    stream?: boolean;
}
export interface ImageGenerationRequest {
    model: string;
    prompt: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
    steps?: number;
    seed?: number;
    numImages?: number;
    style?: string;
}
export interface VideoGenerationRequest {
    model: string;
    prompt: string;
    imageUrl?: string;
    duration?: number;
    fps?: number;
    resolution?: string;
    aspectRatio?: string;
    style?: string;
    negativePrompt?: string;
    seed?: number;
}
export interface AudioGenerationRequest {
    model: string;
    prompt: string;
    style?: string;
    duration?: number;
    instrumental?: boolean;
    voiceId?: string;
    text?: string;
    language?: string;
}
export interface GenerationResult {
    success: boolean;
    data?: {
        content?: string;
        urls?: string[];
        taskId?: string;
        metadata?: Record<string, any>;
    };
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
    };
    error?: {
        code: string;
        message: string;
        retryable: boolean;
    };
    responseTimeMs: number;
    providerSlug: string;
}
export interface StreamChunk {
    content: string;
    done: boolean;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
    };
}
export interface TaskStatusResult {
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress?: number;
    resultUrls?: string[];
    error?: string;
    eta?: number;
}
export declare abstract class BaseProvider {
    protected config: ProviderConfig;
    protected slug: string;
    constructor(slug: string, config: ProviderConfig);
    abstract generateText(request: TextGenerationRequest): Promise<GenerationResult>;
    abstract generateTextStream(request: TextGenerationRequest): AsyncGenerator<StreamChunk>;
    abstract generateImage(request: ImageGenerationRequest): Promise<GenerationResult>;
    abstract generateVideo(request: VideoGenerationRequest): Promise<GenerationResult>;
    abstract generateAudio(request: AudioGenerationRequest): Promise<GenerationResult>;
    abstract checkTaskStatus(taskId: string): Promise<TaskStatusResult>;
    abstract healthCheck(): Promise<boolean>;
    getSlug(): string;
    protected getHeaders(): Record<string, string>;
}
