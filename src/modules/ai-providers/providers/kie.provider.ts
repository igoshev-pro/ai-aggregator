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

// ═══════════════════════════════════════════════════════
// IMAGE MODEL PARAMS (existing)
// ═══════════════════════════════════════════════════════
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
  kieModel: string;           // KIE API model name
  apiType: 'jobs' | 'runway'; // /api/v1/jobs/createTask or /api/v1/runway/generate
  statusApiType: 'jobs' | 'runway'; // different status endpoints
  hasImageInput: boolean;
  hasSound?: boolean;         // Kling
  hasMode?: boolean;          // Kling std/pro
  hasSize?: boolean;          // Sora Pro standard/high
  hasRemoveWatermark?: boolean;
  hasPromptOptimizer?: boolean; // Hailuo
  hasResolution?: boolean;    // Hailuo 768P/1080P
  nFrames?: string[];         // Sora frame options
  durations?: string[];       // fixed duration options
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

  // ── Hailuo ──
  'hailuo/02-text-to-video-standard': {
    kieModel: 'hailuo/02-text-to-video-standard',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: false,
    hasPromptOptimizer: true,
    durations: ['6', '10'],
    aspectRatios: [],
  },
  'hailuo/2-3-image-to-video-standard': {
    kieModel: 'hailuo/2-3-image-to-video-standard',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: true,
    hasResolution: true,
    durations: ['6', '10'],
    aspectRatios: [],
  },
  'hailuo/2-3-image-to-video-pro': {
    kieModel: 'hailuo/2-3-image-to-video-pro',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: true,
    hasResolution: true,
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
    const config = VIDEO_MODEL_MAP[modelSlug];

    if (!config) {
      return {
        success: false,
        error: { code: 'UNKNOWN_MODEL', message: `Unknown video model: ${modelSlug}`, retryable: false },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    }

    this.logger.log(`KIE generateVideo: slug=${modelSlug}, kieModel=${config.kieModel}`);

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
    // Try to detect Runway tasks by prefix
    const isRunway = taskId.includes('runway') ||
      taskId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-/); // UUID format = Runway

    if (isRunway) {
      return this.checkRunwayTaskStatus(taskId);
    }

    return this.checkJobsTaskStatus(taskId);
  }

  // ── Jobs API status (Sora, Kling, Hailuo) ──
  private async checkJobsTaskStatus(taskId: string): Promise<TaskStatusResult> {
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

      this.logger.debug(`KIE jobs task ${taskId} state: ${task.state}, progress: ${task.progress}`);

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
      this.logger.error(`KIE checkJobsTaskStatus error: ${error.message}`);
      return { status: 'failed', error: `Status check failed: ${error.message}` };
    }
  }

  // ── Runway API status ──
  private async checkRunwayTaskStatus(taskId: string): Promise<TaskStatusResult> {
    try {
      const response = await this.client.get('/api/v1/runway/record-detail', {
        params: { taskId },
      });

      const data = response.data;

      if (data.code !== 200) {
        return { status: 'failed', error: data.msg || 'Runway status check failed' };
      }

      const task = data.data;
      if (!task) {
        return { status: 'pending' };
      }

      this.logger.debug(`Runway task ${taskId} state: ${task.state}`);

      const stateMap: Record<string, TaskStatusResult['status']> = {
        wait: 'pending',
        queueing: 'pending',
        generating: 'processing',
        success: 'completed',
        fail: 'failed',
      };

      const status = stateMap[task.state] || 'pending';

      if (status === 'failed') {
        return {
          status: 'failed',
          error: task.failMsg || 'Runway generation failed',
        };
      }

      if (status === 'completed') {
        const resultUrls: string[] = [];
        if (task.videoInfo?.videoUrl) {
          resultUrls.push(task.videoInfo.videoUrl);
        }

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
      this.logger.error(`Runway checkTaskStatus error: ${error.message}`);
      return { status: 'failed', error: `Runway status check failed: ${error.message}` };
    }
  }

  // ═══════════════════════════════════════════════════════
  // AUDIO (stub)
  // ═══════════════════════════════════════════════════════
  async generateAudio(request: AudioGenerationRequest): Promise<GenerationResult> {
    return {
      success: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'Audio via KIE not yet implemented', retryable: false },
      responseTimeMs: 0,
      providerSlug: this.slug,
    };
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
}