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

export class ReplicateProvider extends BaseProvider {
  private client: AxiosInstance;

  constructor(config: ProviderConfig) {
    super('replicate', config);
    this.client = axios.create({
      baseURL: 'https://api.replicate.com/v1',
      timeout: config.timeout || 120000,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async generateText(_request: TextGenerationRequest): Promise<GenerationResult> {
    return {
      success: false,
      error: { code: 'UNSUPPORTED', message: 'Use OpenRouter for text', retryable: false },
      responseTimeMs: 0,
      providerSlug: this.slug,
    };
  }

  async *generateTextStream(
    _request: TextGenerationRequest,
  ): AsyncGenerator<StreamChunk> {
    yield { content: 'Text streaming not supported on Replicate', done: true };
  }

  async generateImage(request: ImageGenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    try {
      // Replicate использует версионированные модели
      const response = await this.client.post('/predictions', {
        model: request.model, // e.g., 'black-forest-labs/flux-pro'
        input: {
          prompt: request.prompt,
          negative_prompt: request.negativePrompt,
          width: request.width || 1024,
          height: request.height || 1024,
          num_inference_steps: request.steps || 28,
          seed: request.seed,
          num_outputs: request.numImages || 1,
        },
      });

      const prediction = response.data;

      // Replicate возвращает prediction, нужно polling
      if (prediction.status === 'succeeded') {
        return {
          success: true,
          data: {
            urls: Array.isArray(prediction.output)
              ? prediction.output
              : [prediction.output],
            metadata: { model: request.model, predictionId: prediction.id },
          },
          responseTimeMs: Date.now() - start,
          providerSlug: this.slug,
        };
      }

      // Async — вернуть taskId
      return {
        success: true,
        data: {
          taskId: prediction.id,
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
      const input: any = {
        prompt: request.prompt,
        duration: request.duration || 5,
      };
      if (request.imageUrl) input.image = request.imageUrl;
      if (request.aspectRatio) input.aspect_ratio = request.aspectRatio;

      const response = await this.client.post('/predictions', {
        model: request.model,
        input,
      });

      return {
        success: true,
        data: {
          taskId: response.data.id,
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
      const input: any = {
        prompt: request.prompt,
      };
      if (request.style) input.style = request.style;
      if (request.duration) input.duration = request.duration;
      if (request.instrumental !== undefined) input.instrumental = request.instrumental;

      const response = await this.client.post('/predictions', {
        model: request.model,
        input,
      });

      return {
        success: true,
        data: {
          taskId: response.data.id,
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
      const response = await this.client.get(`/predictions/${taskId}`);
      const data = response.data;

      const statusMap: Record<string, TaskStatusResult['status']> = {
        starting: 'pending',
        processing: 'processing',
        succeeded: 'completed',
        failed: 'failed',
        canceled: 'failed',
      };

      return {
        status: statusMap[data.status] || 'pending',
        progress: data.logs ? this.parseProgress(data.logs) : undefined,
        resultUrls: data.output
          ? Array.isArray(data.output) ? data.output : [data.output]
          : undefined,
        error: data.error,
        eta: data.metrics?.predict_time
          ? Math.max(0, (data.metrics.predict_time * 1.2) - (Date.now() - new Date(data.created_at).getTime()) / 1000)
          : undefined,
      };
    } catch {
      return { status: 'failed', error: 'Failed to check prediction status' };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.client.get('/models', { timeout: 5000 });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  private parseProgress(logs: string): number | undefined {
    // Replicate часто пишет прогресс в логах: "50% complete"
    const match = logs.match(/(\d+)%/);
    return match ? parseInt(match[1], 10) : undefined;
  }

  private handleError(error: any, start: number): GenerationResult {
    const status = error?.response?.status;
    return {
      success: false,
      error: {
        code: `HTTP_${status || 'UNKNOWN'}`,
        message: error?.response?.data?.detail || error.message,
        retryable: status === 429 || status >= 500,
      },
      responseTimeMs: Date.now() - start,
      providerSlug: this.slug,
    };
  }
}