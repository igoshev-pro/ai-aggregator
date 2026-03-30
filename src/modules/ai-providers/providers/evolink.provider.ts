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
import { Logger } from '@nestjs/common';

/**
 * Evolink AI Provider
 *
 * API форматы:
 * - GPT, DeepSeek → POST /v1/chat/completions (OpenAI-compatible)
 * - Claude → POST /v1/messages (Anthropic Messages API)
 * - Images → POST /v1/images/generations (async, returns task id)
 * - Video → POST /v1/videos/generations (async, returns task id)
 * - Audio → POST /v1/audio/generations (async, returns task id)
 * - Task polling → GET /v1/tasks/{task_id}
 */

// Claude модели используют Anthropic Messages API
const CLAUDE_MODEL_PREFIXES = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-sonnet-4-5',
  'claude-opus-4-1',
  'claude-opus-4-5',
  'claude-sonnet-4-',
];

// Kling image-to-video использует поле image_start вместо image_urls
const KLING_I2V_MODELS = ['kling-v3-image-to-video'];

// Kling motion control требует image_urls + video_urls
const KLING_MOTION_MODELS = ['kling-v3-motion-control'];

export class EvolinkProvider extends BaseProvider {
  private client: AxiosInstance;
  private readonly logger = new Logger(EvolinkProvider.name);  // ← ДОБАВИТЬ

  constructor(config: ProviderConfig) {
    super('evolink', config);
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout || 120000,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  // ========================================
  // TEXT GENERATION
  // ========================================

  async generateText(request: TextGenerationRequest): Promise<GenerationResult> {
    if (this.isClaudeModel(request.model)) {
      return this.generateTextClaude(request);
    }
    return this.generateTextOpenAI(request);
  }

  async *generateTextStream(
    request: TextGenerationRequest,
  ): AsyncGenerator<StreamChunk> {
    if (this.isClaudeModel(request.model)) {
      yield* this.generateTextStreamClaude(request);
    } else {
      yield* this.generateTextStreamOpenAI(request);
    }
  }

  // --- OpenAI-compatible (GPT-5.4, DeepSeek) ---

  private async generateTextOpenAI(
    request: TextGenerationRequest,
  ): Promise<GenerationResult> {
    const start = Date.now();
    try {
      const response = await this.client.post('/chat/completions', {
        model: request.model,
        messages: request.messages,
        max_completion_tokens: request.maxTokens || 4096, 
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

  private async *generateTextStreamOpenAI(
    request: TextGenerationRequest,
  ): AsyncGenerator<StreamChunk> {
    try {
      const response = await this.client.post(
        '/chat/completions',
        {
          model: request.model,
          messages: request.messages,
          max_completion_tokens: request.maxTokens || 4096,
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
          errorMessage = parsed?.error?.message || parsed?.message || body;
        } catch {
          errorMessage = body || error.message;
        }
      } else if (error.response.data?.error?.message) {
        errorMessage = error.response.data.error.message;
      }
    }
  } catch {
    errorMessage = `HTTP ${status}: ${error.message}`;
  }

  this.logger.error(`Evolink OpenAI stream error: status=${status}, message=${errorMessage}`);
  yield { content: '', done: true, error: `Evolink: ${status || 'NETWORK'} - ${errorMessage}` };
}
        }
      }
    } catch (error) {
  const status = error?.response?.status;
  let errorMessage = error.message;

  // Безопасное извлечение ошибки — response.data может быть стримом
  try {
    if (error?.response?.data) {
      if (typeof error.response.data === 'string') {
        errorMessage = error.response.data.substring(0, 500);
      } else if (typeof error.response.data.pipe === 'function') {
        // Это стрим — читаем его
        const chunks: Buffer[] = [];
        for await (const chunk of error.response.data) {
          chunks.push(Buffer.from(chunk));
          if (chunks.length > 5) break;
        }
        const body = Buffer.concat(chunks).toString('utf8').substring(0, 500);
        try {
          const parsed = JSON.parse(body);
          errorMessage = parsed?.error?.message || parsed?.message || body;
        } catch {
          errorMessage = body || error.message;
        }
      } else if (error.response.data?.error?.message) {
        errorMessage = error.response.data.error.message;
      }
    }
  } catch {
    errorMessage = `HTTP ${status}: ${error.message}`;
  }

  this.logger.error(
    `Evolink OpenAI stream error: status=${status}, message=${errorMessage}`,
  );
  yield { content: '', done: true, error: `Evolink: ${status || 'NETWORK'} - ${errorMessage}` };
}
  }

  // --- Anthropic Messages API (Claude Sonnet 4.6, Claude Opus 4.6) ---

  private async generateTextClaude(
    request: TextGenerationRequest,
  ): Promise<GenerationResult> {
    const start = Date.now();
    try {
      const { system, messages } = this.convertToClaudeMessages(request.messages);

      const body: any = {
        model: request.model,
        messages,
        // max_tokens обязателен в Anthropic API
        max_tokens: request.maxTokens || 8192,
        stream: false,
      };

      if (system) {
        body.system = system;
      }

      // Claude temperature max = 1.0, в отличие от OpenAI (max 2.0)
      if (request.temperature !== undefined) {
        body.temperature = Math.min(request.temperature, 1.0);
      }

      const response = await this.client.post('/messages', body);
      const data = response.data;

      // Claude возвращает content как массив блоков
      const textContent =
        data.content
          ?.filter((block: any) => block.type === 'text')
          ?.map((block: any) => block.text)
          ?.join('') || '';

      return {
        success: true,
        data: {
          content: textContent,
          metadata: {
            model: data.model,
            stopReason: data.stop_reason,
          },
        },
        usage: {
          inputTokens: data.usage?.input_tokens,
          outputTokens: data.usage?.output_tokens,
          totalTokens:
            (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    } catch (error) {
      return this.handleError(error, start);
    }
  }

  private async *generateTextStreamClaude(
    request: TextGenerationRequest,
  ): AsyncGenerator<StreamChunk> {
    try {
      const { system, messages } = this.convertToClaudeMessages(request.messages);

      const body: any = {
        model: request.model,
        messages,
        max_tokens: request.maxTokens || 8192,
        stream: true,
      };

      if (system) {
        body.system = system;
      }

      if (request.temperature !== undefined) {
        body.temperature = Math.min(request.temperature, 1.0);
      }

      const response = await this.client.post('/messages', body, {
        responseType: 'stream',
        timeout: 300000,
      });

      let buffer = '';
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const chunk of response.data) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const rawData = trimmed.slice(6);

          try {
            const parsed = JSON.parse(rawData);

            switch (parsed.type) {
              case 'message_start':
                // Получаем начальные токены
                inputTokens = parsed.message?.usage?.input_tokens || 0;
                break;

              case 'content_block_delta':
                // Основной поток текста
                if (
                  parsed.delta?.type === 'text_delta' &&
                  parsed.delta?.text
                ) {
                  yield { content: parsed.delta.text, done: false };
                }
                break;

              case 'message_delta':
                // Финальная статистика
                outputTokens = parsed.usage?.output_tokens || 0;
                if (parsed.delta?.stop_reason) {
                  yield {
                    content: '',
                    done: true,
                    usage: { inputTokens, outputTokens },
                  };
                  return;
                }
                break;

              case 'message_stop':
                yield {
                  content: '',
                  done: true,
                  usage: { inputTokens, outputTokens },
                };
                return;
            }
          } catch { }
        }
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
          errorMessage = parsed?.error?.message || parsed?.message || body;
        } catch {
          errorMessage = body || error.message;
        }
      } else if (error.response.data?.error?.message) {
        errorMessage = error.response.data.error.message;
      }
    }
  } catch {
    errorMessage = `HTTP ${status}: ${error.message}`;
  }

  this.logger.error(
    `Evolink Claude stream error: status=${status}, message=${errorMessage}`,
  );
  yield { content: '', done: true, error: `Evolink Claude: ${status || 'NETWORK'} - ${errorMessage}` };
}
  }

  /**
   * Конвертирует OpenAI-style messages в формат Anthropic Messages API.
   * - system messages выносятся в отдельный параметр
   * - объединяются подряд идущие сообщения одной роли
   */
  private convertToClaudeMessages(
    messages: { role: string; content: string }[],
  ): {
    system: string | null;
    messages: { role: string; content: string }[];
  } {
    let system: string | null = null;
    const claudeMessages: { role: string; content: string }[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        system = system ? `${system}\n\n${msg.content}` : msg.content;
      } else {
        claudeMessages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content,
        });
      }
    }

    // Claude требует чередования user/assistant
    // Объединяем подряд идущие сообщения одной роли
    const merged: { role: string; content: string }[] = [];
    for (const msg of claudeMessages) {
      if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
        merged[merged.length - 1].content += '\n\n' + msg.content;
      } else {
        merged.push({ ...msg });
      }
    }

    // Claude требует что первое сообщение было от user
    if (merged.length > 0 && merged[0].role === 'assistant') {
      merged.unshift({ role: 'user', content: '...' });
    }

    // Если messages пустые — добавляем заглушку
    if (merged.length === 0) {
      merged.push({ role: 'user', content: 'Hello' });
    }

    return { system, messages: merged };
  }

  // ========================================
  // IMAGE GENERATION
  // ========================================

  async generateImage(request: ImageGenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    try {
      const body: any = {
        model: request.model,
        prompt: request.prompt,
        n: request.numImages || 1,
      };

      // Evolink images API принимает 'size' вместо width/height
      // Форматы: '1:1', '2:3', '3:2' или '1024x1024', '1024x1536', '1536x1024'
      if (request.aspectRatio) {
        body.size = request.aspectRatio;
      } else if (request.width && request.height) {
        body.size = `${request.width}x${request.height}`;
      }

      if (request.quality) {
        body.quality = request.quality; // 'low' | 'medium' | 'high' | 'auto'
      }

      // image_urls для img2img / редактирования
      if (request.inputUrls && request.inputUrls.length > 0) {
        body.image_urls = request.inputUrls;
      }

      const response = await this.client.post('/images/generations', body);
      const data = response.data;

      // Evolink images API всегда возвращает async task
      return {
        success: true,
        data: {
          taskId: data.id,
          urls: [],
          metadata: { model: request.model, status: data.status },
        },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    } catch (error) {
      return this.handleError(error, start);
    }
  }

  // ========================================
  // VIDEO GENERATION
  // ========================================

  async generateVideo(request: VideoGenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    try {
      let body: any;

      if (KLING_I2V_MODELS.includes(request.model)) {
        body = this.buildKlingI2VBody(request);
      } else if (KLING_MOTION_MODELS.includes(request.model)) {
        body = this.buildKlingMotionBody(request);
      } else {
        body = this.buildVideoBody(request);
      }

      const response = await this.client.post('/videos/generations', body);
      const data = response.data;

      return {
        success: true,
        data: {
          taskId: data.id,
          urls: [],
          metadata: { model: request.model, status: data.status },
        },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    } catch (error) {
      return this.handleError(error, start);
    }
  }

  /**
   * Общий билдер тела запроса для видео:
   * Veo 3.1 Fast, Veo 3.1 Pro, Sora 2 Pro, Kling T2V
   */
  private buildVideoBody(request: VideoGenerationRequest): any {
    const body: any = {
      model: request.model,
      prompt: request.prompt,
    };

    if (request.aspectRatio) body.aspect_ratio = request.aspectRatio;
    if (request.duration) body.duration = request.duration;
    if (request.negativePrompt) body.negative_prompt = request.negativePrompt;
    if (request.seed) body.seed = request.seed;

    // resolution маппится в quality у Evolink ('720p', '1080p')
    if (request.resolution) body.quality = request.resolution;

    // image_urls для img-to-video (Sora 2 Pro поддерживает 1 изображение)
    if (request.imageUrl) {
      body.image_urls = [request.imageUrl];
    }

    return body;
  }

  /**
   * Kling V3 Image-to-Video:
   * использует поле image_start (обязательное) + опциональное image_end
   */
  private buildKlingI2VBody(request: VideoGenerationRequest): any {
    const body: any = {
      model: request.model,
      // image_start обязателен для kling-v3-image-to-video
      image_start: request.imageUrl || '',
    };

    if (request.prompt) body.prompt = request.prompt;
    if (request.negativePrompt) body.negative_prompt = request.negativePrompt;
    if (request.duration) body.duration = request.duration;
    if (request.resolution) body.quality = request.resolution;
    if (request.aspectRatio) body.aspect_ratio = request.aspectRatio;

    return body;
  }

  /**
   * Kling V3 Motion Control:
   * требует image_urls (reference image) + video_urls (motion reference)
   */
  private buildKlingMotionBody(request: VideoGenerationRequest): any {
    const body: any = {
      model: request.model,
      // image_urls — reference image для внешности персонажа
      image_urls: request.imageUrl ? [request.imageUrl] : [],
      // video_urls передаются через metadata.videoUrls
      video_urls: (request as any).videoUrls || [],
      model_params: {
        character_orientation: 'video',
      },
    };

    if (request.prompt) body.prompt = request.prompt;
    if (request.resolution) body.quality = request.resolution;

    return body;
  }

  // ========================================
  // AUDIO GENERATION
  // ========================================

  async generateAudio(request: AudioGenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    try {
      const body: any = {
        model: request.model,
        prompt: request.prompt,
      };

      if (request.style) body.style = request.style;
      if (request.duration) body.duration = request.duration;
      if (request.instrumental !== undefined) body.instrumental = request.instrumental;
      if (request.voiceId) body.voice_id = request.voiceId;
      if (request.text) body.text = request.text;
      if (request.language) body.language = request.language;

      const response = await this.client.post('/audio/generations', body);
      const data = response.data;

      return {
        success: true,
        data: {
          taskId: data.id || data.task_id,
          urls: [],
          metadata: { model: request.model, status: data.status },
        },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    } catch (error) {
      return this.handleError(error, start);
    }
  }

  // ========================================
  // TASK STATUS POLLING
  // ========================================

  async checkTaskStatus(taskId: string): Promise<TaskStatusResult> {
    try {
      const response = await this.client.get(`/tasks/${taskId}`);
      const data = response.data;

      // Evolink task response:
      // {
      //   id: "task-unified-...",
      //   status: "pending" | "processing" | "completed" | "failed",
      //   progress: 0-100,
      //   results: ["https://..."],   <-- массив URL результатов
      //   error: { code, message, type } | null,
      //   task_info: { estimated_time, can_cancel }
      // }

      const resultUrls = Array.isArray(data.results) ? data.results : [];
      const eta = data.task_info?.estimated_time;
      const errorMessage = data.error?.message;

      return {
        status: this.mapStatus(data.status),
        progress: data.progress,
        resultUrls,
        error: errorMessage,
        eta,
      };
    } catch (error) {
      return { status: 'failed', error: 'Failed to check task status' };
    }
  }

  // ========================================
  // HEALTH CHECK
  // ========================================

  async healthCheck(): Promise<boolean> {
    try {
      // GET /v1/credits — легкий эндпоинт для проверки
      const response = await this.client.get('/credits', { timeout: 5000 });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  // ========================================
  // HELPERS
  // ========================================

  private isClaudeModel(model: string): boolean {
    return CLAUDE_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix));
  }

  private mapStatus(status: string): TaskStatusResult['status'] {
    const map: Record<string, TaskStatusResult['status']> = {
      queued: 'pending',
      pending: 'pending',
      running: 'processing',
      processing: 'processing',
      completed: 'completed',
      succeeded: 'completed',
      failed: 'failed',
      error: 'failed',
    };
    return map[status] || 'pending';
  }

  private handleError(error: any, start: number): GenerationResult {
    const status = error?.response?.status;
    const message =
      error?.response?.data?.error?.message || error.message || 'Unknown error';

    return {
      success: false,
      error: {
        code: `HTTP_${status || 'UNKNOWN'}`,
        message,
        retryable: status === 429 || (status >= 500 && status < 600),
      },
      responseTimeMs: Date.now() - start,
      providerSlug: this.slug,
    };
  }
}