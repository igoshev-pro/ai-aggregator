// src/modules/ai-providers/providers/openrouter-image.provider.ts
import { Logger } from '@nestjs/common';
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

export class OpenRouterImageProvider extends BaseProvider {
  private client: AxiosInstance;
  private readonly logger = new Logger(OpenRouterImageProvider.name);

  constructor(config: ProviderConfig) {
    super('openrouter', config); // тот же slug что у текстового
    this.client = axios.create({
      baseURL: config.baseUrl || 'https://openrouter.ai/api/v1',
      timeout: config.timeout || 120000,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://your-app.com',
        'X-Title': 'AI Aggregator',
      },
    });
  }

  async generateImage(request: ImageGenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    try {
      this.logger.debug(
        `OpenRouter image: model=${request.model}, prompt="${request.prompt?.substring(0, 60)}"`,
      );

      const response = await this.client.post('/chat/completions', {
        model: request.model,
        messages: [{ role: 'user', content: request.prompt }],
        modalities: ['image', 'text'],
      });

      const message = response.data.choices?.[0]?.message;

      if (!message) {
        throw new Error('No message in response');
      }

      const urls: string[] = [];

      // Вариант 1: message.images[]
      if (message.images && Array.isArray(message.images)) {
        for (const img of message.images) {
          const url = img.image_url?.url || img.url;
          if (url) urls.push(url);
        }
      }

      // Вариант 2: content как массив
      if (urls.length === 0 && Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'image_url' && part.image_url?.url) {
            urls.push(part.image_url.url);
          }
        }
      }

      // Вариант 3: base64 в строке
      if (urls.length === 0 && typeof message.content === 'string') {
        if (message.content.startsWith('data:image')) {
          urls.push(message.content);
        }
      }

      this.logger.debug(`OpenRouter image result: ${urls.length} images`);

      if (urls.length === 0) {
        this.logger.error(`Empty response: ${JSON.stringify(response.data).substring(0, 500)}`);
        throw new Error('No images returned from model');
      }

      return {
        success: true,
        data: { urls, metadata: { model: request.model } },
        usage: {
          inputTokens: response.data.usage?.prompt_tokens,
          outputTokens: response.data.usage?.completion_tokens,
          totalTokens: response.data.usage?.total_tokens,
        },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    } catch (error) {
      const status = error?.response?.status;
      const errorData = error?.response?.data;
      this.logger.error(
        `OpenRouter image error: status=${status}, data=${JSON.stringify(errorData)?.substring(0, 300)}`,
      );
      return this.handleError(error, start);
    }
  }

  async generateText(request: TextGenerationRequest): Promise<GenerationResult> {
    return { success: false, error: { code: 'UNSUPPORTED', message: 'Use OpenRouterProvider for text', retryable: false }, responseTimeMs: 0, providerSlug: this.slug };
  }

  async *generateTextStream(_req: TextGenerationRequest): AsyncGenerator<StreamChunk> {
    yield { content: 'Error: Not supported', done: true };
  }

  async generateVideo(_req: VideoGenerationRequest): Promise<GenerationResult> {
    return { success: false, error: { code: 'UNSUPPORTED', message: 'Not supported', retryable: false }, responseTimeMs: 0, providerSlug: this.slug };
  }

  async generateAudio(_req: AudioGenerationRequest): Promise<GenerationResult> {
    return { success: false, error: { code: 'UNSUPPORTED', message: 'Not supported', retryable: false }, responseTimeMs: 0, providerSlug: this.slug };
  }

  async checkTaskStatus(_taskId: string): Promise<TaskStatusResult> {
    return { status: 'completed' };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const r = await this.client.get('/models', { timeout: 5000 });
      return r.status === 200;
    } catch { return false; }
  }

  private handleError(error: any, start: number): GenerationResult {
    const status = error?.response?.status;
    const message = error?.response?.data?.error?.message || error.message;
    return {
      success: false,
      error: { code: `HTTP_${status || 'UNKNOWN'}`, message, retryable: status === 429 || status >= 500 },
      responseTimeMs: Date.now() - start,
      providerSlug: this.slug,
    };
  }
}