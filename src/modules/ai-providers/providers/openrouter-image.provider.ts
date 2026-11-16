// src/modules/ai-providers/providers/openrouter-image.provider.ts
import { outboundAxiosConfig } from '../../../common/net/outbound-proxy';
import { isRetryableProviderError } from '../../../common/errors/provider-outage';
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
    // Свой slug = ключ в реестре: по нему маршрутизируются опрос статуса,
    // статистика провайдера и исключение провайдера при retry.
    super('openrouter-image', config);
    this.client = axios.create({
      ...outboundAxiosConfig(),
      baseURL: config.baseUrl || 'https://openrouter.ai/api/v1',
      timeout: config.timeout || 180000, // GPT Image через OpenRouter рисует до 2–3 минут
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://your-app.com',
        'X-Title': 'AI Aggregator',
      },
    });
  }

  // Соотношения сторон, которые Gemini принимает в image_config.aspect_ratio
  private static readonly GEMINI_ASPECT_RATIOS = new Set([
    '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9',
    '1:4', '4:1', '1:8', '8:1',
  ]);

  // Сборка тела запроса: промпт + фото-референсы (img2img) + формат картинки.
  // image_config (aspect_ratio / image_size) понимают Gemini-модели;
  // для GPT Image формат подсказываем в тексте промпта.
  private buildBody(request: ImageGenerationRequest): Record<string, any> {
    const model = request.model;
    const isGemini = model.startsWith('google/');
    const r = request as any;

    const inputUrls: string[] = [
      ...(Array.isArray(r.inputUrls) ? r.inputUrls : []),
      ...(Array.isArray(r.imageUrls) ? r.imageUrls : []),
    ].filter((u: any) => typeof u === 'string' && u.length > 0);
    const uniqueUrls = [...new Set(inputUrls)];

    const aspectRatio: string | undefined =
      request.aspectRatio && request.aspectRatio !== 'auto'
        ? request.aspectRatio
        : undefined;

    let prompt = request.prompt || '';
    if (!isGemini && aspectRatio) {
      prompt = `${prompt}\n\nAspect ratio: ${aspectRatio}.`;
    }

    const content: any[] = [{ type: 'text', text: prompt }];
    for (const url of uniqueUrls) {
      content.push({ type: 'image_url', image_url: { url } });
    }

    const body: Record<string, any> = {
      model,
      messages: [
        {
          role: 'user',
          content: uniqueUrls.length > 0 ? content : prompt,
        },
      ],
      modalities: ['image', 'text'],
    };

    if (isGemini) {
      const imageConfig: Record<string, string> = {};
      if (aspectRatio && OpenRouterImageProvider.GEMINI_ASPECT_RATIOS.has(aspectRatio)) {
        imageConfig.aspect_ratio = aspectRatio;
      }
      // image_size (1K/2K/4K) есть у Gemini 3+; у 2.5 Flash Image его нет
      const res = String(request.resolution || '').toUpperCase();
      if (['1K', '2K', '4K'].includes(res) && !model.includes('gemini-2.5')) {
        imageConfig.image_size = res;
      }
      if (Object.keys(imageConfig).length > 0) body.image_config = imageConfig;
    }

    if (typeof request.seed === 'number') body.seed = request.seed;

    return body;
  }

  async generateImage(request: ImageGenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    try {
      const body = this.buildBody(request);
      this.logger.debug(
        `OpenRouter image: model=${request.model}, prompt="${request.prompt?.substring(0, 60)}", ` +
        `refs=${Array.isArray(body.messages[0].content) ? body.messages[0].content.length - 1 : 0}, ` +
        `image_config=${JSON.stringify(body.image_config || {})}`,
      );

      const response = await this.client.post('/chat/completions', body);

      // OpenRouter может вернуть ошибку апстрима в теле с HTTP 200
      if (response.data?.error) {
        const e: any = new Error(
          response.data.error.message || 'OpenRouter returned error in body',
        );
        e.bodyCode = Number(response.data.error.code);
        throw e;
      }

      const choice = response.data.choices?.[0];
      const message = choice?.message;

      if (!message) {
        throw new Error('No message in response');
      }

      const urls: string[] = [];

      // Вариант 1: message.images[] (data:image/...;base64 или https)
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
        // Модель ответила текстом без картинки — часто это отказ модерации
        // (finish_reason=content_filter или объяснение в тексте).
        const finish = choice?.finish_reason || choice?.native_finish_reason;
        const text = typeof message.content === 'string' ? message.content.substring(0, 300) : '';
        this.logger.error(
          `Empty response: finish=${finish}, text="${text}", raw=${JSON.stringify(response.data).substring(0, 300)}`,
        );
        if (/content_filter|safety|prohibited|blocked/i.test(String(finish))) {
          throw new Error(`Content policy: image blocked by model safety filter (${finish})`);
        }
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
        `OpenRouter image error: status=${status}, data=${JSON.stringify(errorData)?.substring(0, 300)}, message=${error?.message}`,
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
    const data = error?.response?.data;
    // Причина отказа апстрима (Google/OpenAI) лежит в metadata.raw
    const raw = data?.error?.metadata?.raw;
    const message =
      (data?.error?.message || error.message) +
      (typeof raw === 'string' && raw ? ` (${raw.substring(0, 200)})` : '');
    const bodyCode = Number(error?.bodyCode ?? data?.error?.code);
    return {
      success: false,
      error: {
        code: `HTTP_${status || 'UNKNOWN'}`,
        message,
        retryable: isRetryableProviderError({
          httpStatus: status,
          bodyCode: Number.isFinite(bodyCode) ? bodyCode : undefined,
          message,
        }),
      },
      responseTimeMs: Date.now() - start,
      providerSlug: this.slug,
    };
  }
}