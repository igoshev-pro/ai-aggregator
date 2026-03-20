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

const KIE_MODEL_PARAMS: Record<string, {
  aspectRatios: string[];
  resolutions: string[];
  hasQuality?: boolean;
  hasNegativePrompt?: boolean;
  hasSeed?: boolean;
  hasInputImages?: boolean;
  inputImagesField?: string;
  maxInputImages?: number;
  hasOutputFormat?: boolean;
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
    resolutions: ['basic', 'high'],
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

// ═══════════════════════════════════════════════════════
// VIDEO MODEL CONFIG
// ═══════════════════════════════════════════════════════
interface VideoModelConfig {
  kieModel: string;
  apiType: 'jobs' | 'runway';
  statusApiType: 'jobs' | 'runway';
  hasImageInput: boolean;
  hasSound?: boolean;
  hasMode?: boolean;
  hasSize?: boolean;
  hasRemoveWatermark?: boolean;
  hasPromptOptimizer?: boolean;
  hasResolution?: boolean;
  nFrames?: string[];
  durations?: string[];
  aspectRatios: string[];
}

const VIDEO_MODEL_MAP: Record<string, VideoModelConfig> = {
  // ── Sora 2 (modelId from providerMappings) ──
  'sora-2-text-to-video': {
    kieModel: 'sora-2-text-to-video',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: false,
    hasRemoveWatermark: true,
    nFrames: ['10', '15'],
    aspectRatios: ['portrait', 'landscape'],
  },
  'sora-2-image-to-video': {
    kieModel: 'sora-2-image-to-video',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: true,
    hasRemoveWatermark: true,
    nFrames: ['10', '15'],
    aspectRatios: ['portrait', 'landscape'],
  },

  // ── Kling 3.0 ──
  'kling-3.0/video': {
    kieModel: 'kling-3.0/video',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: true,
    hasSound: true,
    hasMode: true,
    durations: ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
    aspectRatios: ['16:9', '9:16', '1:1'],
  },
  'kling-3.0/motion-control': {
    kieModel: 'kling-3.0/motion-control',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: true,
    hasSound: false,
    hasMode: true,
    durations: ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
    aspectRatios: ['16:9', '9:16', '1:1'],
  },

  // ── Runway ──
  'runway': {
    kieModel: 'runway',
    apiType: 'runway',
    statusApiType: 'runway',
    hasImageInput: true,
    durations: ['5', '10'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
  },

  // Hailuo Standard — text to video
  'hailuo/02-text-to-video-standard': {
    kieModel: 'hailuo/02-text-to-video-standard',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: false,
    hasPromptOptimizer: true,
    durations: ['6', '10'],
    aspectRatios: [],
  },
  // Hailuo Standard — image to video
  'hailuo/2-3-image-to-video-standard': {
    kieModel: 'hailuo/2-3-image-to-video-standard',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: true,
    hasResolution: true,
    durations: ['6', '10'],
    aspectRatios: [],
  },
  // Hailuo Pro — image to video
  'hailuo/2-3-image-to-video-pro': {
    kieModel: 'hailuo/2-3-image-to-video-pro',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: true,
    hasResolution: true,
    durations: ['6', '10'],
    aspectRatios: [],
  },
  // Hailuo Pro — text to video
  'hailuo/02-text-to-video-pro': {
    kieModel: 'hailuo/02-text-to-video-pro',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: false,
    hasPromptOptimizer: true,
    durations: ['6', '10'],
    aspectRatios: [],
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

  // ═══════════════════════════════════════════════════════
  // IMAGE GENERATION (existing — unchanged)
  // ═══════════════════════════════════════════════════════
  async generateImage(request: ImageGenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    try {
      const modelId = request.model;
      const modelParams = KIE_MODEL_PARAMS[modelId];

      this.logger.debug(
        `KIE generateImage: model=${modelId}, prompt="${request.prompt?.substring(0, 60)}"`,
      );

      const input: Record<string, any> = {
        prompt: request.prompt,
      };

      const aspectRatio = this.toAspectRatio(request.width, request.height);
      input.aspect_ratio = aspectRatio;

      if (modelParams?.hasQuality) {
        input.quality = (request as any).quality || 'basic';
      } else if (modelParams?.resolutions?.length > 0) {
        input.resolution = (request as any).resolution || '1K';
      }

      if (modelParams?.hasNegativePrompt && request.negativePrompt) {
        input.negative_prompt = request.negativePrompt;
      }

      if (modelParams?.hasSeed && request.seed !== undefined) {
        input.seed = String(request.seed);
      }

      if (modelParams?.hasInputImages) {
        const inputUrls: string[] = (request as any).inputUrls || [];
        const field = modelParams.inputImagesField;
        if (field) {
          if (inputUrls.length > 0) {
            input[field] = inputUrls;
          } else if (field === 'image_input') {
            input[field] = [];
          }
        }
      }

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

      this.logger.debug(`KIE image task created: ${taskId}`);

      return {
        success: true,
        data: { taskId, urls: [], metadata: { model: modelId } },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    } catch (error) {
      this.logger.error(`KIE generateImage error: ${error.message}`);
      return this.handleError(error, start);
    }
  }

  // ═══════════════════════════════════════════════════════
  // VIDEO GENERATION — NEW
  // ═══════════════════════════════════════════════════════
  async generateVideo(request: VideoGenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    const modelSlug = request.model;

    let config = VIDEO_MODEL_MAP[modelSlug];

    if (!config) {
      return {
        success: false,
        error: { code: 'UNKNOWN_MODEL', message: `Unknown video model: ${modelSlug}`, retryable: false },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    }

    // === Динамическое переключение txt2vid ↔ img2vid ===
    const hasImage = !!(request as any).imageUrl || !!((request as any).imageUrls?.length);

    // Hailuo Standard
    if (modelSlug === 'hailuo/02-text-to-video-standard' && hasImage && VIDEO_MODEL_MAP['hailuo/2-3-image-to-video-standard']) {
      config = VIDEO_MODEL_MAP['hailuo/2-3-image-to-video-standard'];
      this.logger.debug(`Hailuo Standard: switched to img2vid (has image)`);
    }
    if (modelSlug === 'hailuo/2-3-image-to-video-standard' && !hasImage && VIDEO_MODEL_MAP['hailuo/02-text-to-video-standard']) {
      config = VIDEO_MODEL_MAP['hailuo/02-text-to-video-standard'];
      this.logger.debug(`Hailuo Standard: switched to txt2vid (no image)`);
    }

    // Hailuo Pro
    if (modelSlug === 'hailuo/2-3-image-to-video-pro' && !hasImage && VIDEO_MODEL_MAP['hailuo/02-text-to-video-pro']) {
      config = VIDEO_MODEL_MAP['hailuo/02-text-to-video-pro'];
      this.logger.debug(`Hailuo Pro: switched to txt2vid (no image)`);
    }
    if (modelSlug === 'hailuo/02-text-to-video-pro' && hasImage && VIDEO_MODEL_MAP['hailuo/2-3-image-to-video-pro']) {
      config = VIDEO_MODEL_MAP['hailuo/2-3-image-to-video-pro'];
      this.logger.debug(`Hailuo Pro: switched to img2vid (has image)`);
    }

    // Sora 2: txt2vid ↔ img2vid
    if (modelSlug === 'sora-2-text-to-video' && hasImage && VIDEO_MODEL_MAP['sora-2-image-to-video']) {
      config = VIDEO_MODEL_MAP['sora-2-image-to-video'];
      this.logger.debug(`Sora 2: switched to img2vid (has image)`);
    }
    if (modelSlug === 'sora-2-image-to-video' && !hasImage && VIDEO_MODEL_MAP['sora-2-text-to-video']) {
      config = VIDEO_MODEL_MAP['sora-2-text-to-video'];
      this.logger.debug(`Sora 2: switched to txt2vid (no image)`);
    }

    this.logger.log(`KIE generateVideo: slug=${modelSlug}, kieModel=${config.kieModel}, hasImage=${hasImage}`);

    try {
      if (config.apiType === 'runway') {
        return await this.generateRunwayVideo(request, config, start);
      }
      return await this.generateJobsVideo(request, config, start);
    } catch (error) {
      this.logger.error(`KIE generateVideo error: ${error.message}`);
      return this.handleError(error, start);
    }
  }

  // ── Jobs API video (Sora, Kling, Hailuo) ──
  private async generateJobsVideo(
    request: VideoGenerationRequest,
    config: VideoModelConfig,
    start: number,
  ): Promise<GenerationResult> {
    const r = request as any;
    const input: Record<string, any> = {
      prompt: request.prompt,
    };

    // Aspect ratio
    if (config.aspectRatios.length > 0) {
      let ar = r.aspectRatio || config.aspectRatios[0];
      // Sora uses portrait/landscape
      if (config.aspectRatios.includes('portrait') && !config.aspectRatios.includes(ar)) {
        ar = ar === '9:16' ? 'portrait' : 'landscape';
      }
      input.aspect_ratio = ar;
    }

    // Duration / n_frames
    if (config.nFrames) {
      // Sora: n_frames = '10' or '15' (seconds → closest frame option)
      const dur = r.duration || 10;
      input.n_frames = dur >= 13 ? '15' : '10';
    } else if (config.durations) {
      input.duration = String(r.duration || config.durations[0]);
    }

    // Image input
    if (config.hasImageInput && r.imageUrl) {
      input.image_urls = [r.imageUrl];
    }
    if (config.hasImageInput && r.imageUrls?.length > 0) {
      input.image_urls = r.imageUrls;
    }

    // Kling-specific
    if (config.hasSound) {
      input.sound = r.sound !== undefined ? r.sound : false;
    }
    if (config.hasMode) {
      input.mode = r.mode || 'std';
      // Kling requires these fields
      input.multi_shots = false;
      input.multi_prompt = [];
    }

    // Sora Pro size
    if (config.hasSize) {
      input.size = r.quality || 'standard';
    }

    // Remove watermark (Sora)
    if (config.hasRemoveWatermark) {
      input.remove_watermark = r.removeWatermark !== false;
    }

    // Hailuo prompt optimizer
    if (config.hasPromptOptimizer) {
      input.prompt_optimizer = r.promptOptimizer !== false;
    }

    // Hailuo resolution
    if (config.hasResolution) {
      input.resolution = r.resolution || '768P';
    }

    this.logger.debug(`KIE jobs video request: model=${config.kieModel}, input=${JSON.stringify(input).substring(0, 200)}`);

    const response = await this.client.post('/api/v1/jobs/createTask', {
      model: config.kieModel,
      input,
    });

    const data = response.data;
    if (data.code !== 200) {
      throw new Error(data.msg || `KIE video task creation failed (code ${data.code})`);
    }

    const taskId = data.data?.taskId;
    if (!taskId) {
      throw new Error('No taskId in KIE video response');
    }

    this.logger.log(`KIE video task created: ${taskId} for model ${config.kieModel}`);

    return {
      success: true,
      data: {
        taskId,
        urls: [],
        metadata: { model: config.kieModel, apiType: config.statusApiType },
      },
      responseTimeMs: Date.now() - start,
      providerSlug: this.slug,
    };
  }

  // ── Runway API video ──
  private async generateRunwayVideo(
    request: VideoGenerationRequest,
    config: VideoModelConfig,
    start: number,
  ): Promise<GenerationResult> {
    const r = request as any;
    const body: Record<string, any> = {
      prompt: request.prompt,
      duration: r.duration || 5,
      quality: r.resolution || '720p',
      aspectRatio: r.aspectRatio || '16:9',
      waterMark: r.waterMark || '',
    };

    // Image input
    if (r.imageUrl) {
      body.imageUrl = r.imageUrl;
    }

    this.logger.debug(`KIE runway video request: ${JSON.stringify(body).substring(0, 200)}`);

    const response = await this.client.post('/api/v1/runway/generate', body);

    const data = response.data;
    if (data.code !== 200) {
      throw new Error(data.msg || `Runway video creation failed (code ${data.code})`);
    }

    const taskId = data.data?.taskId;
    if (!taskId) {
      throw new Error('No taskId in Runway response');
    }

    this.logger.log(`Runway video task created: ${taskId}`);

    return {
      success: true,
      data: {
        taskId,
        urls: [],
        metadata: { model: 'runway', apiType: 'runway' },
      },
      responseTimeMs: Date.now() - start,
      providerSlug: this.slug,
    };
  }

  // ═══════════════════════════════════════════════════════
  // TASK STATUS CHECK — handles both Jobs and Runway APIs
  // ═══════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════
  // TASK STATUS CHECK — handles Jobs, Runway, Suno, ElevenLabs
  // ═══════════════════════════════════════════════════════
  async checkTaskStatus(taskId: string): Promise<TaskStatusResult> {
    // Runway tasks — UUID format
    const isRunway = taskId.includes('runway') ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(taskId);

    if (isRunway) {
      return await this.checkRunwayTaskStatus(taskId);
    }

    // ElevenLabs tasks
    if (taskId.startsWith('task_elevenlabs_')) {
      return await this.checkElevenLabsTaskStatus(taskId);
    }

    // Сначала пробуем Suno endpoint, если он вернёт данные — используем их
    // Suno taskId — обычный hex строка (32 символа), но Jobs тоже
    // Поэтому пробуем Jobs API (он работает для всех KIE задач)
    // Suno задачи тоже можно проверять через /api/v1/generate/record-info
    const jobsResult = await this.checkJobsTaskStatus(taskId);

    // Если Jobs API вернул completed но без URL — пробуем Suno endpoint
    if (jobsResult.status === 'completed' && (!jobsResult.resultUrls || jobsResult.resultUrls.length === 0)) {
      this.logger.debug(`Jobs returned completed but no URLs for ${taskId}, trying Suno endpoint...`);
      const sunoResult = await this.checkSunoTaskStatus(taskId);
      if (sunoResult.resultUrls && sunoResult.resultUrls.length > 0) {
        return sunoResult;
      }
    }

    return jobsResult;
  }

  private async checkElevenLabsTaskStatus(taskId: string): Promise<TaskStatusResult> {
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

      this.logger.debug(`ElevenLabs task ${taskId} state: ${task.state}, progress: ${task.progress}`);

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
      this.logger.error(`ElevenLabs check task status error: ${error.message}`);
      return {
        status: 'failed',
        error: `Status check failed: ${error.message}`,
      };
    }
  }

    private async checkSunoTaskStatus(taskId: string): Promise<TaskStatusResult> {
    try {
      const response = await this.client.get('/api/v1/generate/record-info', {
        params: { taskId },
      });
      const data = response.data;

      this.logger.log(`Suno task ${taskId} raw response code=${data.code}, keys=${data.data ? Object.keys(data.data).join(',') : 'null'}`);

      if (data.code !== 200) {
        return { status: 'pending' };
      }

      const task = data.data;
      if (!task) {
        return { status: 'pending' };
      }

      this.logger.log(`Suno task ${taskId} FULL: ${JSON.stringify(task).substring(0, 1500)}`);

      const state = task.status || task.state;
      this.logger.debug(`Suno task ${taskId} state: ${state}`);

      const stateMap: Record<string, TaskStatusResult['status']> = {
        PENDING: 'pending',
        TEXT_SUCCESS: 'processing',
        FIRST_SUCCESS: 'processing',
        SUCCESS: 'completed',
        CREATE_TASK_FAILED: 'failed',
        GENERATE_AUDIO_FAILED: 'failed',
        CALLBACK_EXCEPTION: 'failed',
        SENSITIVE_WORD_ERROR: 'failed',
        // KIE standard states (fallback)
        waiting: 'pending',
        queuing: 'pending',
        generating: 'processing',
        success: 'completed',
        fail: 'failed',
      };

      const status = stateMap[state] || 'pending';

      if (status === 'failed') {
        return {
          status: 'failed',
          error: task.errorMessage || task.failMsg || 'Audio generation failed',
        };
      }

      if (status === 'completed') {
        let resultUrls: string[] = [];

        // Suno возвращает data.data.data с массивом треков
        if (Array.isArray(task.data)) {
          resultUrls = task.data
            .map((track: any) => track.audio_url || track.source_audio_url || track.url)
            .filter(Boolean);

          this.logger.log(`Suno task ${taskId}: found ${resultUrls.length} tracks from task.data array`);
        }

        // Fallback: resultUrls напрямую
        if (resultUrls.length === 0 && Array.isArray(task.resultUrls) && task.resultUrls.length > 0) {
          resultUrls = task.resultUrls;
        }

        // Fallback: resultJson
        if (resultUrls.length === 0 && task.resultJson) {
          try {
            const parsed = typeof task.resultJson === 'string'
              ? JSON.parse(task.resultJson)
              : task.resultJson;

            this.logger.log(`Suno task ${taskId} resultJson keys: ${Object.keys(parsed).join(',')}`);

            if (Array.isArray(parsed.resultUrls) && parsed.resultUrls.length > 0) {
              resultUrls = parsed.resultUrls;
            } else if (Array.isArray(parsed.data)) {
              resultUrls = parsed.data
                .map((track: any) => track.audio_url || track.source_audio_url || track.url)
                .filter(Boolean);
            } else if (Array.isArray(parsed.urls) && parsed.urls.length > 0) {
              resultUrls = parsed.urls;
            } else if (parsed.url) {
              resultUrls = [parsed.url];
            }
          } catch (e) {
            this.logger.error(`Suno task ${taskId}: failed to parse resultJson`);
          }
        }

        // Последний шанс — ищем URL-ы в полном ответе
        if (resultUrls.length === 0) {
          const fullJson = JSON.stringify(task);
          const urlMatches = fullJson.match(/https?:\/\/[^\s"',}\]]+\.(mp3|wav|ogg|m4a|flac|mp4|aac)/gi);
          if (urlMatches && urlMatches.length > 0) {
            resultUrls = [...new Set(urlMatches)]; // dedupe
            this.logger.log(`Suno task ${taskId}: extracted ${resultUrls.length} audio URLs via regex`);
          }
        }

        this.logger.log(`Suno task ${taskId} completed. Final URLs (${resultUrls.length}): ${JSON.stringify(resultUrls).substring(0, 500)}`);

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
      this.logger.warn(`Suno check task status error for ${taskId}: ${error.message}`);
      return { status: 'pending' };
    }
  }

  // ═══════════════════════════════════════════════════════
  // AUDIO GENERATION — extended to support ElevenLabs models
  // ═══════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════
  // AUDIO GENERATION — supports Suno + ElevenLabs + ai-music-api mapping
  // ═══════════════════════════════════════════════════════
  async generateAudio(request: AudioGenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    try {
      const modelId = request.model;

      this.logger.log(`KIE generateAudio: received modelId="${modelId}"`);

      const elevenLabsModels = new Set([
        'elevenlabs/audio-isolation',
        'elevenlabs/sound-effect-v2',
        'elevenlabs/speech-to-text',
        'elevenlabs/text-to-dialogue-v3',
        'elevenlabs/text-to-speech-multilingual-v2',
        'elevenlabs/text-to-speech-turbo-2-5',
      ]);

      const sunoModels = new Set([
        'suno-v3',
        'suno-v4',
        'suno-v4_5',
        'suno-v4_5plus',
        'suno-v4_5all',
        'suno-v5',
        // KIE seed может подставлять эти modelId через providerMappings
        'ai-music-api/generate',
        'ai-music-api/generate/v4',
        'ai-music-api/generate/v4.5',
      ]);

      // ── Маппинг ai-music-api → suno model name для KIE API ──
      const sunoModelMap: Record<string, string> = {
        'ai-music-api/generate': 'V4',
        'ai-music-api/generate/v4': 'V4',
        'ai-music-api/generate/v4.5': 'V4_5',
        'suno-v3': 'V3_5',
        'suno-v4': 'V4',
        'suno-v4_5': 'V4_5',
        'suno-v4_5plus': 'V4_5PLUS',
        'suno-v4_5all': 'V4_5ALL',
        'suno-v5': 'V5',
      };

      if (elevenLabsModels.has(modelId)) {
        this.logger.debug(`KIE generateAudio: using ElevenLabs model=${modelId}`);

        const inputRaw = request as any;
        const input: Record<string, any> = {};

        switch (modelId) {
          case 'elevenlabs/audio-isolation':
          case 'elevenlabs/speech-to-text':
            if (!inputRaw.audio_url) throw new Error('audio_url is required for ' + modelId);
            input.audio_url = inputRaw.audio_url;
            if (modelId === 'elevenlabs/speech-to-text') {
              if (inputRaw.language_code) input.language_code = inputRaw.language_code;
              if (typeof inputRaw.tag_audio_events === 'boolean') input.tag_audio_events = inputRaw.tag_audio_events;
              if (typeof inputRaw.diarize === 'boolean') input.diarize = inputRaw.diarize;
            }
            break;

          case 'elevenlabs/sound-effect-v2':
            if (!inputRaw.text) throw new Error('text is required for sound-effect-v2');
            input.text = inputRaw.text;
            input.loop = inputRaw.loop ?? false;
            input.duration_seconds = inputRaw.duration_seconds ?? 5;
            input.prompt_influence = inputRaw.prompt_influence ?? 0.3;
            input.output_format = inputRaw.output_format ?? 'mp3_44100_128';
            break;

          case 'elevenlabs/text-to-dialogue-v3':
            if (!Array.isArray(inputRaw.dialogue)) throw new Error('dialogue array is required for text-to-dialogue-v3');
            input.dialogue = inputRaw.dialogue;
            input.stability = inputRaw.stability ?? 0.5;
            break;

          case 'elevenlabs/text-to-speech-multilingual-v2':
          case 'elevenlabs/text-to-speech-turbo-2-5':
            if (!inputRaw.text) throw new Error('text is required for text-to-speech models');
            input.text = inputRaw.text;
            input.voice = inputRaw.voice;
            input.stability = inputRaw.stability ?? 0.5;
            input.similarity_boost = inputRaw.similarity_boost ?? 0.75;
            input.style = inputRaw.style ?? 0;
            input.speed = inputRaw.speed ?? 1;
            input.timestamps = inputRaw.timestamps ?? false;
            input.previous_text = inputRaw.previous_text ?? '';
            input.next_text = inputRaw.next_text ?? '';
            input.language_code = inputRaw.language_code ?? '';
            break;

          default:
            throw new Error(`Model ${modelId} not supported by ElevenLabs audio generation`);
        }

        const requestBody: any = {
          model: modelId,
          input,
        };

        if (inputRaw.callBackUrl) requestBody.callBackUrl = inputRaw.callBackUrl;

        this.logger.debug(`Sending request to KIE ElevenLabs audio model: ${JSON.stringify(requestBody).substring(0, 300)}`);

        const response = await this.client.post('/api/v1/jobs/createTask', requestBody);

        const data = response.data;
        if (data.code !== 200) throw new Error(data.msg || 'KIE ElevenLabs audio task creation failed');

        const taskId = data.data?.taskId;
        if (!taskId) throw new Error('No taskId in KIE ElevenLabs audio response');

        this.logger.debug(`KIE ElevenLabs audio task created: ${taskId}`);

        return {
          success: true,
          data: { taskId, urls: [], metadata: { model: modelId } },
          responseTimeMs: Date.now() - start,
          providerSlug: this.slug,
        };

      } else if (sunoModels.has(modelId)) {
        // Определяем правильное имя модели для KIE Suno API
        const sunoModel = sunoModelMap[modelId] || modelId;

        this.logger.debug(`KIE generateAudio: using Suno model=${modelId} → mapped to ${sunoModel}`);

        const input = request as any;
        const body: any = {
          prompt: input.prompt,
          customMode: input.customMode || false,
          instrumental: input.instrumental || false,
          model: sunoModel,
          callBackUrl: input.callBackUrl || 'https://spichki.tw1.ru/api/v1/webhooks/kie-callback',
          style: input.style,
          title: input.title,
          negativeTags: input.negativeTags,
          vocalGender: input.vocalGender,
          styleWeight: input.styleWeight,
          weirdnessConstraint: input.weirdnessConstraint,
          audioWeight: input.audioWeight,
          personaId: input.personaId,
          uploadUrl: input.uploadUrl,
          duration: input.duration,
        };

        this.logger.debug(`Sending request to KIE Suno audio model: ${JSON.stringify(body).substring(0, 300)}`);

        const response = await this.client.post('/api/v1/generate', body);

        const data = response.data;
        if (data.code !== 200) {
          throw new Error(data.msg || 'KIE Suno audio task creation failed');
        }

        const taskId = data.data?.taskId;
        if (!taskId) {
          throw new Error('No taskId in KIE Suno audio response');
        }

        this.logger.log(`KIE Suno audio task created: ${taskId} (model: ${sunoModel})`);

        return {
          success: true,
          data: { taskId, urls: [], metadata: { model: sunoModel, apiType: 'suno' } },
          responseTimeMs: Date.now() - start,
          providerSlug: this.slug,
        };
      }

      // Не распознана модель
      this.logger.error(`KIE generateAudio: unknown model "${modelId}". Known elevenlabs: [${[...elevenLabsModels].join(', ')}]. Known suno: [${[...sunoModels].join(', ')}]`);

      return {
        success: false,
        error: { code: 'NOT_IMPLEMENTED', message: `Audio generation for model ${modelId} not implemented`, retryable: false },
        responseTimeMs: 0,
        providerSlug: this.slug,
      };
    } catch (error) {
      this.logger.error(`KIE generateAudio error: ${error.message}`);
      return this.handleError(error, start);
    }
  }

  async generateLyrics(prompt: string, callBackUrl: string): Promise<string> {
  try {
    const response = await this.client.post('/api/v1/lyrics', {
      prompt,
      callBackUrl,
    });
    const data = response.data;
    if (data.code !== 200) {
      throw new Error(data.msg || 'Lyrics generation failed');
    }
    return data.data.taskId;
  } catch (error) {
    this.logger.error(`KIE generateLyrics error: ${error.message}`);
    throw error;
  }
}

async getLyricsTaskStatus(taskId: string): Promise<TaskStatusResult> {
  try {
    const response = await this.client.get('/api/v1/lyrics/record-info', { params: { taskId } });
    const data = response.data;
    if (data.code !== 200) {
      return { status: 'failed', error: data.msg || 'Failed to get lyrics task status' };
    }
    const task = data.data;
    if (!task) {
      return { status: 'pending' };
    }
    const statusMap: Record<string, TaskStatusResult['status']> = {
      PENDING: 'pending',
      SUCCESS: 'completed',
      CREATE_TASK_FAILED: 'failed',
      GENERATE_LYRICS_FAILED: 'failed',
      CALLBACK_EXCEPTION: 'failed',
      SENSITIVE_WORD_ERROR: 'failed',
    };
    const status = statusMap[task.status] || 'pending';
    if (status === 'failed') {
      return { status: 'failed', error: task.errorMessage || 'Lyrics generation failed' };
    }
    if (status === 'completed') {
      return {
        status: 'completed',
        resultUrls: [], // optionally lyrics data can be fetched separately
        progress: 100,
      };
    }
    return { status, progress: task.progress || 0 };
  } catch (error) {
    this.logger.error(`KIE getLyricsTaskStatus error: ${error.message}`);
    return { status: 'failed', error: error.message };
  }
}

  // ═══════════════════════════════════════════════════════
  // TEXT (stub)
  // ═══════════════════════════════════════════════════════
  async generateText(request: TextGenerationRequest): Promise<GenerationResult> {
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

  // ═══════════════════════════════════════════════════════
  // HEALTH CHECK
  // ═══════════════════════════════════════════════════════
  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.client.get('/api/v1/jobs/recordInfo', {
        params: { taskId: 'health_check_test' },
        timeout: 5000,
      });
      this.logger.debug(`KIE health OK: status=${res.status}, code=${res.data?.code}`);
      return true;
    } catch (error) {
      const status = error?.response?.status;
      if (status) {
        this.logger.debug(`KIE health OK (error response): status=${status}`);
        return true;
      }
      this.logger.warn(`KIE health FAIL (network error): ${error.message}`);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════
  private toAspectRatio(width?: number, height?: number): string {
    if (!width || !height) return '1:1';
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    const g = gcd(width, height);
    return `${width / g}:${height / g}`;
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

    private async checkRunwayTaskStatus(taskId: string): Promise<TaskStatusResult> {
    try {
      const response = await this.client.get('/api/v1/runway/status', { params: { taskId } });
      const data = response.data;
      if (data.code !== 200) {
        return { status: 'failed', error: data.msg || 'Failed to get runway task status' };
      }
      const task = data.data;
      if (!task) {
        return { status: 'pending' };
      }

      // ═══ ПОЛНЫЙ ЛОГ ═══
      this.logger.debug(
        `Runway task ${taskId} FULL RESPONSE: ${JSON.stringify(task).substring(0, 1000)}`,
      );

      const stateMap: Record<string, TaskStatusResult['status']> = {
        waiting: 'pending',
        queued: 'pending',
        running: 'processing',
        succeeded: 'completed',
        failed: 'failed',
      };
      const status = stateMap[task.state] || 'pending';
      
      if (status === 'failed') {
        return { status: 'failed', error: task.errorMessage || 'Runway generation failed' };
      }
      
      if (status === 'completed') {
        let resultUrls: string[] = task.resultUrls || [];
        
        if (resultUrls.length === 0) {
          // Пробуем альтернативные поля
          if (task.output?.url) resultUrls = [task.output.url];
          else if (task.url) resultUrls = [task.url];
          else if (task.video_url) resultUrls = [task.video_url];

          this.logger.warn(
            `Runway task ${taskId} completed. Keys: ${Object.keys(task).join(', ')}. Found URLs: ${resultUrls.length}`,
          );
        }

        return { status: 'completed', resultUrls, progress: 100 };
      }
      
      return { status, progress: task.progress || 0 };
    } catch (error) {
      this.logger.error(`Runway check task status error: ${error.message}`);
      return { status: 'failed', error: `Status check failed: ${error.message}` };
    }
  }

    private async checkJobsTaskStatus(taskId: string): Promise<TaskStatusResult> {
    try {
      const response = await this.client.get('/api/v1/jobs/recordInfo', { params: { taskId } });
      const data = response.data;
      if (data.code !== 200) {
        return { status: 'failed', error: data.msg || 'Failed to get jobs task status' };
      }
      const task = data.data;
      if (!task) {
        return { status: 'pending' };
      }

      // ═══ ДОБАВЛЕН ПОЛНЫЙ ЛОГ ОТВЕТА ═══
      this.logger.debug(
        `Jobs task ${taskId} FULL RESPONSE: ${JSON.stringify(task).substring(0, 1000)}`,
      );

      this.logger.debug(`Jobs task ${taskId} state: ${task.state}, progress: ${task.progress}`);
      
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
        // ═══ РАСШИРЕННЫЙ ПОИСК URL-ов ═══
        // KIE может возвращать результаты в разных полях
        let resultUrls: string[] = [];

        // 1. task.resultUrls — стандартное поле
        if (task.resultUrls?.length > 0) {
          resultUrls = task.resultUrls;
        }
        // 2. task.output — некоторые модели
        else if (task.output?.urls?.length > 0) {
          resultUrls = task.output.urls;
        }
        else if (typeof task.output === 'string' && task.output.startsWith('http')) {
          resultUrls = [task.output];
        }
        else if (Array.isArray(task.output)) {
          resultUrls = task.output.filter((u: any) => typeof u === 'string' && u.startsWith('http'));
        }
        // 3. task.result — альтернативное поле
        else if (task.result?.urls?.length > 0) {
          resultUrls = task.result.urls;
        }
        else if (typeof task.result === 'string' && task.result.startsWith('http')) {
          resultUrls = [task.result];
        }
        else if (Array.isArray(task.result)) {
          resultUrls = task.result.filter((u: any) => typeof u === 'string' && u.startsWith('http'));
        }
        // 4. task.images / task.videos / task.audio
        else if (task.images?.length > 0) {
          resultUrls = task.images.map((img: any) => typeof img === 'string' ? img : img.url).filter(Boolean);
        }
        else if (task.videos?.length > 0) {
          resultUrls = task.videos.map((v: any) => typeof v === 'string' ? v : v.url).filter(Boolean);
        }
        // 5. task.url — единичный результат
        else if (task.url) {
          resultUrls = [task.url];
        }
        // 6. task.image_url / task.video_url / task.audio_url
        else if (task.image_url) {
          resultUrls = [task.image_url];
        }
        else if (task.video_url) {
          resultUrls = [task.video_url];
        }
        else if (task.audio_url) {
          resultUrls = [task.audio_url];
        }
        // 7. task.data — вложенный объект
        else if (task.data?.urls?.length > 0) {
          resultUrls = task.data.urls;
        }
        else if (task.data?.url) {
          resultUrls = [task.data.url];
        }
        // 8. task.resultJson — строка JSON
        else if (task.resultJson) {
          try {
            const parsed = JSON.parse(task.resultJson);
            if (parsed.resultUrls?.length > 0) {
              resultUrls = parsed.resultUrls;
            } else if (parsed.urls?.length > 0) {
              resultUrls = parsed.urls;
            } else if (parsed.url) {
              resultUrls = [parsed.url];
            } else if (parsed.images?.length > 0) {
              resultUrls = parsed.images.map((img: any) => typeof img === 'string' ? img : img.url).filter(Boolean);
            }
          } catch {
            this.logger.error(`Failed to parse resultJson: ${task.resultJson?.substring(0, 200)}`);
          }
        }

        this.logger.log(
          `Jobs task ${taskId} completed. Found ${resultUrls.length} URLs: ${JSON.stringify(resultUrls).substring(0, 300)}`,
        );

        if (resultUrls.length === 0) {
          this.logger.warn(
            `Jobs task ${taskId} completed but NO URLs found! Full task keys: ${Object.keys(task).join(', ')}`,
          );
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
      this.logger.error(`Jobs check task status error: ${error.message}`);
      return {
        status: 'failed',
        error: `Status check failed: ${error.message}`,
      };
    }
  }
}