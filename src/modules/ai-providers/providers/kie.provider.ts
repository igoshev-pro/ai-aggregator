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

    // Сначала пробуем Jobs API
    const jobsResult = await this.checkJobsTaskStatus(taskId);

    // Если Jobs вернул ошибку "recordInfo is null" — это Suno задача
    if (jobsResult.status === 'failed' && jobsResult.error?.includes('recordInfo is null')) {
      this.logger.debug(`Jobs API returned null for ${taskId}, trying Suno endpoint...`);
      return await this.checkSunoTaskStatus(taskId);
    }

    // Если Jobs вернул completed но без URL — тоже пробуем Suno
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

      if (data.code !== 200) {
        return { status: 'pending' };
      }

      const task = data.data;
      if (!task) {
        return { status: 'pending' };
      }

      const state = task.status;
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
      };

      const status = stateMap[state] || 'pending';

      if (status === 'failed') {
        return {
          status: 'failed',
          error: task.errorMessage || 'Audio generation failed',
        };
      }

      if (status === 'completed') {
        let resultUrls: string[] = [];

        // Реальная структура: task.response.sunoData[].audioUrl
        const sunoData = task.response?.sunoData;
        if (Array.isArray(sunoData) && sunoData.length > 0) {
          resultUrls = sunoData
            .map((track: any) => track.audioUrl || track.sourceAudioUrl)
            .filter(Boolean);
          this.logger.log(`Suno task ${taskId}: found ${resultUrls.length} tracks`);
        }

        // Fallback: task.data array
        if (resultUrls.length === 0 && Array.isArray(task.data)) {
          resultUrls = task.data
            .map((track: any) => track.audio_url || track.audioUrl || track.url)
            .filter(Boolean);
        }

        this.logger.log(`Suno task ${taskId} completed. URLs: ${JSON.stringify(resultUrls).substring(0, 300)}`);

        return {
          status: 'completed',
          resultUrls,
          progress: 100,
        };
      }

      return {
        status,
        progress: 0,
      };
    } catch (error) {
      this.logger.warn(`Suno check error for ${taskId}: ${error.message}`);
      return { status: 'pending' };
    }
  }

  // ═══════════════════════════════════════════════════════
  // AUDIO GENERATION — extended to support ElevenLabs models
  // ═══════════════════════════════════════════════════════

  //   async generateAudio(request: AudioGenerationRequest): Promise<GenerationResult> {
  //   const start = Date.now();
  //   try {
  //     const modelId = request.model;
  //     const r = request as any;

  //     this.logger.log(`KIE generateAudio: received modelId="${modelId}"`);

  //     const elevenLabsModels = new Set([
  //       'elevenlabs/audio-isolation',
  //       'elevenlabs/sound-effect-v2',
  //       'elevenlabs/speech-to-text',
  //       'elevenlabs/text-to-dialogue-v3',
  //       'elevenlabs/text-to-speech-multilingual-v2',
  //       'elevenlabs/text-to-speech-turbo-2-5',
  //     ]);

  //     const sunoModels = new Set([
  //       'suno-v3',
  //       'suno-v4',
  //       'suno-v4_5',
  //       'suno-v4_5plus',
  //       'suno-v4_5all',
  //       'suno-v5',
  //       'ai-music-api/generate',
  //       'ai-music-api/generate/v4',
  //       'ai-music-api/generate/v4.5',
  //     ]);

  //     const sunoModelMap: Record<string, string> = {
  //       'ai-music-api/generate': 'V4',
  //       'ai-music-api/generate/v4': 'V4',
  //       'ai-music-api/generate/v4.5': 'V4_5',
  //       'suno-v3': 'V3_5',
  //       'suno-v4': 'V4',
  //       'suno-v4_5': 'V4_5',
  //       'suno-v4_5plus': 'V4_5PLUS',
  //       'suno-v4_5all': 'V4_5ALL',
  //       'suno-v5': 'V5',
  //     };

  //     if (elevenLabsModels.has(modelId)) {
  //       this.logger.debug(`KIE generateAudio: using ElevenLabs model=${modelId}`);

  //       const input: Record<string, any> = {};

  //       // Берём текст из любого доступного поля
  //       const textValue = r.text || r.prompt || request.prompt || '';
  //       const audioUrl = r.audio_url || r.audioUrl || '';
  //       const voiceValue = r.voice || r.voiceId || 'Rachel';
  //       const langValue = r.language_code || r.language || '';
  //       const stabilityValue = r.stability ?? 0.5;
  //       const similarityValue = r.similarity_boost ?? r.similarity ?? 0.75;

  //       switch (modelId) {
  //         case 'elevenlabs/audio-isolation':
  //           if (!audioUrl) throw new Error('audio_url is required for audio-isolation');
  //           input.audio_url = audioUrl;
  //           break;

  //         case 'elevenlabs/speech-to-text':
  //           if (!audioUrl) throw new Error('audio_url is required for speech-to-text');
  //           input.audio_url = audioUrl;
  //           if (langValue) input.language_code = langValue;
  //           if (typeof r.tag_audio_events === 'boolean') input.tag_audio_events = r.tag_audio_events;
  //           if (typeof r.diarize === 'boolean') input.diarize = r.diarize;
  //           break;

  //         case 'elevenlabs/sound-effect-v2':
  //           if (!textValue) throw new Error('text is required for sound-effect-v2');
  //           input.text = textValue;
  //           input.loop = r.loop ?? false;
  //           input.duration_seconds = r.duration_seconds ?? r.duration ?? 5;
  //           input.prompt_influence = r.prompt_influence ?? 0.3;
  //           input.output_format = r.output_format ?? 'mp3_44100_128';
  //           break;

  //         case 'elevenlabs/text-to-dialogue-v3':
  //           if (!Array.isArray(r.dialogue)) throw new Error('dialogue array is required for text-to-dialogue-v3');
  //           input.dialogue = r.dialogue;
  //           input.stability = stabilityValue;
  //           break;

  //         case 'elevenlabs/text-to-speech-multilingual-v2':
  //         case 'elevenlabs/text-to-speech-turbo-2-5':
  //           if (!textValue) throw new Error('text is required for text-to-speech models');
  //           input.text = textValue;
  //           input.voice = voiceValue;
  //           input.stability = stabilityValue;
  //           input.similarity_boost = similarityValue;
  //           input.style = r.style ?? 0;
  //           input.speed = r.speed ?? 1;
  //           input.timestamps = r.timestamps ?? false;
  //           input.previous_text = r.previous_text ?? '';
  //           input.next_text = r.next_text ?? '';
  //           input.language_code = langValue;
  //           break;

  //         default:
  //           throw new Error(`Model ${modelId} not supported`);
  //       }

  //       const requestBody: any = { model: modelId, input };
  //       if (r.callBackUrl) requestBody.callBackUrl = r.callBackUrl;

  //       this.logger.debug(`Sending request to KIE ElevenLabs: ${JSON.stringify(requestBody).substring(0, 300)}`);

  //       const response = await this.client.post('/api/v1/jobs/createTask', requestBody);
  //       const data = response.data;

  //       if (data.code !== 200) throw new Error(data.msg || 'KIE ElevenLabs task creation failed');

  //       const taskId = data.data?.taskId;
  //       if (!taskId) throw new Error('No taskId in KIE ElevenLabs response');

  //       this.logger.log(`KIE ElevenLabs task created: ${taskId} (model: ${modelId})`);

  //       return {
  //         success: true,
  //         data: { taskId, urls: [], metadata: { model: modelId } },
  //         responseTimeMs: Date.now() - start,
  //         providerSlug: this.slug,
  //       };

  //     } else if (sunoModels.has(modelId)) {
  //       const sunoModel = sunoModelMap[modelId] || modelId;
  //       this.logger.debug(`KIE generateAudio: using Suno model=${modelId} → mapped to ${sunoModel}`);

  //       const body: any = {
  //         prompt: r.prompt || request.prompt,
  //         customMode: r.customMode || false,
  //         instrumental: r.instrumental || false,
  //         model: sunoModel,
  //         callBackUrl: r.callBackUrl || 'https://spichki.tw1.ru/api/v1/webhooks/kie-callback',
  //         style: r.style,
  //         title: r.title,
  //         negativeTags: r.negativeTags,
  //         vocalGender: r.vocalGender,
  //         styleWeight: r.styleWeight,
  //         weirdnessConstraint: r.weirdnessConstraint,
  //         audioWeight: r.audioWeight,
  //         personaId: r.personaId,
  //         uploadUrl: r.uploadUrl,
  //         duration: r.duration,
  //       };

  //       this.logger.debug(`Sending request to KIE Suno: ${JSON.stringify(body).substring(0, 300)}`);

  //       const response = await this.client.post('/api/v1/generate', body);
  //       const data = response.data;

  //       if (data.code !== 200) throw new Error(data.msg || 'KIE Suno task creation failed');

  //       const taskId = data.data?.taskId;
  //       if (!taskId) throw new Error('No taskId in KIE Suno response');

  //       this.logger.log(`KIE Suno task created: ${taskId} (model: ${sunoModel})`);

  //       return {
  //         success: true,
  //         data: { taskId, urls: [], metadata: { model: sunoModel, apiType: 'suno' } },
  //         responseTimeMs: Date.now() - start,
  //         providerSlug: this.slug,
  //       };
  //     }

  //     this.logger.error(`KIE generateAudio: unknown model "${modelId}"`);
  //     return {
  //       success: false,
  //       error: { code: 'NOT_IMPLEMENTED', message: `Audio model ${modelId} not implemented`, retryable: false },
  //       responseTimeMs: 0,
  //       providerSlug: this.slug,
  //     };
  //   } catch (error) {
  //     this.logger.error(`KIE generateAudio error: ${error.message}`);
  //     return this.handleError(error, start);
  //   }
  // }

    async generateAudio(request: AudioGenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    try {
      const modelId = request.model;
      const r = request as any;

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
        'ai-music-api/generate',
        'ai-music-api/generate/v4',
        'ai-music-api/generate/v4.5',
      ]);

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

        const input: Record<string, any> = {};

        // Берём текст из любого доступного поля
        const textValue = r.text || r.prompt || request.prompt || '';
        const audioUrl = r.audio_url || r.audioUrl || '';
        const voiceValue = r.voice || r.voiceId || 'Rachel';
        const langValue = r.language_code || r.language || '';
        const stabilityValue = r.stability ?? 0.5;
        const similarityValue = r.similarity_boost ?? r.similarity ?? 0.75;

        switch (modelId) {
          case 'elevenlabs/audio-isolation':
            if (!audioUrl) throw new Error('audio_url is required for audio-isolation');
            input.audio_url = audioUrl;
            break;

          case 'elevenlabs/speech-to-text':
            if (!audioUrl) throw new Error('audio_url is required for speech-to-text');
            input.audio_url = audioUrl;
            if (langValue) input.language_code = langValue;
            if (typeof r.tag_audio_events === 'boolean') input.tag_audio_events = r.tag_audio_events;
            if (typeof r.diarize === 'boolean') input.diarize = r.diarize;
            break;

          case 'elevenlabs/sound-effect-v2':
            if (!textValue) throw new Error('text is required for sound-effect-v2');
            input.text = textValue;
            input.loop = r.loop ?? false;
            input.duration_seconds = r.duration_seconds ?? r.duration ?? 5;
            input.prompt_influence = r.prompt_influence ?? 0.3;
            input.output_format = r.output_format ?? 'mp3_44100_128';
            break;

          // case 'elevenlabs/text-to-dialogue-v3':
          //   // ═══ ИСПРАВЛЕНО: API принимает ТОЛЬКО stability и language_code ═══
          //   // Диалог описывается в промпте текстом, а не массивом реплик.
          //   // Модель сама генерирует голоса и озвучивает диалог.
          //   input.stability = stabilityValue;
          //   input.language_code = langValue || 'auto';

          //   // Если пришёл массив dialogue — конвертируем в текстовый промпт
          //   // и передаём как часть prompt (KIE использует prompt из task context)
          //   if (Array.isArray(r.dialogue) && r.dialogue.length > 0) {
          //     // Формируем текстовый скрипт диалога из реплик
          //     const dialogueScript = r.dialogue
          //       .map((line: any) => {
          //         const speaker = line.voice || 'Speaker';
          //         const text = line.text || '';
          //         return `${speaker}: ${text}`;
          //       })
          //       .join('\n');
          //     input.text = dialogueScript;
          //   } else if (textValue) {
          //     input.text = textValue;
          //   }
          //   break;
          case 'elevenlabs/text-to-dialogue-v3':
            // ═══ API принимает ТОЛЬКО stability и language_code ═══
            // Документация не показывает поле text/dialogue в input.
            // Текст диалога передаём как text — если API его отклоняет, убираем.
            input.stability = stabilityValue;
            input.language_code = langValue || 'auto';
            // НЕ передаём text — строго по документации
            // Текст сохраняем только в prompt для отображения пользователю
            break;

          case 'elevenlabs/text-to-speech-multilingual-v2':
          case 'elevenlabs/text-to-speech-turbo-2-5':
            if (!textValue) throw new Error('text is required for text-to-speech models');
            input.text = textValue;
            input.voice = voiceValue;
            input.stability = stabilityValue;
            input.similarity_boost = similarityValue;
            input.style = r.style ?? 0;
            input.speed = r.speed ?? 1;
            input.timestamps = r.timestamps ?? false;
            input.previous_text = r.previous_text ?? '';
            input.next_text = r.next_text ?? '';
            input.language_code = langValue;
            break;

          default:
            throw new Error(`Model ${modelId} not supported`);
        }

        const requestBody: any = { model: modelId, input };
        if (r.callBackUrl) requestBody.callBackUrl = r.callBackUrl;

        this.logger.debug(`Sending request to KIE ElevenLabs: ${JSON.stringify(requestBody).substring(0, 500)}`);

        const response = await this.client.post('/api/v1/jobs/createTask', requestBody);
        const data = response.data;

        if (data.code !== 200) throw new Error(data.msg || 'KIE ElevenLabs task creation failed');

        const taskId = data.data?.taskId;
        if (!taskId) throw new Error('No taskId in KIE ElevenLabs response');

        this.logger.log(`KIE ElevenLabs task created: ${taskId} (model: ${modelId})`);

        return {
          success: true,
          data: { taskId, urls: [], metadata: { model: modelId } },
          responseTimeMs: Date.now() - start,
          providerSlug: this.slug,
        };

      } else if (sunoModels.has(modelId)) {
        const sunoModel = sunoModelMap[modelId] || modelId;
        this.logger.debug(`KIE generateAudio: using Suno model=${modelId} → mapped to ${sunoModel}`);

        const body: any = {
          prompt: r.prompt || request.prompt,
          customMode: r.customMode || false,
          instrumental: r.instrumental || false,
          model: sunoModel,
          callBackUrl: r.callBackUrl || 'https://spichki.tw1.ru/api/v1/webhooks/kie-callback',
          style: r.style,
          title: r.title,
          negativeTags: r.negativeTags,
          vocalGender: r.vocalGender,
          styleWeight: r.styleWeight,
          weirdnessConstraint: r.weirdnessConstraint,
          audioWeight: r.audioWeight,
          personaId: r.personaId,
          uploadUrl: r.uploadUrl,
          duration: r.duration,
        };

        this.logger.debug(`Sending request to KIE Suno: ${JSON.stringify(body).substring(0, 300)}`);

        const response = await this.client.post('/api/v1/generate', body);
        const data = response.data;

        if (data.code !== 200) throw new Error(data.msg || 'KIE Suno task creation failed');

        const taskId = data.data?.taskId;
        if (!taskId) throw new Error('No taskId in KIE Suno response');

        this.logger.log(`KIE Suno task created: ${taskId} (model: ${sunoModel})`);

        return {
          success: true,
          data: { taskId, urls: [], metadata: { model: sunoModel, apiType: 'suno' } },
          responseTimeMs: Date.now() - start,
          providerSlug: this.slug,
        };
      }

      this.logger.error(`KIE generateAudio: unknown model "${modelId}"`);
      return {
        success: false,
        error: { code: 'NOT_IMPLEMENTED', message: `Audio model ${modelId} not implemented`, retryable: false },
        responseTimeMs: 0,
        providerSlug: this.slug,
      };
    } catch (error: any) {
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
// TEXT GENERATION — KIE Gemini models
// ═══════════════════════════════════════════════════════

// Модели, для которых KIE использует отдельный baseURL path
private static readonly KIE_TEXT_MODELS: Record<string, string> = {
  'gemini-3.1-pro': '/gemini-3.1-pro/v1/chat/completions',
  'gemini-3-flash': '/gemini-3-flash/v1/chat/completions',
};

async generateText(request: TextGenerationRequest): Promise<GenerationResult> {
  const start = Date.now();
  const endpoint = KieProvider.KIE_TEXT_MODELS[request.model];

  if (!endpoint) {
    return {
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: `Text model ${request.model} not supported by KIE`, retryable: false },
      responseTimeMs: 0,
      providerSlug: this.slug,
    };
  }

  try {
    this.logger.debug(`KIE generateText: model=${request.model}, endpoint=${endpoint}`);

    const response = await this.client.post(endpoint, {
      messages: request.messages,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
      stream: false,
    });

    const data = response.data;
    return {
      success: true,
      data: {
        content: data.choices?.[0]?.message?.content || '',
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
    this.logger.error(`KIE generateText error: ${error?.response?.status} - ${error.message}`);
    return this.handleError(error, start);
  }
}

async *generateTextStream(request: TextGenerationRequest): AsyncGenerator<StreamChunk> {
  const endpoint = KieProvider.KIE_TEXT_MODELS[request.model];

  if (!endpoint) {
    yield { content: '', done: true, error: `Text model ${request.model} not supported by KIE` };
    return;
  }

  try {
    this.logger.debug(`KIE generateTextStream: model=${request.model}, endpoint=${endpoint}`);

    const response = await this.client.post(
      endpoint,
      {
        messages: request.messages,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        stream: true,
      },
      {
        responseType: 'stream',
        timeout: 180000,
      },
    );

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

          if (parsed.error) {
            this.logger.error(`KIE SSE error: ${JSON.stringify(parsed.error)}`);
            yield { content: '', done: true, error: parsed.error.message || JSON.stringify(parsed.error) };
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
        } catch {
          // Skip malformed JSON
        }
      }
    }

    // Стрим закончился без [DONE]
    this.logger.warn(`KIE stream ended without [DONE] for model ${request.model}`);
    yield { content: '', done: true };

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
            errorMessage = parsed?.error?.message || parsed?.msg || body;
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

    this.logger.error(`KIE stream error: status=${status}, message=${errorMessage}`);
    yield { content: '', done: true, error: `KIE: ${status || 'NETWORK'} - ${errorMessage}` };
  }
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