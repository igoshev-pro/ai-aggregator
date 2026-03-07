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

export class EvolinkProvider extends BaseProvider {
  private client: AxiosInstance;

  constructor(config: ProviderConfig) {
    super('evolink', config);
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout || 120000,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
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
        stream: false,
      });

      const data = response.data;
      return {
        success: true,
        data: {
          content: data.choices[0]?.message?.content || '',
          metadata: { model: data.model },
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
      return this.handleError(error, start);
    }
  }

  async *generateTextStream(
    request: TextGenerationRequest,
  ): AsyncGenerator<StreamChunk> {
    try {
      const response = await this.client.post(
        '/chat/completions',
        {
          model: request.model,
          messages: request.messages,
          max_tokens: request.maxTokens || 4096,
          temperature: request.temperature ?? 0.7,
          stream: true,
        },
        { responseType: 'stream', timeout: 180000 },
      );

      let buffer = '';
      for await (const chunk of response.data) {
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
            const content = parsed.choices?.[0]?.delta?.content || '';
            if (content) {
              yield { content, done: false };
            }
            if (parsed.choices?.[0]?.finish_reason === 'stop') {
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
          } catch {}
        }
      }
    } catch (error) {
      yield { content: `Error: ${error.message}`, done: true };
    }
  }

  async generateImage(request: ImageGenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    try {
      const response = await this.client.post('/images/generate', {
        model: request.model,
        prompt: request.prompt,
        negative_prompt: request.negativePrompt,
        width: request.width || 1024,
        height: request.height || 1024,
        steps: request.steps || 30,
        n: request.numImages || 1,
        seed: request.seed,
      });

      const data = response.data;
      let urls: string[] = [];
      let taskId: string | undefined;

      // Некоторые модели возвращают URL сразу, другие — taskId для polling
      if (data.images) {
        urls = data.images.map((img: any) => img.url);
      } else if (data.task_id) {
        taskId = data.task_id;
      }

      return {
        success: true,
        data: { urls, taskId, metadata: { model: request.model } },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    } catch (error) {
      return this.handleError(error, start);
    }
  }

  async generateVideo(request: VideoGenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    try {
      const body: any = {
        model: request.model,
        prompt: request.prompt,
        duration: request.duration || 5,
        aspect_ratio: request.aspectRatio || '16:9',
      };

      if (request.imageUrl) {
        body.image_url = request.imageUrl;
      }
      if (request.negativePrompt) {
        body.negative_prompt = request.negativePrompt;
      }

      const response = await this.client.post('/video/generate', body);
      const data = response.data;

      return {
        success: true,
        data: {
          taskId: data.task_id || data.id,
          urls: data.video_url ? [data.video_url] : [],
          metadata: { model: request.model },
        },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    } catch (error) {
      return this.handleError(error, start);
    }
  }

  async generateAudio(request: AudioGenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    try {
      const response = await this.client.post('/audio/generate', {
        model: request.model,
        prompt: request.prompt,
        style: request.style,
        duration: request.duration,
        instrumental: request.instrumental,
      });

      const data = response.data;
      return {
        success: true,
        data: {
          taskId: data.task_id || data.id,
          urls: data.audio_url ? [data.audio_url] : [],
          metadata: { model: request.model },
        },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    } catch (error) {
      return this.handleError(error, start);
    }
  }

  async checkTaskStatus(taskId: string): Promise<TaskStatusResult> {
    try {
      const response = await this.client.get(`/tasks/${taskId}`);
      const data = response.data;

      return {
        status: this.mapStatus(data.status),
        progress: data.progress,
        resultUrls: data.result?.urls || data.output?.urls,
        error: data.error?.message,
        eta: data.eta,
      };
    } catch {
      return { status: 'failed', error: 'Failed to check task status' };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/models', { timeout: 5000 });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  private mapStatus(status: string): TaskStatusResult['status'] {
    const map: Record<string, TaskStatusResult['status']> = {
      'queued': 'pending',
      'pending': 'pending',
      'running': 'processing',
      'processing': 'processing',
      'completed': 'completed',
      'succeeded': 'completed',
      'failed': 'failed',
      'error': 'failed',
    };
    return map[status] || 'pending';
  }

  private handleError(error: any, start: number): GenerationResult {
    const status = error?.response?.status;
    const message = error?.response?.data?.error?.message || error.message;

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