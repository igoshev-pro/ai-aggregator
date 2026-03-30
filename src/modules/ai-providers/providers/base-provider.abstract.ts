export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export interface TextGenerationRequest {
  model: string;
  messages: { role: string; content: string }[];
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
  aspectRatio?: string;      // ← ДОБАВИТЬ: '1:1', '16:9' и т.д.
  resolution?: string;       // ← ДОБАВИТЬ: '1K', '2K', '4K'
  quality?: string;          // ← ДОБАВИТЬ: 'basic', 'high' (seedream)
  outputFormat?: string;     // ← ДОБАВИТЬ: 'png', 'jpg' (nano-banana)
  steps?: number;
  seed?: number;
  numImages?: number;
  style?: string;
  inputUrls?: string[];      // ← ДОБАВИТЬ: для img2img
}

export interface VideoGenerationRequest {
  model: string;
  prompt: string;
  imageUrl?: string; // for image-to-video
  duration?: number; // seconds
  fps?: number;
  resolution?: string; // '720p', '1080p'
  aspectRatio?: string; // '16:9', '9:16', '1:1'
  style?: string;
  negativePrompt?: string;
  seed?: number;
}

export interface AudioGenerationRequest {
  model: string;
  prompt: string; // lyrics or description
  style?: string; // genre/style
  duration?: number;
  instrumental?: boolean;
  voiceId?: string; // for ElevenLabs TTS
  text?: string; // for TTS
  language?: string;
}

export interface GenerationResult {
  success: boolean;
  data?: {
    content?: string; // text response
    urls?: string[]; // media URLs
    taskId?: string; // for async generation polling
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
  error?: string;
}

export interface TaskStatusResult {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number; // 0-100
  resultUrls?: string[];
  error?: string;
  eta?: number; // estimated seconds remaining
}

export abstract class BaseProvider {
  protected config: ProviderConfig;
  protected slug: string;

  constructor(slug: string, config: ProviderConfig) {
    this.slug = slug;
    this.config = config;
  }

  abstract generateText(request: TextGenerationRequest): Promise<GenerationResult>;

  abstract generateTextStream(
    request: TextGenerationRequest,
  ): AsyncGenerator<StreamChunk>;

  abstract generateImage(request: ImageGenerationRequest): Promise<GenerationResult>;

  abstract generateVideo(request: VideoGenerationRequest): Promise<GenerationResult>;

  abstract generateAudio(request: AudioGenerationRequest): Promise<GenerationResult>;

  abstract checkTaskStatus(taskId: string): Promise<TaskStatusResult>;

  abstract healthCheck(): Promise<boolean>;

  getSlug(): string {
    return this.slug;
  }

  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...this.config.headers,
    };
  }
}