// src/modules/ai-providers/providers/kie.provider.ts
import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import {
  BaseProvider,
  ProviderConfig,
  TextGenerationRequest,
  ImageGenerationRequest,
  VideoGenerationRequest,
  AudioGenerationRequest,
  GenerationResult,
  StreamChunk,
  TaskStatusResult,
} from './base-provider.abstract';

// Карта модель-слаг → реальный modelId kie.ai
// Это нужно потому что один наш slug может маппиться на разные kie модели
// в зависимости от наличия input images (img2img vs txt2img)
const KIE_MODEL_PARAMS: Record<string, {
  aspectRatios: string[];
  resolutions: string[];
  hasQuality?: boolean;        // seedream: basic/high
  hasNegativePrompt?: boolean; // imagen4
  hasSeed?: boolean;           // imagen4
  hasInputImages?: boolean;    // поддерживает img2img
  inputImagesField?: string;   // имя поля для картинок (input_urls / image_input / image_urls)
  maxInputImages?: number;
  hasOutputFormat?: boolean;   // nano-banana
}> = {
  'flux-2/flex-text-to-image': {
    aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    resolutions: ['1K', '2K'],
  },
  'flux-2/flex-image-to-image': {
    aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', 'auto'],
    resolutions: ['1K', '2K'],
    hasInputImages: true,
    inputImagesField: 'input_urls',
    maxInputImages: 8,
  },
  'flux-2/pro-text-to-image': {
    aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    resolutions: ['1K', '2K'],
  },
  'flux-2/pro-image-to-image': {
    aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', 'auto'],
    resolutions: ['1K', '2K'],
    hasInputImages: true,
    inputImagesField: 'input_urls',
    maxInputImages: 8,
  },
  'seedream/5-lite-text-to-image': {
    aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
    resolutions: ['basic', 'high'], // здесь resolutions = quality
    hasQuality: true,
  },
  'seedream/5-lite-image-to-image': {
    aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
    resolutions: ['basic', 'high'],
    hasQuality: true,
    hasInputImages: true,
    inputImagesField: 'image_urls',
    maxInputImages: 14,
  },
  'google/imagen4': {
    aspectRatios: ['1:1', '16:9', '9:16', '3:4', '4:3'],
    resolutions: [],
    hasNegativePrompt: true,
    hasSeed: true,
  },
  'google/imagen4-fast': {
    aspectRatios: ['1:1', '16:9', '9:16', '3:4', '4:3'],
    resolutions: [],
    hasNegativePrompt: true,
    hasSeed: true,
  },
  'nano-banana-2': {
    aspectRatios: ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9', 'auto'],
    resolutions: ['1K', '2K', '4K'],
    hasInputImages: true,
    inputImagesField: 'image_input',
    maxInputImages: 14,
    hasOutputFormat: true,
  },
  'nano-banana-pro': {
    aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', 'auto'],
    resolutions: ['1K', '2K', '4K'],
    hasInputImages: true,
    inputImagesField: 'image_input',
    maxInputImages: 8,
    hasOutputFormat: true,
  },
  'mj_txt2img': {
    aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    resolutions: ['1K', '2K'],
  },
  'mj_img2img': {
    aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    resolutions: ['1K', '2K'],
    hasInputImages: true,
    inputImagesField: 'input_urls',
    maxInputImages: 8,
  },
};

@Injectable()  
export class KieProvider extends BaseProvider {
  private client: AxiosInstance;
  private readonly logger = new Logger(KieProvider.name);

  constructor(config: ProviderConfig) {
    super('kie', config);
    this.client = axios.create({
      baseURL: config.baseUrl || 'https://api.kie.ai',
      timeout: config.timeout || 120000,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async generateImage(request: ImageGenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    try {
      const modelId = request.model;
      const modelParams = KIE_MODEL_PARAMS[modelId];

      this.logger.debug(
        `KIE generateImage: model=${modelId}, prompt="${request.prompt?.substring(0, 60)}"`,
      );

      // Строим input объект в зависимости от модели
      const input: Record<string, any> = {
        prompt: request.prompt,
      };

      // Aspect ratio — конвертируем из WxH в ratio если нужно
      const aspectRatio = this.toAspectRatio(request.width, request.height);
      input.aspect_ratio = aspectRatio;

      // Seedream использует quality вместо resolution
      if (modelParams?.hasQuality) {
        input.quality = (request as any).quality || 'basic';
      } else if (modelParams?.resolutions?.length > 0) {
        input.resolution = (request as any).resolution || '1K';
      }

      // Negative prompt (imagen4)
      if (modelParams?.hasNegativePrompt && request.negativePrompt) {
        input.negative_prompt = request.negativePrompt;
      }

      // Seed (imagen4)
      if (modelParams?.hasSeed && request.seed !== undefined) {
        input.seed = String(request.seed);
      }

      // Input images для img2img
      if (modelParams?.hasInputImages) {
        const inputUrls: string[] = (request as any).inputUrls || [];
        const field = modelParams.inputImagesField;
        
        if (field) {
          if (inputUrls.length > 0) {
            input[field] = inputUrls;
          } else if (field === 'image_input') {
            // nano-banana требует поле даже пустым
            input[field] = [];
          }
        }
      }

      // Output format (nano-banana)
      if (modelParams?.hasOutputFormat) {
        input.output_format = (request as any).outputFormat || 'png';
      }

      const response = await this.client.post('/api/v1/jobs/createTask', {
        model: modelId,
        input,
      });

      const data = response.data;

      if (data.code !== 200) {
        throw new Error(data.msg || 'KIE task creation failed');
      }

      const taskId = data.data?.taskId;
      if (!taskId) {
        throw new Error('No taskId in KIE response');
      }

      this.logger.debug(`KIE task created: ${taskId}`);

      // Возвращаем taskId — polling будет в consumer
      return {
        success: true,
        data: {
          taskId,
          urls: [],
          metadata: { model: modelId },
        },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    } catch (error) {
      this.logger.error(`KIE generateImage error: ${error.message}`);
      return this.handleError(error, start);
    }
  }

  async checkTaskStatus(taskId: string): Promise<TaskStatusResult> {
    try {
      const response = await this.client.get('/api/v1/jobs/recordInfo', {
        params: { taskId },
      });

      const data = response.data;

      if (data.code !== 200) {
        return { status: 'failed', error: data.msg || 'Failed to get task status' };
      }

      const task = data.data;
      if (!task) {
        return { status: 'pending' };
      }

      this.logger.debug(`KIE task ${taskId} state: ${task.state}, progress: ${task.progress}`);

      // Маппинг статусов kie → наши
      const stateMap: Record<string, TaskStatusResult['status']> = {
        waiting: 'pending',
        queuing: 'pending',
        generating: 'processing',
        success: 'completed',
        fail: 'failed',
      };

      const status = stateMap[task.state] || 'pending';

      if (status === 'failed') {
        return {
          status: 'failed',
          error: task.failMsg || task.failCode || 'Generation failed',
        };
      }

      if (status === 'completed') {
        let resultUrls: string[] = [];

        if (task.resultJson) {
          try {
            const parsed = JSON.parse(task.resultJson);
            resultUrls = parsed.resultUrls || [];
          } catch {
            this.logger.error(`Failed to parse resultJson: ${task.resultJson}`);
          }
        }

        return {
          status: 'completed',
          resultUrls,
          progress: 100,
        };
      }

      return {
        status,
        progress: task.progress || 0,
      };
    } catch (error) {
      this.logger.error(`KIE checkTaskStatus error: ${error.message}`);
      return { status: 'failed', error: `Status check failed: ${error.message}` };
    }
  }

  // Конвертация WxH → aspect ratio строку
  private toAspectRatio(width?: number, height?: number): string {
    if (!width || !height) return '1:1';
    
    // Если уже передан как строка в aspectRatio
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    const g = gcd(width, height);
    return `${width / g}:${height / g}`;
  }

  async generateVideo(request: VideoGenerationRequest): Promise<GenerationResult> {
    // Будет реализовано в следующем шаге (видео модели)
    return {
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'Use specific video model slug', retryable: false },
      responseTimeMs: 0,
      providerSlug: this.slug,
    };
  }

  async generateAudio(request: AudioGenerationRequest): Promise<GenerationResult> {
    // Будет реализовано в следующем шаге (аудио модели)
    return {
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'Use specific audio model slug', retryable: false },
      responseTimeMs: 0,
      providerSlug: this.slug,
    };
  }

  async generateText(request: TextGenerationRequest): Promise<GenerationResult> {
    // Gemini через kie — будет реализовано отдельно
    return {
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'Text via KIE not yet implemented', retryable: false },
      responseTimeMs: 0,
      providerSlug: this.slug,
    };
  }

  async *generateTextStream(_req: TextGenerationRequest): AsyncGenerator<StreamChunk> {
    yield { content: 'Error: Not supported', done: true };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.client.get('/api/v1/jobs/recordInfo', {
        params: { taskId: 'health_check_test' },
        timeout: 5000,
      });
      // Любой HTTP ответ = сервер живой
      this.logger.debug(`KIE health OK: status=${res.status}, code=${res.data?.code}`);
      return true;
    } catch (error) {
      const status = error?.response?.status;
      // Если сервер ответил с любым HTTP кодом — он живой
      if (status) {
        this.logger.debug(`KIE health OK (error response): status=${status}`);
        return true;
      }
      // Только сетевая ошибка = недоступен
      this.logger.warn(`KIE health FAIL (network error): ${error.message}`);
      return false;
    }
  }

  private handleError(error: any, start: number): GenerationResult {
    const status = error?.response?.status;
    const message = error?.response?.data?.msg || error.message;
    return {
      success: false,
      error: {
        code: `HTTP_${status || 'UNKNOWN'}`,
        message,
        retryable: status === 429 || status >= 500,
      },
      responseTimeMs: Date.now() - start,
      providerSlug: this.slug,
    };
  }
}