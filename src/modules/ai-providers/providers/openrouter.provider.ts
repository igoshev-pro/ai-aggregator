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

  async generateText(request: TextGenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    try {
      const response = await this.client.post('/chat/completions', {
        model: request.model,
        messages: request.messages,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        top_p: request.topP ?? 1,
        stream: false,
      });

      const data = response.data;
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
        },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    } catch (error) {
      const status = error?.response?.status;
      const errorData = error?.response?.data;
      this.logger.error(
        `OpenRouter generateText error: status=${status}, data=${JSON.stringify(errorData)}, message=${error.message}`,
      );
      return this.handleError(error, start);
    }
  }

  async *generateTextStream(
    request: TextGenerationRequest,
  ): AsyncGenerator<StreamChunk> {
    try {
      this.logger.debug(`OpenRouter stream request: model=${request.model}, messages=${request.messages?.length}`);

      const response = await this.client.post(
        '/chat/completions',
        {
          model: request.model,
          messages: request.messages,
          max_tokens: request.maxTokens || 4096,
          temperature: request.temperature ?? 0.7,
          top_p: request.topP ?? 1,
          stream: true,
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
            yield { content: '', done: true };
            return;
          }

          try {
            const parsed = JSON.parse(data);

            // Ошибка внутри SSE потока
            if (parsed.error) {
              this.logger.error(
                `OpenRouter SSE error: ${JSON.stringify(parsed.error)}`,
              );
              yield {
                content: `Error: ${parsed.error.message || JSON.stringify(parsed.error)}`,
                done: true,
              };
              return;
            }

            const content = parsed.choices?.[0]?.delta?.content || '';
            const finishReason = parsed.choices?.[0]?.finish_reason;

            if (content) {
              yield { content, done: false };
            }

            if (finishReason === 'stop') {
              yield {
                content: '',
                done: true,
                usage: {
                  inputTokens: parsed.usage?.prompt_tokens,
                  outputTokens: parsed.usage?.completion_tokens,
                },
              };
              return;
            }
} catch (error) {
  const status = error?.response?.status;
  let errorMessage = error.message;

  try {
    if (error?.response?.data) {
      if (typeof error.response.data === 'string') {
        errorMessage = error.response.data.substring(0, 500);
      } else if (typeof error.response.data.pipe === 'function') {
        const chunks: Buffer[] = [];
        for await (const chunk of error.response.data) {
          chunks.push(Buffer.from(chunk));
          if (chunks.length > 5) break;
        }
        const body = Buffer.concat(chunks).toString('utf8').substring(0, 500);
        try {
          const parsed = JSON.parse(body);
          errorMessage = parsed?.error?.message || parsed?.error?.metadata?.raw?.substring(0, 200) || parsed?.message || body;
        } catch {
          const match = body.match(/<p>(.*?)<\/p>/);
          errorMessage = match ? match[1] : (body || error.message);
        }
      } else if (error.response.data?.error?.message) {
        errorMessage = error.response.data.error.message;
      }
    }
  } catch {
    errorMessage = `HTTP ${status}: ${error.message}`;
  }

  this.logger.error(`OpenRouter stream error: status=${status}, message=${errorMessage}`);
  yield { content: '', done: true, error: `OpenRouter: ${status || 'NETWORK'} - ${errorMessage}` };
}
        }
      }

      // Поток закончился без [DONE]
      this.logger.warn(`OpenRouter stream ended without [DONE] for model ${request.model}`);
      yield { content: '', done: true };

    } catch (error) {
      const status = error?.response?.status;
      const errorData = error?.response?.data;
      this.logger.error(
        `OpenRouter stream error: status=${status}, data=${JSON.stringify(errorData)}, message=${error.message}`,
      );
      yield { content: `Error: ${error.message}`, done: true };
    }
  }

  async generateImage(request: ImageGenerationRequest): Promise<GenerationResult> {
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
      const status = error?.response?.status;
      const errorData = error?.response?.data;
      this.logger.error(
        `OpenRouter generateImage error: status=${status}, data=${JSON.stringify(errorData)}, message=${error.message}`,
      );
      return this.handleError(error, start);
    }
  }

  async generateVideo(_request: VideoGenerationRequest): Promise<GenerationResult> {
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

  async generateAudio(_request: AudioGenerationRequest): Promise<GenerationResult> {
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
        retryable: status === 429 || status === 502 || status === 503 || status >= 500,
      },
      responseTimeMs: Date.now() - start,
      providerSlug: this.slug,
    };
  }
}