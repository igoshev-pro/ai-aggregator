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

export class KieProvider extends BaseProvider {
  private client: AxiosInstance;

  constructor(config: ProviderConfig) {
    super('kie', config);
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
      const response = await this.client.post('/v1/chat/completions', {
        model: request.model,
        messages: request.messages,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
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
        '/v1/chat/completions',
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
            if (content) yield { content, done: false };
            if (parsed.choices?.[0]?.finish_reason === 'stop') {
              yield { content: '', done: true };
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
      const response = await this.client.post('/v1/images/generations', {
        model: request.model,
        prompt: request.prompt,
        negative_prompt: request.negativePrompt,
        width: request.width || 1024,
        height: request.height || 1024,
        num_images: request.numImages || 1,
        steps: request.steps,
      });

      const data = response.data;
      return {
        success: true,
        data: {
          urls: data.data?.map((d: any) => d.url) || [],
          taskId: data.task_id,
          metadata: { model: request.model },
        },
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
        resolution: request.resolution || '720p',
      };
      if (request.imageUrl) body.image_url = request.imageUrl;

      const response = await this.client.post('/v1/video/generations', body);
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
      const response = await this.client.post('/v1/audio/generations', {
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
      const response = await this.client.get(`/v1/tasks/${taskId}`);
      const data = response.data;
      const statusMap: Record<string, TaskStatusResult['status']> = {
        queued: 'pending', pending: 'pending',
        processing: 'processing', running: 'processing',
        completed: 'completed', succeeded: 'completed',
        failed: 'failed', error: 'failed',
      };

      return {
        status: statusMap[data.status] || 'pending',
        progress: data.progress,
        resultUrls: data.output?.urls || (data.output?.url ? [data.output.url] : []),
        error: data.error?.message,
        eta: data.eta,
      };
    } catch {
      return { status: 'failed', error: 'Failed to check task status' };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.client.get('/v1/models', { timeout: 5000 });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  private handleError(error: any, start: number): GenerationResult {
    const status = error?.response?.status;
    return {
      success: false,
      error: {
        code: `HTTP_${status || 'UNKNOWN'}`,
        message: error?.response?.data?.error?.message || error.message,
        retryable: status === 429 || status >= 500,
      },
      responseTimeMs: Date.now() - start,
      providerSlug: this.slug,
    };
  }
}