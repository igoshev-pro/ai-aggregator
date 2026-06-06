// src/modules/ai-providers/providers/openrouter.provider.ts
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

export class OpenRouterProvider extends BaseProvider {
  private client: AxiosInstance;
  private readonly logger = new Logger(OpenRouterProvider.name);

  constructor(config: ProviderConfig) {
    super('openrouter', config);
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

  // ========================================
  // 🆕 VISION HELPER — OpenAI-compatible multimodal content
  // ========================================

  /**
   * 🆕 Строит OpenAI-style content (массив частей) для vision-моделей.
   * OpenRouter полностью совместим с OpenAI multimodal форматом.
   * Работает для: GPT-4 Vision, Gemini Pro Vision, Claude через OR и т.д.
   *
   * Если imageUrls нет — возвращает строку (legacy формат).
   * Иначе — массив [{type:'text', text}, {type:'image_url', image_url:{url}}, ...]
   */
  private buildOpenAIContent(
    text: string,
    imageUrls?: string[],
  ): string | any[] {
    if (!imageUrls || imageUrls.length === 0) {
      return text;
    }

    const parts: any[] = [];

    if (text && text.trim().length > 0) {
      parts.push({ type: 'text', text });
    }

    for (const url of imageUrls) {
      parts.push({
        type: 'image_url',
        image_url: { url },
      });
    }

    return parts;
  }

  /**
   * 🆕 Преобразует входящие messages с imageUrls в OpenAI multimodal формат.
   */
  private prepareMessages(messages: any[]): any[] {
    return messages.map((msg: any) => {
      if (msg.imageUrls && msg.imageUrls.length > 0) {
        return {
          role: msg.role,
          content: this.buildOpenAIContent(msg.content, msg.imageUrls),
        };
      }
      return { role: msg.role, content: msg.content };
    });
  }

  async generateText(request: TextGenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    try {
      // 🆕 Преобразуем messages — поддержка vision
      const messages = this.prepareMessages(request.messages as any[]);

      const response = await this.client.post('/chat/completions', {
        model: request.model,
        messages,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        top_p: request.topP ?? 1,
        stream: false,
        usage: { include: true }, // 🔍 LOG: просим детальный usage с cost
      });

      const data = response.data;

      this.logger.warn(
        `[USAGE-PROBE][OpenRouter][non-stream] model=${request.model} ` +
        `usage=${JSON.stringify(data.usage)}`,
      );

      return {
        success: true,
        data: {
          content: data.choices[0]?.message?.content || '',
          metadata: {
            model: data.model,
            finishReason: data.choices[0]?.finish_reason,
          },
        },
        usage: {
          inputTokens: data.usage?.prompt_tokens,
          outputTokens: data.usage?.completion_tokens,
          totalTokens: data.usage?.total_tokens,
          cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens, // 🆕
        },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    } catch (error) {
      const status = error?.response?.status;
      this.logger.error(
        `OpenRouter generateText error: status=${status}, message=${error.message}`,
      );
      return this.handleError(error, start);
    }
  }

   async *generateTextStream(
    request: TextGenerationRequest,
  ): AsyncGenerator<StreamChunk> {
    // 🆕 Накопитель usage — OpenRouter присылает его в отдельном
    // финальном чанке (choices:[]), а не вместе с finish_reason.
    let finalUsage: StreamChunk['usage'] | undefined;

    const captureUsage = (u: any) => {
      if (!u) return;
      finalUsage = {
        inputTokens: u.prompt_tokens,
        outputTokens: u.completion_tokens,
        cachedTokens: u.prompt_tokens_details?.cached_tokens, // 🆕
      };
    };

    try {
      this.logger.debug(
        `OpenRouter stream request: model=${request.model}, messages=${request.messages?.length}`,
      );

      const messages = this.prepareMessages(request.messages as any[]);

      const response = await this.client.post(
        '/chat/completions',
        {
          model: request.model,
          messages,
          max_tokens: request.maxTokens || 4096,
          temperature: request.temperature ?? 0.7,
          top_p: request.topP ?? 1,
          stream: true,
          usage: { include: true },
          stream_options: { include_usage: true },
        },
        {
          responseType: 'stream',
          timeout: 180000,
        },
      );

      this.logger.debug(`OpenRouter stream response status: ${response.status}`);

      let buffer = '';
      const stream = response.data;

      for await (const chunk of stream) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            // 🆕 Отдаём накопленный usage в финале
            yield { content: '', done: true, usage: finalUsage };
            return;
          }

          try {
            const parsed = JSON.parse(data);

            // 🆕 Ловим usage из ЛЮБОГО чанка где он есть
            if (parsed.usage) {
              this.logger.warn(
                `[USAGE-PROBE][OpenRouter][stream] model=${request.model} ` +
                `usage=${JSON.stringify(parsed.usage)}`,
              );
              captureUsage(parsed.usage);
            }

            if (parsed.error) {
              this.logger.error(
                `OpenRouter SSE error: ${parsed.error?.message || 'unknown'}`,
              );
              yield {
                content: '',
                done: true,
                error: parsed.error?.message || 'OpenRouter SSE error',
              } as any;
              return;
            }

            const content = parsed.choices?.[0]?.delta?.content || '';
            const finishReason = parsed.choices?.[0]?.finish_reason;

            if (content) {
              yield { content, done: false };
            }

            // 🆕 НЕ выходим сразу при finish_reason — usage может прийти
            // в следующем чанке. Просто запоминаем, что стрим завершён.
            // Реальный выход — на [DONE] или на конце потока.
            if (finishReason === 'stop' && parsed.usage) {
              // usage уже в этом чанке — можно отдать сразу
              yield { content: '', done: true, usage: finalUsage };
              return;
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      this.logger.warn(
        `OpenRouter stream ended without [DONE] for model ${request.model}`,
      );
      // 🆕 На конце потока тоже отдаём накопленный usage
      yield { content: '', done: true, usage: finalUsage };

    } catch (error) {
      // ═══ SAFE ERROR — без изменений ═══
      const status = error?.response?.status;
      let errorMessage = error?.message || 'Unknown error';

      try {
        if (error?.response?.data) {
          if (
            typeof error.response.data?.pipe === 'function' ||
            typeof error.response.data?.[Symbol.asyncIterator] === 'function'
          ) {
            const chunks: Buffer[] = [];
            try {
              for await (const chunk of error.response.data) {
                chunks.push(Buffer.from(chunk));
                if (chunks.length > 5) break;
              }
              const body = Buffer.concat(chunks).toString('utf8').substring(0, 500);
              try {
                const parsed = JSON.parse(body);
                errorMessage =
                  parsed?.error?.message ||
                  parsed?.error?.metadata?.raw?.substring(0, 200) ||
                  parsed?.message ||
                  body;
              } catch {
                const match = body.match(/<p>(.*?)<\/p>/);
                if (match) {
                  errorMessage = match[1];
                } else if (body.length > 0) {
                  errorMessage = body.substring(0, 200);
                }
              }
            } catch {
              // Stream already closed
            }
          } else if (typeof error.response.data === 'string') {
            errorMessage = error.response.data.substring(0, 500);
          } else if (typeof error.response.data === 'object') {
            errorMessage =
              error.response.data?.error?.message ||
              error.response.data?.message ||
              error.response.data?.msg ||
              `HTTP ${status}`;
          }
        }
      } catch {
        errorMessage = `HTTP ${status || 'UNKNOWN'}: ${error?.message || 'Unknown'}`;
      }

      this.logger.error(
        `OpenRouter stream error: status=${status}, message=${errorMessage}`,
      );
      yield {
        content: '',
        done: true,
        error: `OpenRouter: ${status || 'NETWORK'} - ${errorMessage}`,
      } as any;
    }
  }

  async generateImage(
    request: ImageGenerationRequest,
  ): Promise<GenerationResult> {
    const start = Date.now();
    try {
      const response = await this.client.post('/images/generations', {
        model: request.model,
        prompt: request.prompt,
        n: request.numImages || 1,
        size: `${request.width || 1024}x${request.height || 1024}`,
        quality: 'hd',
      });

      const urls = response.data.data?.map((item: any) => item.url) || [];

      return {
        success: true,
        data: { urls, metadata: { model: request.model } },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    } catch (error) {
      this.logger.error(
        `OpenRouter generateImage error: status=${error?.response?.status}, message=${error.message}`,
      );
      return this.handleError(error, start);
    }
  }

  async generateVideo(
    _request: VideoGenerationRequest,
  ): Promise<GenerationResult> {
    return {
      success: false,
      error: {
        code: 'UNSUPPORTED',
        message: 'Video generation not supported by OpenRouter',
        retryable: false,
      },
      responseTimeMs: 0,
      providerSlug: this.slug,
    };
  }

  async generateAudio(
    _request: AudioGenerationRequest,
  ): Promise<GenerationResult> {
    return {
      success: false,
      error: {
        code: 'UNSUPPORTED',
        message: 'Audio generation not supported by OpenRouter',
        retryable: false,
      },
      responseTimeMs: 0,
      providerSlug: this.slug,
    };
  }

  async checkTaskStatus(_taskId: string): Promise<TaskStatusResult> {
    return { status: 'completed' };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/models', { timeout: 5000 });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  private handleError(error: any, start: number): GenerationResult {
    const status = error?.response?.status;
    const message = error?.response?.data?.error?.message || error.message;

    return {
      success: false,
      error: {
        code: `HTTP_${status || 'UNKNOWN'}`,
        message,
        retryable:
          status === 429 || status === 502 || status === 503 || status >= 500,
      },
      responseTimeMs: Date.now() - start,
      providerSlug: this.slug,
    };
  }
}