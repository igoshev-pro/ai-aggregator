export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  timeout?: number;
  headers?: Record<string, string>;
}

/**
 * 🆕 Сообщение в чате с поддержкой vision (multimodal).
 *
 * Форматы content:
 * - string — простой текст (legacy)
 * - any[] — массив multimodal-частей (OpenAI-style: text + image_url)
 *
 * Поле imageUrls — упрощённый формат: текст + список URL картинок.
 * Провайдеры сами конвертируют его в нужный формат (OpenAI / Anthropic).
 */
export interface ChatMessage {
  role: string;
  content: string | any[];
  imageUrls?: string[];
}

export interface TextGenerationRequest {
  model: string;
  // 🆕 Расширенный тип сообщений с поддержкой vision
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stream?: boolean;
  // 🆕 GPT 5.6 codex-модели
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  webSearch?: boolean;
}

export interface ImageGenerationRequest {
  model: string;
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  aspectRatio?: string;      // '1:1', '16:9' и т.д.
  resolution?: string;       // '1K', '2K', '4K'
  quality?: string;          // 'basic', 'high' (seedream)
  outputFormat?: string;     // 'png', 'jpg' (nano-banana)
  steps?: number;
  seed?: number;
  numImages?: number;
  style?: string;
  inputUrls?: string[];      // для img2img
  characterName?: string;    // 🆕 Gemini Omni Character: имя персонажа (опц.)
}

export interface VideoGenerationRequest {
  model: string;
  prompt: string;
  imageUrl?: string; // for image-to-video (single)
  imageUrls?: string[];        // 🆕 start/end frames (Veo FIRST_AND_LAST), multi-image
  referenceImages?: string[];  // 🆕 reference-to-video (Veo REFERENCE_2_VIDEO, 1-3 img)
  videoUrls?: string[];        // 🆕 motion-control / extend
  generationType?: string;     // 🆕 explicit override (TEXT_2_VIDEO / FIRST_AND_LAST_FRAMES_2_VIDEO / REFERENCE_2_VIDEO)
  duration?: number; // seconds
  fps?: number;
  resolution?: string; // '720p', '1080p', '4k'
  aspectRatio?: string; // '16:9', '9:16', '1:1', 'Auto'
  style?: string;
  negativePrompt?: string;
  seed?: number;
  watermark?: string;          // 🆕 Veo watermark text
  sound?: boolean;             // 🆕 Kling/Wan sound
  generateAudio?: boolean;     // 🆕 Veo audio flag (alias)
  mode?: string;               // 🆕 Kling std/pro
  removeWatermark?: boolean;
  resizeMode?: string;
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

  // 🆕 Suno
  title?: string;
  customMode?: boolean;
  operation?: string;        // generate | extend | cover | ...
  negativeTags?: string;     // что исключить (стили)
  vocalGender?: string;      // 'm' | 'f'
  styleWeight?: number;      // 0..1
  weirdnessConstraint?: number; // 0..1
  audioWeight?: number;      // 0..1

  // 🆕 Gemini Omni Audio (voice design)
  exampleDialogue?: string;  // пример реплики для голоса (опц., ≤120 символов)
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
    cachedTokens?: number;        // 🆕 кеш-чтение (входит в inputTokens)
    cacheCreationTokens?: number; // 🆕 запись кеша (Anthropic)
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
    cachedTokens?: number;        // 🆕
    cacheCreationTokens?: number; // 🆕
  };
  error?: string;
}

export interface TaskStatusResult {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number; // 0-100
  resultUrls?: string[];
  error?: string;
  eta?: number; // estimated seconds remaining
  metadata?: Record<string, any>; // 🆕 audioIds для Suno extend/persona
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