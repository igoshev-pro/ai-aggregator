import { outboundAxiosConfig } from '../../../common/net/outbound-proxy';
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

/**
 * Higgsfield API (docs.higgsfield.ai) — пока только Genjutsu.
 *
 * modelId в реестре — префикс эндпоинта без режима ('higgsfield/genjutsu'),
 * режим приходит в request.mode: POST /<modelId>/<mode>/v1.0.
 * Так Genjutsu Light ('higgsfield/genjutsu-light') подключается одной записью в реестре.
 *
 * Авторизация: "Authorization: Key <id>:<secret>" (apiKey = "<id>:<secret>").
 * Ответ на создание — { request_id, status_url }, дальше опрос /requests/<id>/status.
 */
const GENJUTSU_MODES = ['motion-transfer', 'object-swap'];
const GENJUTSU_RESOLUTIONS = ['480p', '720p', '1080p'];

export class HiggsfieldProvider extends BaseProvider {
  private client: AxiosInstance;

  constructor(config: ProviderConfig) {
    super('higgsfield', config);
    this.client = axios.create({
      ...outboundAxiosConfig(),
      baseURL: config.baseUrl || 'https://api.higgsfield.ai',
      timeout: config.timeout || 60000,
      headers: {
        'Authorization': `Key ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async generateText(_request: TextGenerationRequest): Promise<GenerationResult> {
    return this.unsupported('text');
  }

  async *generateTextStream(
    _request: TextGenerationRequest,
  ): AsyncGenerator<StreamChunk> {
    yield { content: 'Text streaming not supported on Higgsfield', done: true };
  }

  async generateImage(_request: ImageGenerationRequest): Promise<GenerationResult> {
    return this.unsupported('image');
  }

  async generateAudio(_request: AudioGenerationRequest): Promise<GenerationResult> {
    return this.unsupported('audio');
  }

  async generateVideo(request: VideoGenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    try {
      const videoUrl = request.videoUrls?.[0];
      if (!videoUrl) {
        throw new Error('Genjutsu: требуется исходное видео (videoUrls[0])');
      }

      // Фото персонажа/объекта: фронт шлёт imageUrls, на всякий случай
      // принимаем и referenceImages / imageUrl. Higgsfield допускает 1–8.
      const imageUrls = [
        ...(request.imageUrls || []),
        ...(request.referenceImages || []),
        ...(request.imageUrl ? [request.imageUrl] : []),
      ]
        .filter(Boolean)
        .filter((u, i, arr) => arr.indexOf(u) === i)
        .slice(0, 8);
      if (imageUrls.length === 0) {
        throw new Error('Genjutsu: нужно хотя бы одно фото-референс');
      }

      const mode = GENJUTSU_MODES.includes(request.mode || '')
        ? request.mode
        : 'motion-transfer';
      const resolution = GENJUTSU_RESOLUTIONS.includes(request.resolution || '')
        ? request.resolution
        : '720p';

      const body: Record<string, any> = {
        video_url: videoUrl,
        image_urls: imageUrls,
        resolution,
      };
      const prompt = (request.prompt || '').trim();
      if (prompt) body.prompt = prompt.slice(0, 10000);

      const endpoint = `/${request.model}/${mode}/v1.0`;
      const headers: Record<string, string> = {};
      // Повтор задачи Bull с тем же ключом вернёт тот же request_id —
      // Higgsfield не создаст и не спишет вторую генерацию.
      if (request.idempotencyKey) headers['Idempotency-Key'] = request.idempotencyKey;

      const response = await this.client.post(endpoint, body, { headers });
      const requestId = response.data?.request_id;
      if (!requestId) {
        throw new Error(
          `Higgsfield: нет request_id в ответе (${JSON.stringify(response.data).substring(0, 300)})`,
        );
      }

      return {
        success: true,
        data: {
          taskId: requestId,
          metadata: { model: request.model, mode, resolution },
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
      const response = await this.client.get(`/requests/${taskId}/status`);
      const data = response.data || {};

      switch (data.status) {
        case 'completed': {
          const url = data.video?.url;
          if (!url) return { status: 'failed', error: 'Higgsfield: completed без video.url' };
          return { status: 'completed', progress: 100, resultUrls: [url] };
        }
        case 'failed':
          return { status: 'failed', error: data.error || 'Generation failed' };
        case 'nsfw':
          return { status: 'failed', error: 'Higgsfield: контент отклонён модерацией (nsfw)' };
        case 'canceled':
          return { status: 'failed', error: 'Higgsfield: задача отменена' };
        case 'in_progress':
          return { status: 'processing' };
        default:
          return { status: 'pending' };
      }
    } catch (error: any) {
      const status = error?.response?.status;
      // 401/404 — опрашивать дальше бессмысленно; сеть и 5xx — пусть consumer повторит
      if (status === 401 || status === 404) {
        return { status: 'failed', error: this.errorMessage(error) };
      }
      throw new Error(`Higgsfield status check failed: ${this.errorMessage(error)}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    // Отдельного health-эндпоинта нет: статус несуществующего запроса
    // отвечает 404 при верном ключе и 401 при неверном.
    try {
      await this.client.get('/requests/00000000-0000-0000-0000-000000000000/status', {
        timeout: 5000,
      });
      return true;
    } catch (error: any) {
      const status = error?.response?.status;
      return status === 404;
    }
  }

  private unsupported(kind: string): GenerationResult {
    return {
      success: false,
      error: { code: 'UNSUPPORTED', message: `Higgsfield: ${kind} not supported`, retryable: false },
      responseTimeMs: 0,
      providerSlug: this.slug,
    };
  }

  private errorMessage(error: any): string {
    const detail = error?.response?.data?.detail;
    if (Array.isArray(detail)) {
      return detail.map((d: any) => d?.msg || JSON.stringify(d)).join('; ');
    }
    if (typeof detail === 'string') return detail;
    return error?.message || 'Unknown error';
  }

  private handleError(error: any, start: number): GenerationResult {
    const status = error?.response?.status;
    const message = this.errorMessage(error);
    return {
      success: false,
      error: {
        code: `HTTP_${status || 'UNKNOWN'}`,
        // 403 у Higgsfield — закончился баланс аккаунта
        message: status === 403 ? `Higgsfield: недостаточно средств на аккаунте (${message})` : message,
        retryable: status === 423 || status === 429 || status === 503 || status >= 500,
      },
      responseTimeMs: Date.now() - start,
      providerSlug: this.slug,
    };
  }
}
