// src/modules/ai-providers/providers/kie.provider.ts
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
    'seedream/5-pro-text-to-image': {
    aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
    resolutions: ['basic', 'high'],
    hasQuality: true,
    hasOutputFormat: true,
  },
  'seedream/5-pro-image-to-image': {
    aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
    resolutions: ['basic', 'high'],
    hasQuality: true,
    hasInputImages: true,
    inputImagesField: 'image_urls',
    maxInputImages: 10,
    hasOutputFormat: true,
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
  //@ts-ignore
  'nano-banana-2-lite': {
    aspectRatios: ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9', 'auto'],
    hasInputImages: true,
    inputImagesField: 'image_urls',
    maxInputImages: 10,
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
  'gpt-image-2-text-to-image': {
    aspectRatios: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'],
    resolutions: ['1K', '2K', '4K'],
  },
  'gpt-image-2-image-to-image': {
    aspectRatios: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21'],
    resolutions: ['1K', '2K', '4K'],
    hasInputImages: true,
    inputImagesField: 'input_urls',
    maxInputImages: 4,
  },
};

// 🆕 GPT 5.6 модели — новый endpoint /codex/v1/responses (формат responses API)
const KIE_CODEX_MODELS: Record<string, string> = {
  'gpt-5.6-luna': 'gpt-5-6-luna',
  'gpt-5.6-terra': 'gpt-5-6-terra',
  'gpt-5.6-sol': 'gpt-5-6-sol',
};

// 🆕 Grok 4.5 — endpoint /grok/v1/responses (тот же responses-формат, что и codex)
const KIE_GROK_MODELS: Record<string, string> = {
  'grok-4-5': 'grok-4-5',
};

interface VideoModelConfig {
  kieModel: string;
  apiType: 'jobs' | 'runway' | 'veo';
  statusApiType: 'jobs' | 'runway' | 'veo';
  hasImageInput: boolean;
  hasSound?: boolean;
  hasMode?: boolean;
  hasSize?: boolean;
  hasRemoveWatermark?: boolean;
  hasPromptOptimizer?: boolean;
  hasResolution?: boolean;
  resolutionDefault?: string;   // 🆕 дефолт для hasResolution (иначе '768P')
  hasCfgScale?: boolean;        // 🆕 kling 2.5 turbo
  hasNegativePrompt?: boolean;  // 🆕 kling 2.5 turbo
  hasNsfwChecker?: boolean;     // 🆕 kling 2.5 turbo
  nFrames?: string[];
  durations?: string[];
  aspectRatios: string[];
}

const VIDEO_MODEL_MAP: Record<string, VideoModelConfig> = {
  // ─── Veo 3.1 (KIE /api/v1/veo/generate) ───────────────────────
  'veo3_lite': {
    kieModel: 'veo3_lite',
    apiType: 'veo',
    statusApiType: 'veo',
    hasImageInput: true,
    durations: ['4', '6', '8'],
    aspectRatios: ['16:9', '9:16'],
  },
  'veo3_fast': {
    kieModel: 'veo3_fast',
    apiType: 'veo',
    statusApiType: 'veo',
    hasImageInput: true,
    durations: ['4', '6', '8'],
    aspectRatios: ['16:9', '9:16'],
  },
  'veo3': {
    kieModel: 'veo3',
    apiType: 'veo',
    statusApiType: 'veo',
    hasImageInput: true,
    durations: ['4', '6', '8'],
    aspectRatios: ['16:9', '9:16'],
  },
  // ─── Kling ──────────────────────────────────────────────────────
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
  'kling/v2-5-turbo-text-to-video-pro': {
    kieModel: 'kling/v2-5-turbo-text-to-video-pro',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: false,
    hasCfgScale: true,
    hasNegativePrompt: true,
    hasNsfwChecker: true,
    durations: ['5', '10'],
    aspectRatios: ['16:9', '9:16', '1:1'],
  },
  'kling/v2-5-turbo-image-to-video-pro': {
    kieModel: 'kling/v2-5-turbo-image-to-video-pro',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: true,
    hasCfgScale: true,
    hasNegativePrompt: true,
    hasNsfwChecker: true,
    durations: ['5', '10'],
    aspectRatios: [], // i2v: формат берётся из изображения
  },
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
    durations: ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30'],
    aspectRatios: [], // формат берётся из видео/фото
  },
  'runway': {
    kieModel: 'runway',
    apiType: 'runway',
    statusApiType: 'runway',
    hasImageInput: true,
    durations: ['5', '10'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
  },
  // ─── Wan 2.7 (KIE jobs) ──────────────────────────────────────
  'wan/2-7-text-to-video': {
    kieModel: 'wan/2-7-text-to-video',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: false,
    durations: ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
  },
  'wan/2-7-image-to-video': {
    kieModel: 'wan/2-7-image-to-video',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: true,
    durations: ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
  },
  // ─── Wan 2.5 (KIE jobs) ──────────────────────────────────────
  'wan/2-5-text-to-video': {
    kieModel: 'wan/2-5-text-to-video',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: false,
    durations: ['5', '10'],
    aspectRatios: ['16:9', '9:16', '1:1'],
  },
  'wan/2-5-image-to-video': {
    kieModel: 'wan/2-5-image-to-video',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: true,
    durations: ['5', '10'],
    aspectRatios: [], // i2v: формат берётся из изображения
  },
  // ─── Seedance (KIE jobs, bytedance/*) ────────────────────────
  'bytedance/seedance-1.5-pro': {
    kieModel: 'bytedance/seedance-1.5-pro',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: true,
    durations: ['4', '6', '8', '10', '12'],
    aspectRatios: ['1:1', '21:9', '4:3', '3:4', '16:9', '9:16'],
  },
  'bytedance/seedance-2': {
    kieModel: 'bytedance/seedance-2',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: true,
    durations: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
    aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
  },
  'bytedance/seedance-2-fast': {
    kieModel: 'bytedance/seedance-2-fast',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: true,
    durations: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
    aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
  },
  'bytedance/seedance-2-5': {
  kieModel: 'bytedance/seedance-2-5',
  apiType: 'jobs',
  statusApiType: 'jobs',
  hasImageInput: true,
  durations: ['4', '5', '6', '7', '8', '9', '10', '15', '20', '25', '30'],
  aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'],
},
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
  'hailuo/02-text-to-video-pro': {
    kieModel: 'hailuo/02-text-to-video-pro',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: false,
    hasPromptOptimizer: true,
    durations: ['6', '10'],
    aspectRatios: [],
  },
  // ─── Gemini Omni Video (KIE jobs) ─────────────────────────────
  'gemini-omni-video': {
    kieModel: 'gemini-omni-video',
    apiType: 'jobs',
    statusApiType: 'jobs',
    hasImageInput: true,
    // 🔧 без hasResolution KIE всегда отдавал 720p, хотя пользователь
    //    платил по матрице за 1080p/4K
    hasResolution: true,
    resolutionDefault: '720p',
    durations: ['4', '6', '8', '10'],
    aspectRatios: ['16:9', '9:16'],
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
  // IMAGE GENERATION
  // ═══════════════════════════════════════════════════════
  async generateImage(request: ImageGenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    try {
      let modelId = request.model;

      // ─── Gemini Omni Character (KIE jobs) — свой формат input, без aspect_ratio/resolution ───
      if (modelId === 'gemini-omni-character') {
        return await this.generateGeminiOmniCharacter(request, start);
      }

      // 🆕 GPT Image 2: авто-переключение TTI ↔ ITI по наличию фото-референса
      const incomingUrls: string[] = (request as any).inputUrls || [];
      if (modelId === 'gpt-image-2-text-to-image' && incomingUrls.length > 0) {
        modelId = 'gpt-image-2-image-to-image';
      } else if (modelId === 'gpt-image-2-image-to-image' && incomingUrls.length === 0) {
        modelId = 'gpt-image-2-text-to-image';
      }

      // 🆕 Flux 2: авто-переключение TTI ↔ ITI по наличию фото-референса
      if (modelId === 'flux-2/flex-text-to-image' && incomingUrls.length > 0) {
        modelId = 'flux-2/flex-image-to-image';
      } else if (modelId === 'flux-2/flex-image-to-image' && incomingUrls.length === 0) {
        modelId = 'flux-2/flex-text-to-image';
      }

            // 🆕 Seedream 5 Pro: авто-переключение TTI ↔ ITI по наличию фото-референса
      if (modelId === 'seedream/5-pro-text-to-image' && incomingUrls.length > 0) {
        modelId = 'seedream/5-pro-image-to-image';
      } else if (modelId === 'seedream/5-pro-image-to-image' && incomingUrls.length === 0) {
        modelId = 'seedream/5-pro-text-to-image';
      }

      const modelParams = KIE_MODEL_PARAMS[modelId];

      this.logger.debug(
        `KIE generateImage: model=${modelId}, imgs=${incomingUrls.length}, prompt="${request.prompt?.substring(0, 60)}"`,
      );

      const input: Record<string, any> = { prompt: request.prompt };

      // 🔧 FIX: приоритет строкового aspectRatio от фронта.
      // Раньше aspect_ratio всегда вычислялся из width/height, которые
      // фронт для media не шлёт → всегда получался '1:1' (квадрат).
      const requestedAr = (request as any).aspectRatio as string | undefined;
      let aspectRatio: string;

      if (requestedAr && typeof requestedAr === 'string') {
        // Валидируем по списку допустимых для модели (если он задан)
        const allowedArs = modelParams?.aspectRatios;
        if (!allowedArs || allowedArs.length === 0 || allowedArs.includes(requestedAr)) {
          aspectRatio = requestedAr;
        } else {
          // Формат не поддерживается моделью — берём первый допустимый
          aspectRatio = allowedArs[0];
          this.logger.warn(
            `KIE ${modelId}: aspectRatio "${requestedAr}" не поддерживается, использую "${aspectRatio}"`,
          );
        }
      } else {
        // Fallback: вычисляем из width/height (legacy)
        aspectRatio = this.toAspectRatio(request.width, request.height);
      }

      input.aspect_ratio = aspectRatio;

      if (modelParams?.hasQuality) {
        input.quality = (request as any).quality || 'basic';
      } else if (modelParams?.resolutions?.length > 0) {
        input.resolution = (request as any).resolution || '1K';
      }

      if (modelId === 'mj_txt2img' || modelId === 'mj_img2img') {
        input.mode = (request as any).mode || 'fast';
      }

      if ((request as any).version) {
        input.version = (request as any).version;
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
      this.logger.debug(
        `KIE image FULL RESPONSE: code=${data.code}, msg="${data.msg}", ` +
        `data=${JSON.stringify(data).substring(0, 800)}`
      );

      if (data.code !== 200) throw new Error(data.msg || 'KIE image task creation failed');

      const taskId = data.data?.taskId;
      if (!taskId) throw new Error('No taskId in KIE response');

      this.logger.debug(`KIE image task created: ${taskId}`);

      return {
        success: true,
        data: { taskId, urls: [], metadata: { model: modelId } },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    } catch (error: any) {
      this.logger.error(`KIE generateImage error: ${error.message}`);
      return this.handleError(error, start);
    }
  }

  // ═══════════════════════════════════════════════════════
  // 🆕 GEMINI OMNI CHARACTER (KIE jobs) — консистентный персонаж
  // input: character_name (опц.), image_urls (обяз.), descriptions (обяз.)
  // ═══════════════════════════════════════════════════════
  private async generateGeminiOmniCharacter(
    request: ImageGenerationRequest,
    start: number,
  ): Promise<GenerationResult> {
    try {
      const r = request as any;
      const imageUrls: string[] = (r.inputUrls || []).filter(Boolean);
      if (imageUrls.length === 0) {
        throw new Error('image_urls (reference image) is required for Gemini Omni Character');
      }

      const input: Record<string, any> = {
        image_urls: imageUrls,
        descriptions: request.prompt,
      };
      if (r.characterName && String(r.characterName).trim()) {
        input.character_name = String(r.characterName).trim().substring(0, 100);
      }

      this.logger.debug(
        `KIE Gemini Omni Character generate: input=${JSON.stringify(input).substring(0, 400)}`,
      );

      const response = await this.client.post('/api/v1/jobs/createTask', {
        model: 'gemini-omni-character',
        input,
      });

      const data = response.data;
      if (data.code !== 200) {
        throw new Error(data.msg || `KIE Gemini Omni Character task creation failed (code ${data.code})`);
      }

      const taskId = data.data?.taskId;
      if (!taskId) throw new Error('No taskId in KIE Gemini Omni Character response');

      return {
        success: true,
        data: { taskId, urls: [], metadata: { model: 'gemini-omni-character' } },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    } catch (error: any) {
      this.logger.error(`KIE Gemini Omni Character error: ${error.message}`);
      return this.handleError(error, start);
    }
  }

  // ═══════════════════════════════════════════════════════
  // VIDEO GENERATION
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

    const hasImage = !!(request as any).imageUrl || !!((request as any).imageUrls?.length);

    if (modelSlug === 'hailuo/02-text-to-video-standard' && hasImage && VIDEO_MODEL_MAP['hailuo/2-3-image-to-video-standard']) {
      config = VIDEO_MODEL_MAP['hailuo/2-3-image-to-video-standard'];
    }
    if (modelSlug === 'hailuo/2-3-image-to-video-standard' && !hasImage && VIDEO_MODEL_MAP['hailuo/02-text-to-video-standard']) {
      config = VIDEO_MODEL_MAP['hailuo/02-text-to-video-standard'];
    }
    if (modelSlug === 'hailuo/2-3-image-to-video-pro' && !hasImage && VIDEO_MODEL_MAP['hailuo/02-text-to-video-pro']) {
      config = VIDEO_MODEL_MAP['hailuo/02-text-to-video-pro'];
    }
    if (modelSlug === 'hailuo/02-text-to-video-pro' && hasImage && VIDEO_MODEL_MAP['hailuo/2-3-image-to-video-pro']) {
      config = VIDEO_MODEL_MAP['hailuo/2-3-image-to-video-pro'];
    }
    if (modelSlug === 'sora-2-text-to-video' && hasImage && VIDEO_MODEL_MAP['sora-2-image-to-video']) {
      config = VIDEO_MODEL_MAP['sora-2-image-to-video'];
    }
    if (modelSlug === 'sora-2-image-to-video' && !hasImage && VIDEO_MODEL_MAP['sora-2-text-to-video']) {
      config = VIDEO_MODEL_MAP['sora-2-text-to-video'];
    }
    // 🆕 Kling 2.5 Turbo: t2v ↔ i2v по наличию изображения
    if (modelSlug === 'kling/v2-5-turbo-text-to-video-pro' && hasImage && VIDEO_MODEL_MAP['kling/v2-5-turbo-image-to-video-pro']) {
      config = VIDEO_MODEL_MAP['kling/v2-5-turbo-image-to-video-pro'];
    }
    if (modelSlug === 'kling/v2-5-turbo-image-to-video-pro' && !hasImage && VIDEO_MODEL_MAP['kling/v2-5-turbo-text-to-video-pro']) {
      config = VIDEO_MODEL_MAP['kling/v2-5-turbo-text-to-video-pro'];
    }

    this.logger.log(`KIE generateVideo: slug=${modelSlug}, kieModel=${config.kieModel}, hasImage=${hasImage}`);

    try {
      // 🆕 Seedance (1.5 Pro / 2 / 2 Fast)
      if (config.kieModel.startsWith('bytedance/seedance')) {
        return await this.generateSeedanceVideo(request, config, start);
      }
      if (config.kieModel.startsWith('wan/')) {
        return await this.generateWanVideo(request, config, start, hasImage);
      }
      if (config.apiType === 'runway') {
        return await this.generateRunwayVideo(request, config, start);
      }
      // 🆕 Veo 3.1 использует отдельный эндпоинт KIE
      if (config.apiType === 'veo') {
        return await this.generateVeoVideo(request, config, start);
      }
      return await this.generateJobsVideo(request, config, start);
    } catch (error: any) {
      this.logger.error(`KIE generateVideo error: ${error.message}`);
      return this.handleError(error, start);
    }
  }

  // ═══════════════════════════════════════════════════════
  // 🆕 VEO 3.1 VIDEO GENERATION (KIE /api/v1/veo/generate)
  // Три режима: TEXT_2_VIDEO / FIRST_AND_LAST_FRAMES_2_VIDEO / REFERENCE_2_VIDEO
  // ═══════════════════════════════════════════════════════
  private async generateVeoVideo(
    request: VideoGenerationRequest,
    config: VideoModelConfig,
    start: number,
  ): Promise<GenerationResult> {
    const r = request as any;

    // ─── Нормализация входных изображений ───
    const referenceImages: string[] = Array.isArray(r.referenceImages)
      ? r.referenceImages.filter(Boolean)
      : [];

    // start/end frame: imageUrls (массив) ИЛИ одиночный imageUrl
    let frameImages: string[] = [];
    if (Array.isArray(r.imageUrls) && r.imageUrls.length > 0) {
      frameImages = r.imageUrls.filter(Boolean);
    } else if (r.imageUrl) {
      frameImages = [r.imageUrl];
    }

    // ─── Определение режима генерации ───
    // Приоритет: явный generationType → referenceImages → frameImages → text
    let generationType: string;
    if (
      r.generationType === 'TEXT_2_VIDEO' ||
      r.generationType === 'FIRST_AND_LAST_FRAMES_2_VIDEO' ||
      r.generationType === 'REFERENCE_2_VIDEO'
    ) {
      generationType = r.generationType;
    } else if (referenceImages.length > 0) {
      generationType = 'REFERENCE_2_VIDEO';
    } else if (frameImages.length > 0) {
      generationType = 'FIRST_AND_LAST_FRAMES_2_VIDEO';
    } else {
      generationType = 'TEXT_2_VIDEO';
    }

    // ─── REFERENCE_2_VIDEO ограничения (по доке KIE) ───
    // только veo3_fast / veo3_lite, только duration=8
    let model = config.kieModel; // veo3 | veo3_fast | veo3_lite
    if (generationType === 'REFERENCE_2_VIDEO' && model === 'veo3') {
      this.logger.warn(
        `Veo REFERENCE_2_VIDEO не поддерживается на veo3 (Quality) — переключаю на veo3_fast`,
      );
      model = 'veo3_fast';
    }

    // ─── duration ───
    let duration = Number(r.duration) || 8;
    if (![4, 6, 8].includes(duration)) duration = 8;
    if (generationType === 'REFERENCE_2_VIDEO') {
      duration = 8; // KIE: reference mode только 8 сек
    }

    // ─── resolution: 720p | 1080p | 4k ───
    let resolution = String(r.resolution || '720p').toLowerCase();
    if (resolution === '4К' || resolution === '4К') resolution = '4k';
    if (!['720p', '1080p', '4k'].includes(resolution)) resolution = '720p';

    // ─── aspect_ratio: 16:9 | 9:16 | Auto ───
    let aspectRatio = r.aspectRatio || '16:9';
    if (aspectRatio === 'auto') aspectRatio = 'Auto';
    if (!['16:9', '9:16', 'Auto'].includes(aspectRatio)) aspectRatio = '16:9';

    // ─── Звук: фронт шлёт generateAudio (Veo) или sound (общий тумблер) ───
    // По умолчанию выключен (false), если флаг не пришёл.
    const enableAudio =
      r.generateAudio !== undefined
        ? !!r.generateAudio
        : (r.sound !== undefined ? !!r.sound : false);

    // ─── Сборка body ───
    const body: Record<string, any> = {
      prompt: request.prompt,
      model,
      generationType,
      aspect_ratio: aspectRatio,
      duration,
      resolution,
      enableAudio,             // 🆕 управление звуком (по умолчанию выключен)
      enableTranslation: true, // поддержка не-английских промптов
    };

    // imageUrls для image/reference режимов
    if (generationType === 'REFERENCE_2_VIDEO') {
      // 1-3 референс-картинки
      body.imageUrls = referenceImages.slice(0, 3);
    } else if (generationType === 'FIRST_AND_LAST_FRAMES_2_VIDEO') {
      // 1 кадр (старт) или 2 кадра (старт + конец)
      body.imageUrls = frameImages.slice(0, 2);
    }

    // watermark (опционально)
    if (r.watermark && typeof r.watermark === 'string' && r.watermark.trim()) {
      body.watermark = r.watermark.trim();
    }

    this.logger.debug(
      `KIE Veo generate: model=${model}, type=${generationType}, ` +
      `dur=${duration}, res=${resolution}, ar=${aspectRatio}, audio=${enableAudio}, ` +
      `imgs=${body.imageUrls?.length ?? 0}, ` +
      `body=${JSON.stringify(body).substring(0, 400)}`,
    );

    const response = await this.client.post('/api/v1/veo/generate', body);
    const data = response.data;

    this.logger.debug(
      `KIE Veo response: code=${data.code}, msg="${data.msg}", data=${JSON.stringify(data).substring(0, 400)}`,
    );

    if (data.code !== 200) {
      throw new Error(data.msg || `KIE Veo task creation failed (code ${data.code})`);
    }

    const taskId = data.data?.taskId;
    if (!taskId) throw new Error('No taskId in KIE Veo response');

    // 🔧 префикс для маршрутизации в checkTaskStatus → checkVeoTaskStatus
    return {
      success: true,
      data: {
        taskId: `veo:${taskId}`,
        urls: [],
        metadata: { model, apiType: 'veo', generationType },
      },
      responseTimeMs: Date.now() - start,
      providerSlug: this.slug,
    };
  }

  private async generateJobsVideo(
    request: VideoGenerationRequest,
    config: VideoModelConfig,
    start: number,
  ): Promise<GenerationResult> {
    const r = request as any;
    const input: Record<string, any> = { prompt: request.prompt };

    const isKling = config.kieModel.startsWith('kling-3.0');
    const isKling25 =
      config.kieModel === 'kling/v2-5-turbo-text-to-video-pro' ||
      config.kieModel === 'kling/v2-5-turbo-image-to-video-pro';

    // ─── Kling 2.5 Turbo (text/image-to-video) ───
    if (isKling25) {
      const isKling25I2V = config.kieModel === 'kling/v2-5-turbo-image-to-video-pro';

      input.duration = String(r.duration || '5');
      input.negative_prompt =
        r.negativePrompt && String(r.negativePrompt).trim()
          ? String(r.negativePrompt).trim()
          : 'blur, distort, and low quality';
      // cfg_scale: креативность 0-1 (чем ниже — тем креативнее)
      const cfg = Number(r.cfgScale);
      input.cfg_scale = isNaN(cfg) ? 0.5 : Math.min(1, Math.max(0, cfg));
      input.nsfw_checker = r.nsfwChecker !== undefined ? !!r.nsfwChecker : true;

      if (isKling25I2V) {
        // i2v: image_url обязателен + опциональный tail_image_url
        const frames: string[] = [];
        if (Array.isArray(r.imageUrls) && r.imageUrls.length > 0) {
          frames.push(...r.imageUrls.filter(Boolean));
        } else if (r.imageUrl) {
          frames.push(r.imageUrl);
        }
        if (frames.length === 0) {
          throw new Error('image_url is required for Kling 2.5 image-to-video');
        }
        input.image_url = frames[0];
        if (frames[1]) input.tail_image_url = frames[1];
        // i2v не принимает aspect_ratio — формат берётся из изображения
      } else {
        // t2v: aspect_ratio обязателен
        input.aspect_ratio = r.aspectRatio || '16:9';
      }

      this.logger.debug(
        `KIE Kling2.5 generate (${isKling25I2V ? 'i2v' : 't2v'}): input=${JSON.stringify(input).substring(0, 400)}`,
      );

      const response = await this.client.post('/api/v1/jobs/createTask', {
        model: config.kieModel,
        input,
      });

      const data = response.data;
      if (data.code !== 200) {
        throw new Error(data.msg || `KIE Kling2.5 task creation failed (code ${data.code})`);
      }
      const taskId = data.data?.taskId;
      if (!taskId) throw new Error('No taskId in KIE Kling2.5 response');

      return {
        success: true,
        data: { taskId, urls: [], metadata: { model: config.kieModel, apiType: 'jobs' } },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    }

    // ─── Kling 3.0 Motion Control ───
    const isMotionControl = config.kieModel === 'kling-3.0/motion-control';
    if (isMotionControl) {
      const mcInput: Record<string, any> = {
        prompt:
          request.prompt && request.prompt.trim()
            ? request.prompt.trim()
            : "No distortion, the character's movements are consistent with the video.",
      };

      // input_urls (референс-изображение, обязательно) — массив
      const imgs: string[] = [];
      if (Array.isArray(r.imageUrls) && r.imageUrls.length > 0) {
        imgs.push(...r.imageUrls.filter(Boolean));
      } else if (r.imageUrl) {
        imgs.push(r.imageUrl);
      }
      if (imgs.length === 0) {
        throw new Error('input_urls (reference image) is required for Motion Control');
      }
      mcInput.input_urls = [imgs[0]];

      // video_urls (референс-видео, обязательно) — массив
      const vids: string[] = Array.isArray(r.videoUrls)
        ? r.videoUrls.filter(Boolean)
        : [];
      if (vids.length === 0) {
        throw new Error('video_urls (reference video) is required for Motion Control');
      }
      mcInput.video_urls = [vids[0]];

      // character_orientation: image | video
      const co = r.characterOrientation === 'image' ? 'image' : 'video';
      mcInput.character_orientation = co;

      // mode: 720p | 1080p (KIE docs: '720p' / '1080p')
      let mcMode = String(r.mode || '720p');
      if (mcMode === 'std') mcMode = '720p';
      if (mcMode === 'pro') mcMode = '1080p';
      if (!['720p', '1080p'].includes(mcMode)) mcMode = '720p';
      mcInput.mode = mcMode;

      this.logger.debug(
        `KIE MotionControl generate: input=${JSON.stringify(mcInput).substring(0, 400)}`,
      );

      const response = await this.client.post('/api/v1/jobs/createTask', {
        model: config.kieModel,
        input: mcInput,
      });

      const data = response.data;
      if (data.code !== 200) {
        throw new Error(data.msg || `KIE MotionControl task creation failed (code ${data.code})`);
      }
      const taskId = data.data?.taskId;
      if (!taskId) throw new Error('No taskId in KIE MotionControl response');

      return {
        success: true,
        data: { taskId, urls: [], metadata: { model: config.kieModel, apiType: 'jobs' } },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    }

    if (config.aspectRatios.length > 0) {
      let ar = r.aspectRatio || config.aspectRatios[0];
      if (config.aspectRatios.includes('portrait') && !config.aspectRatios.includes(ar)) {
        ar = ar === '9:16' ? 'portrait' : 'landscape';
      }
      input.aspect_ratio = ar;
    }

    if (config.nFrames) {
      const dur = r.duration || 10;
      input.n_frames = dur >= 13 ? '15' : '10';
    } else if (config.durations) {
      input.duration = String(r.duration || config.durations[0]);
    }

    // ─── Изображения: старт/конец кадр (image_urls) ───
    if (config.hasImageInput) {
      const frames: string[] = [];
      if (Array.isArray(r.imageUrls) && r.imageUrls.length > 0) {
        frames.push(...r.imageUrls.filter(Boolean));
      } else if (r.imageUrl) {
        frames.push(r.imageUrl);
      }
      if (frames.length > 0) {
        // Kling multi_shots=true поддерживает только первый кадр
        if (isKling && r.multiShots === true) {
          input.image_urls = [frames[0]];
        } else {
          input.image_urls = frames.slice(0, 2);
        }
      }
    }

    if (r.videoUrls?.length > 0) {
      input.video_urls = r.videoUrls;
    }

    // ─── KLING 3.0 specific ───
    if (isKling) {
      const multiShots = r.multiShots === true;
      input.multi_shots = multiShots;

      // mode: std | pro | 4K
      input.mode = r.mode || 'pro';

      // sound: при multi_shots=true KIE форсит true
      input.sound = multiShots ? true : (r.sound !== undefined ? r.sound : false);

      if (multiShots) {
        const shots: Array<{ prompt: string; duration: number }> = Array.isArray(r.multiPrompt)
          ? r.multiPrompt
            .filter((s: any) => s && s.prompt)
            .slice(0, 5)
            .map((s: any) => ({
              prompt: String(s.prompt).substring(0, 500),
              duration: Math.min(12, Math.max(1, Number(s.duration) || 3)),
            }))
          : [];
        input.multi_prompt = shots;

        // 🔧 KIE требует: duration (total) = сумма длительностей шотов, range 3–15.
        // Без этого KIE брал input.duration='3' (дефолт) → видео/цена за 3 сек.
        const shotsSum = shots.reduce((sum, s) => sum + s.duration, 0);
        const totalDuration = Math.min(15, Math.max(3, shotsSum || 5));
        input.duration = String(totalDuration);
      } else {
        input.multi_prompt = [];
      }

      // kling_elements: до 3, каждый 2-4 картинки
      if (Array.isArray(r.klingElements) && r.klingElements.length > 0) {
        input.kling_elements = r.klingElements
          .filter((e: any) => e && e.name)
          .slice(0, 3)
          .map((e: any) => ({
            name: String(e.name),
            description: String(e.description || ''),
            element_input_urls: Array.isArray(e.elementInputUrls)
              ? e.elementInputUrls.filter(Boolean).slice(0, 4)
              : [],
          }));
      }
    } else {
      // ─── Прочие jobs-модели (sora, hailuo) — без изменений ───
      if (config.hasSound) input.sound = r.sound !== undefined ? r.sound : false;
      if (config.hasMode) {
        input.mode = r.mode || 'std';
        input.multi_shots = false;
        input.multi_prompt = [];
      }
    }

    if (r.stable !== undefined) input.stable = r.stable;
    if (config.hasSize) input.size = r.quality || 'standard';
    if (config.hasRemoveWatermark) input.remove_watermark = r.removeWatermark !== false;
    if (config.hasPromptOptimizer) input.prompt_optimizer = r.promptOptimizer !== false;
    if (config.hasResolution) {
      input.resolution =
        r.resolution || config.resolutionDefault || '768P';
    }

    this.logger.debug(
      `KIE Jobs generate: model=${config.kieModel}, input=${JSON.stringify(input).substring(0, 500)}`,
    );

    const response = await this.client.post('/api/v1/jobs/createTask', {
      model: config.kieModel,
      input,
    });

    const data = response.data;
    if (data.code !== 200) {
      throw new Error(data.msg || `KIE video task creation failed (code ${data.code})`);
    }

    const taskId = data.data?.taskId;
    if (!taskId) throw new Error('No taskId in KIE video response');

    return {
      success: true,
      data: { taskId, urls: [], metadata: { model: config.kieModel, apiType: config.statusApiType } },
      responseTimeMs: Date.now() - start,
      providerSlug: this.slug,
    };
  }

  // ═══════════════════════════════════════════════════════
  // 🆕 WAN 2.7 VIDEO GENERATION (KIE jobs, свой формат полей)
  // ═══════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════
  // 🆕 WAN VIDEO GENERATION (KIE jobs) — 2.5 и 2.7 (разные форматы полей)
  // ═══════════════════════════════════════════════════════
  private async generateWanVideo(
    request: VideoGenerationRequest,
    config: VideoModelConfig,
    start: number,
    hasImage: boolean,
  ): Promise<GenerationResult> {
    const r = request as any;

    const isV25 = config.kieModel.startsWith('wan/2-5');

    // ─── Wan 2.5: t2v / i2v, формат полей по доке KIE ───
    if (isV25) {
      let kieModel = config.kieModel;
      if (hasImage && kieModel === 'wan/2-5-text-to-video') {
        kieModel = 'wan/2-5-image-to-video';
      } else if (!hasImage && kieModel === 'wan/2-5-image-to-video') {
        kieModel = 'wan/2-5-text-to-video';
      }

      const isV25I2V = kieModel === 'wan/2-5-image-to-video';

      // resolution: только 720p / 1080p
      let resolution = String(r.resolution || '720p').toLowerCase();
      if (!['720p', '1080p'].includes(resolution)) resolution = '720p';

      // duration: строка "5" | "10"
      let duration = String(r.duration || '5');
      if (!['5', '10'].includes(duration)) duration = '5';

      const input: Record<string, any> = {
        prompt: request.prompt,
        duration,
        resolution,
        enable_prompt_expansion:
          r.promptOptimizer !== undefined ? !!r.promptOptimizer : true,
        nsfw_checker: r.nsfwChecker !== undefined ? !!r.nsfwChecker : true,
      };

      if (r.negativePrompt && String(r.negativePrompt).trim()) {
        input.negative_prompt = String(r.negativePrompt).trim();
      }

      if (r.seed !== undefined && r.seed !== null && !isNaN(Number(r.seed))) {
        input.seed = Number(r.seed);
      }

      if (isV25I2V) {
        // i2v: image_url обязателен, aspect_ratio НЕ принимается
        const img = r.imageUrl || (Array.isArray(r.imageUrls) ? r.imageUrls[0] : undefined);
        if (!img) {
          throw new Error('image_url is required for Wan 2.5 image-to-video');
        }
        input.image_url = img;
      } else {
        // t2v: aspect_ratio
        input.aspect_ratio = r.aspectRatio || '16:9';
      }

      this.logger.debug(
        `KIE Wan2.5 generate (${isV25I2V ? 'i2v' : 't2v'}): model=${kieModel}, input=${JSON.stringify(input).substring(0, 400)}`,
      );

      const response = await this.client.post('/api/v1/jobs/createTask', {
        model: kieModel,
        input,
      });

      const data = response.data;
      this.logger.debug(
        `KIE Wan2.5 response: code=${data.code}, msg="${data.msg}", data=${JSON.stringify(data).substring(0, 400)}`,
      );

      if (data.code !== 200) {
        throw new Error(data.msg || `KIE Wan2.5 task creation failed (code ${data.code})`);
      }

      const taskId = data.data?.taskId;
      if (!taskId) throw new Error('No taskId in KIE Wan2.5 response');

      return {
        success: true,
        data: { taskId, urls: [], metadata: { model: kieModel, apiType: 'jobs' } },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    }

    // ─── Wan 2.7 (существующая логика, без изменений) ───
    let kieModel = config.kieModel;
    if (hasImage && kieModel === 'wan/2-7-text-to-video') {
      kieModel = 'wan/2-7-image-to-video';
    } else if (!hasImage && kieModel === 'wan/2-7-image-to-video') {
      kieModel = 'wan/2-7-text-to-video';
    }

    const input: Record<string, any> = {
      prompt: request.prompt,
      resolution: r.resolution === '480p' ? '720p' : (r.resolution || '720p'), // Wan: только 720p/1080p
      duration: Number(r.duration) || 5,
    };

    if (r.negativePrompt) input.negative_prompt = r.negativePrompt;

    if (kieModel === 'wan/2-7-text-to-video') {
      // t2v использует ratio
      input.ratio = r.aspectRatio || '16:9';
    } else {
      // i2v использует first_frame_url
      const img = r.imageUrl || r.imageUrls?.[0];
      if (img) input.first_frame_url = img;
      if (r.imageUrls?.length > 1) input.last_frame_url = r.imageUrls[1];
    }

    this.logger.debug(
      `KIE Wan generate: model=${kieModel}, input=${JSON.stringify(input).substring(0, 400)}`,
    );

    const response = await this.client.post('/api/v1/jobs/createTask', {
      model: kieModel,
      input,
    });

    const data = response.data;
    this.logger.debug(
      `KIE Wan response: code=${data.code}, msg="${data.msg}", data=${JSON.stringify(data).substring(0, 400)}`,
    );

    if (data.code !== 200) {
      throw new Error(data.msg || `KIE Wan task creation failed (code ${data.code})`);
    }

    const taskId = data.data?.taskId;
    if (!taskId) throw new Error('No taskId in KIE Wan response');

    // jobs API → статус через checkJobsTaskStatus (без префикса)
    return {
      success: true,
      data: { taskId, urls: [], metadata: { model: kieModel, apiType: 'jobs' } },
      responseTimeMs: Date.now() - start,
      providerSlug: this.slug,
    };
  }

  // ═══════════════════════════════════════════════════════
  // 🆕 SEEDANCE VIDEO GENERATION (KIE jobs)
  // Поддержка: 1.5-pro / 2 / 2-fast — все параметры из доков
  // ═══════════════════════════════════════════════════════
  private async generateSeedanceVideo(
  request: VideoGenerationRequest,
  config: VideoModelConfig,
  start: number,
): Promise<GenerationResult> {
  const r = request as any;
  const kieModel = config.kieModel;
  const isV15 = kieModel === 'bytedance/seedance-1.5-pro';
  const isFast = kieModel === 'bytedance/seedance-2-fast';
  const isV25 = kieModel === 'bytedance/seedance-2-5'; // 🆕

  const input: Record<string, any> = { prompt: request.prompt };

  // ─── resolution ───
  let resolution = String(r.resolution || '720p').toLowerCase();
  // Seedance 2-fast — только 480p/720p; 2.5 и 1.5 поддерживают 1080p.
  const allowedRes = isFast
    ? ['480p', '720p']
    : ['480p', '720p', '1080p'];
  if (!allowedRes.includes(resolution)) resolution = '720p';
  input.resolution = resolution;

  // ─── duration ───
  let duration = Number(r.duration);
  if (isV15) {
    if (![4, 6, 8, 10, 12].includes(duration)) duration = 8;
  } else if (isV25) {
    // 🆕 Seedance 2.5: диапазон -1..30, дефолт 5, -1 = "авто" (не используем на фронте)
    if (isNaN(duration) || duration < 1 || duration > 30) duration = 5;
    duration = Math.round(duration);
  } else {
    if (isNaN(duration) || duration < 4 || duration > 15) duration = 15;
    duration = Math.round(duration);
  }
  input.duration = duration;

  // ─── aspect_ratio ───
  input.aspect_ratio = r.aspectRatio || (isV25 ? 'adaptive' : '16:9');

  // ─── generate_audio (sound) ───
  input.generate_audio =
    r.sound !== undefined ? !!r.sound
      : (r.generateAudio !== undefined ? !!r.generateAudio : true);

  // ─── nsfw_checker ───
  input.nsfw_checker = r.nsfwChecker !== undefined ? !!r.nsfwChecker : true;

  // ─── входные изображения ───
  const imgs: string[] = [];
  if (Array.isArray(r.imageUrls) && r.imageUrls.length > 0) {
    imgs.push(...r.imageUrls.filter(Boolean));
  } else if (r.imageUrl) {
    imgs.push(r.imageUrl);
  }
  if (Array.isArray(r.referenceImages)) {
    for (const u of r.referenceImages) if (u && !imgs.includes(u)) imgs.push(u);
  }

  if (isV15) {
    input.fixed_lens = r.fixedLens !== undefined ? !!r.fixedLens : false;
    if (imgs.length > 0) input.input_urls = imgs.slice(0, 2);
  } else if (isV25) {
    // 🆕 Seedance 2.5: first/last frame — ОТДЕЛЬНЫЕ поля от reference_image_urls
    if (r.firstFrameUrl) input.first_frame_url = r.firstFrameUrl;
    if (r.lastFrameUrl) input.last_frame_url = r.lastFrameUrl;

    // reference_image_urls — до 4х картинок-референсов (персонаж/стиль),
    // используем общий imgs (imageUrls/referenceImages), first/last сюда не попадают
    if (imgs.length > 0) input.reference_image_urls = imgs.slice(0, 4);

    input.web_search = r.webSearch !== undefined ? !!r.webSearch : false;

    const vids: string[] = Array.isArray(r.videoUrls)
      ? r.videoUrls.filter(Boolean) : [];
    if (vids.length > 0) input.reference_video_urls = vids.slice(0, 3);

    const auds: string[] = Array.isArray(r.audioUrls)
      ? r.audioUrls.filter(Boolean) : [];
    if (auds.length > 0) input.reference_audio_urls = auds.slice(0, 3);

    // 🆕 return_last_frame — нельзя true вместе с draft (у нас draft не используется)
    if (r.returnLastFrame !== undefined) {
      input.return_last_frame = !!r.returnLastFrame;
    }

    // 🆕 output_format: mp4 | mov
    input.output_format = r.outputFormat === 'mov' ? 'mov' : 'mp4';
  } else {
    // Seedance 2 / 2-fast — без изменений
    input.web_search = r.webSearch !== undefined ? !!r.webSearch : false;
    if (imgs.length > 0) input.reference_image_urls = imgs.slice(0, 10);

    const vids: string[] = Array.isArray(r.videoUrls)
      ? r.videoUrls.filter(Boolean) : [];
    if (vids.length > 0) input.reference_video_urls = vids.slice(0, 3);

    const auds: string[] = Array.isArray(r.audioUrls)
      ? r.audioUrls.filter(Boolean) : [];
    if (auds.length > 0) input.reference_audio_urls = auds.slice(0, 3);
  }

  this.logger.debug(
    `KIE Seedance generate: model=${kieModel}, input=${JSON.stringify(input).substring(0, 500)}`,
  );

  const response = await this.client.post('/api/v1/jobs/createTask', {
    model: kieModel,
    input,
  });

  const data = response.data;
  this.logger.debug(
    `KIE Seedance response: code=${data.code}, msg="${data.msg}", data=${JSON.stringify(data).substring(0, 300)}`,
  );

  if (data.code !== 200) {
    throw new Error(data.msg || `KIE Seedance task creation failed (code ${data.code})`);
  }

  const taskId = data.data?.taskId;
  if (!taskId) throw new Error('No taskId in KIE Seedance response');

  return {
    success: true,
    data: { taskId, urls: [], metadata: { model: kieModel, apiType: 'jobs' } },
    responseTimeMs: Date.now() - start,
    providerSlug: this.slug,
  };
}

  private async generateRunwayVideo(
    request: VideoGenerationRequest,
    config: VideoModelConfig,
    start: number,
  ): Promise<GenerationResult> {
    const r = request as any;
    const body: Record<string, any> = {
      prompt: request.prompt,
      duration: Number(r.duration) || 5,
      quality: r.resolution || '720p',
      aspectRatio: r.aspectRatio || '16:9',
      waterMark: r.waterMark || '',
    };
    if (r.imageUrl) body.imageUrl = r.imageUrl;

    // 🔍 ЛОГ запроса
    this.logger.debug(
      `KIE Runway generate: body=${JSON.stringify(body).substring(0, 400)}`,
    );

    const response = await this.client.post('/api/v1/runway/generate', body);
    const data = response.data;

    // 🔍 ЛОГ ответа
    this.logger.debug(
      `KIE Runway response: code=${data.code}, msg="${data.msg}", ` +
      `data=${JSON.stringify(data).substring(0, 400)}`,
    );

    if (data.code !== 200) {
      throw new Error(data.msg || `Runway video creation failed (code ${data.code})`);
    }

    const taskId = data.data?.taskId;
    if (!taskId) throw new Error('No taskId in Runway response');

    return {
      success: true,
      data: { taskId: `runway:${taskId}`, urls: [], metadata: { model: 'runway', apiType: 'runway' } },
      responseTimeMs: Date.now() - start,
      providerSlug: this.slug,
    };
  }

  // ═══════════════════════════════════════════════════════
  // TASK STATUS CHECK
  // ═══════════════════════════════════════════════════════
  async checkTaskStatus(taskId: string): Promise<TaskStatusResult> {
    // 🔧 Новая маршрутизация по префиксу (надёжно, не зависит от формата taskId)
    if (taskId.startsWith('veo:')) {
      return await this.checkVeoTaskStatus(taskId.slice(4));
    }
    if (taskId.startsWith('runway:')) {
      return await this.checkRunwayTaskStatus(taskId.slice(7));
    }

    // ─── FALLBACK: старая эвристика (для зависших задач без префикса) ───
    const isRunway = taskId.includes('runway') ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(taskId);

    if (isRunway) {
      return await this.checkRunwayTaskStatus(taskId);
    }

    if (taskId.startsWith('task_elevenlabs_')) {
      return await this.checkElevenLabsTaskStatus(taskId);
    }

    // Veo taskId со старым префиксом 'veo_task_'
    if (taskId.startsWith('veo_task_') || taskId.startsWith('veo_')) {
      return await this.checkVeoTaskStatus(taskId);
    }

    const jobsResult = await this.checkJobsTaskStatus(taskId);

    if (jobsResult.status === 'failed' && jobsResult.error?.includes('recordInfo is null')) {
      this.logger.debug(`Jobs API returned null for ${taskId}, trying Suno endpoint...`);
      return await this.checkSunoTaskStatus(taskId);
    }

    if (jobsResult.status === 'completed' && (!jobsResult.resultUrls || jobsResult.resultUrls.length === 0)) {
      this.logger.debug(`Jobs returned completed but no URLs for ${taskId}, trying Suno endpoint...`);
      const sunoResult = await this.checkSunoTaskStatus(taskId);
      if (sunoResult.resultUrls && sunoResult.resultUrls.length > 0) {
        return sunoResult;
      }
    }

    return jobsResult;
  }

  // ═══════════════════════════════════════════════════════
  // 🆕 VEO TASK STATUS (KIE /api/v1/veo/record-info)
  // ═══════════════════════════════════════════════════════
  private async checkVeoTaskStatus(taskId: string): Promise<TaskStatusResult> {
    try {
      const response = await this.client.get('/api/v1/veo/record-info', {
        params: { taskId },
      });
      const data = response.data;

      if (data.code !== 200) {
        return { status: 'failed', error: data.msg || 'Failed to get Veo task status' };
      }

      const task = data.data;
      if (!task) {
        return { status: 'pending' };
      }

      this.logger.debug(
        `Veo task ${taskId}: successFlag=${task.successFlag}, response=${JSON.stringify(task.response || {}).substring(0, 400)}`,
      );

      // successFlag: 0=generating, 1=success, 2=failed, 3=generation_failed
      switch (task.successFlag) {
        case 1: {
          // Вeo возвращает resultUrls в task.response.resultUrls (массив)
          const resultUrls: string[] = task.response?.resultUrls || [];
          return {
            status: 'completed',
            resultUrls,
            progress: 100,
          };
        }
        case 2:
        case 3:
          return {
            status: 'failed',
            error: task.errorMessage || `Veo generation failed (flag=${task.successFlag})`,
          };
        case 0:
        default:
          return { status: 'processing', progress: 0 };
      }
    } catch (error: any) {
      this.logger.error(`Veo check task status error: ${error.message}`);
      return { status: 'failed', error: `Status check failed: ${error.message}` };
    }
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
    } catch (error: any) {
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
        const audioIds: string[] = []; // 🆕 ID треков для extend/persona

        const sunoData = task.response?.sunoData;
        if (Array.isArray(sunoData) && sunoData.length > 0) {
          resultUrls = sunoData
            .map((track: any) => track.audioUrl || track.sourceAudioUrl)
            .filter(Boolean);
          // 🆕 собираем audioId каждого трека
          for (const track of sunoData) {
            if (track?.id) audioIds.push(String(track.id));
          }
          this.logger.log(`Suno task ${taskId}: found ${resultUrls.length} tracks`);
        }

        if (resultUrls.length === 0 && Array.isArray(task.data)) {
          resultUrls = task.data
            .map((track: any) => track.audio_url || track.audioUrl || track.url)
            .filter(Boolean);
          for (const track of task.data) {
            const id = track?.id || track?.audio_id;
            if (id) audioIds.push(String(id));
          }
        }

        this.logger.log(
          `Suno task ${taskId} completed. URLs: ${JSON.stringify(resultUrls).substring(0, 300)}` +
          (audioIds.length ? ` | audioIds: ${audioIds.join(',')}` : ''),
        );

        return {
          status: 'completed',
          resultUrls,
          progress: 100,
          metadata: audioIds.length > 0 ? { audioIds } : undefined, // 🆕
        };
      }

      return {
        status,
        progress: 0,
      };
    } catch (error: any) {
      this.logger.warn(`Suno check error for ${taskId}: ${error.message}`);
      return { status: 'pending' };
    }
  }

  private async checkRunwayTaskStatus(taskId: string): Promise<TaskStatusResult> {
    try {
      // 🔧 БЫЛО: '/api/v1/runway/status' → давало 404
      const response = await this.client.get('/api/v1/runway/record-detail', {
        params: { taskId },
      });
      const data = response.data;

      // 🔍 ЛОГ (оставь для проверки формата ответа)
      this.logger.debug(
        `KIE Runway status RAW: code=${data.code}, msg="${data.msg}", ` +
        `fullData=${JSON.stringify(data).substring(0, 600)}`,
      );

      if (data.code !== 200) {
        return { status: 'failed', error: data.msg || 'Failed to get runway task status' };
      }
      const task = data.data;
      if (!task) {
        return { status: 'pending' };
      }

      // ── Формат 1: successFlag (как Veo): 0=gen, 1=success, 2/3=fail ──
      if (task.successFlag !== undefined) {
        switch (task.successFlag) {
          case 1: {
            let urls: string[] =
              task.response?.resultUrls ||
              task.resultUrls ||
              [];
            if (urls.length === 0) {
              if (task.videoUrl) urls = [task.videoUrl];
              else if (task.response?.videoUrl) urls = [task.response.videoUrl];
            }
            return { status: 'completed', resultUrls: urls, progress: 100 };
          }
          case 2:
          case 3:
            return {
              status: 'failed',
              error: task.errorMessage || `Runway failed (flag=${task.successFlag})`,
            };
          default:
            return { status: 'processing', progress: 0 };
        }
      }

      // ── Формат 2: state (строковый статус) ──
      const stateMap: Record<string, TaskStatusResult['status']> = {
        waiting: 'pending',
        queued: 'pending',
        pending: 'pending',
        running: 'processing',
        generating: 'processing',
        processing: 'processing',
        succeeded: 'completed',
        success: 'completed',
        completed: 'completed',
        failed: 'failed',
        fail: 'failed',
      };
      const status = stateMap[task.state] || 'pending';

      if (status === 'failed') {
        return { status: 'failed', error: task.errorMessage || task.failMsg || 'Runway generation failed' };
      }

      if (status === 'completed') {
        let resultUrls: string[] = task.resultUrls || [];

        if (resultUrls.length === 0) {
          // 🔧 KIE Runway: URL лежит в videoInfo.videoUrl
          if (task.videoInfo?.videoUrl) {
            resultUrls = [task.videoInfo.videoUrl];
          } else if (task.output?.url) {
            resultUrls = [task.output.url];
          } else if (task.url) {
            resultUrls = [task.url];
          } else if (task.video_url) {
            resultUrls = [task.video_url];
          } else if (task.videoUrl) {
            resultUrls = [task.videoUrl];
          }
        }

        this.logger.warn(
          `Runway task ${taskId} completed. Keys: ${Object.keys(task).join(', ')}. URLs: ${resultUrls.length}`,
        );
        return { status: 'completed', resultUrls, progress: 100 };
      }

      return { status, progress: task.progress || 0 };
    } catch (error: any) {
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
        let resultUrls: string[] = [];
        let resultObject: Record<string, any> | undefined;

        if (task.resultUrls?.length > 0) {
          resultUrls = task.resultUrls;
        } else if (task.output?.urls?.length > 0) {
          resultUrls = task.output.urls;
        } else if (typeof task.output === 'string' && task.output.startsWith('http')) {
          resultUrls = [task.output];
        } else if (Array.isArray(task.output)) {
          resultUrls = task.output.filter((u: any) => typeof u === 'string' && u.startsWith('http'));
        } else if (task.result?.urls?.length > 0) {
          resultUrls = task.result.urls;
        } else if (typeof task.result === 'string' && task.result.startsWith('http')) {
          resultUrls = [task.result];
        } else if (Array.isArray(task.result)) {
          resultUrls = task.result.filter((u: any) => typeof u === 'string' && u.startsWith('http'));
        } else if (task.images?.length > 0) {
          resultUrls = task.images.map((img: any) => typeof img === 'string' ? img : img.url).filter(Boolean);
        } else if (task.videos?.length > 0) {
          resultUrls = task.videos.map((v: any) => typeof v === 'string' ? v : v.url).filter(Boolean);
        } else if (task.url) {
          resultUrls = [task.url];
        } else if (task.image_url) {
          resultUrls = [task.image_url];
        } else if (task.video_url) {
          resultUrls = [task.video_url];
        } else if (task.audio_url) {
          resultUrls = [task.audio_url];
        } else if (task.data?.urls?.length > 0) {
          resultUrls = task.data.urls;
        } else if (task.data?.url) {
          resultUrls = [task.data.url];
        } else if (task.resultJson) {
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
            } else if (parsed.resultObject) {
              // 🆕 Gemini Omni Audio: результат — объект голосового профиля, не URL
              resultObject = parsed.resultObject;
            }
          } catch {
            this.logger.error(`Failed to parse resultJson: ${task.resultJson?.substring(0, 200)}`);
          }
        }

        this.logger.log(
          `Jobs task ${taskId} completed. Found ${resultUrls.length} URLs: ${JSON.stringify(resultUrls).substring(0, 300)}`,
        );

        if (resultUrls.length === 0 && !resultObject) {
          this.logger.warn(
            `Jobs task ${taskId} completed but NO URLs found! Full task keys: ${Object.keys(task).join(', ')}`,
          );
        }

        return {
          status: 'completed',
          resultUrls,
          progress: 100,
          metadata: resultObject ? { resultObject } : undefined,
        };
      }

      return {
        status,
        progress: task.progress || 0,
      };
    } catch (error: any) {
      this.logger.error(`Jobs check task status error: ${error.message}`);
      return {
        status: 'failed',
        error: `Status check failed: ${error.message}`,
      };
    }
  }

  // ═══════════════════════════════════════════════════════
  // AUDIO GENERATION
  // ═══════════════════════════════════════════════════════
  async generateAudio(request: AudioGenerationRequest): Promise<GenerationResult> {
    const start = Date.now();
    try {
      const modelId = request.model;
      const r = request as any;

      this.logger.log(`KIE generateAudio: received modelId="${modelId}"`);

      // ─── Gemini Omni Audio (KIE jobs) — дизайн голосового профиля ───
      if (modelId === 'gemini-omni-audio') {
        return await this.generateGeminiOmniAudio(request, start);
      }

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

          case 'elevenlabs/text-to-dialogue-v3': {
            input.stability = stabilityValue;
            if (langValue) input.language_code = langValue;

            let dialogueArray: Array<{ text: string; voice: string }> = [];

            if (Array.isArray(r.dialogue) && r.dialogue.length > 0) {
              dialogueArray = r.dialogue.map((line: any) => ({
                text: String(line.text || ''),
                voice: String(line.voice || 'Adam'),
              }));
            } else {
              const promptText = r.text || r.prompt || request.prompt || '';
              const lines = promptText.split('\n').filter((l: string) => l.trim());

              for (const line of lines) {
                const colonIdx = line.indexOf(':');
                if (colonIdx > 0) {
                  const voice = line.substring(0, colonIdx).trim();
                  const text = line.substring(colonIdx + 1).trim();
                  if (text) {
                    dialogueArray.push({ text, voice: voice || 'Adam' });
                  }
                } else if (line.trim()) {
                  dialogueArray.push({ text: line.trim(), voice: 'Adam' });
                }
              }
            }

            if (dialogueArray.length === 0) {
              throw new Error(
                'Для модели text-to-dialogue-v3 нужен диалог. Формат: "Имя: текст" на каждой строке.',
              );
            }

            const totalChars = dialogueArray.reduce((sum, d) => sum + d.text.length, 0);
            if (totalChars > 5000) {
              throw new Error(
                `Суммарная длина текста диалога ${totalChars} символов, максимум 5000.`,
              );
            }

            input.dialogue = dialogueArray;

            this.logger.debug(
              `ElevenLabs dialogue: ${dialogueArray.length} lines, ${totalChars} chars`,
            );
            break;
          }

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

        let response: any;
        try {
          response = await this.client.post('/api/v1/jobs/createTask', requestBody);
        } catch (axiosError: any) {
          this.logger.error(
            `KIE ElevenLabs AXIOS ERROR: ` +
            `message="${axiosError.message}", ` +
            `code="${axiosError.code}", ` +
            `status=${axiosError?.response?.status}, ` +
            `statusText="${axiosError?.response?.statusText}", ` +
            `responseData=${JSON.stringify(axiosError?.response?.data)?.substring(0, 800)}, ` +
            `isAxiosError=${axiosError.isAxiosError}, ` +
            `config.url="${axiosError?.config?.url}", ` +
            `config.baseURL="${axiosError?.config?.baseURL}"`
          );
          throw axiosError;
        }

        const data = response.data;

        this.logger.debug(
          `KIE ElevenLabs FULL RESPONSE: code=${data.code}, msg="${data.msg}", ` +
          `fullData=${JSON.stringify(data).substring(0, 800)}`
        );

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
        this.logger.debug(
          `KIE generateAudio: using Suno model=${modelId} → mapped to ${sunoModel}, ` +
          `operation=${r.operation || 'generate'}`,
        );

        const operation = r.operation || 'generate';

        // ═══════════════════════════════════════════════════════
        // 🆕 EXTEND — отдельный эндпоинт KIE /api/v1/generate/extend
        // ═══════════════════════════════════════════════════════
        if (operation === 'extend') {
          const audioId = r.audioId;
          if (!audioId) {
            throw new Error('audioId is required for Suno extend');
          }

          // KIE: при defaultParamFlag=true ОБЯЗАТЕЛЬНЫ continueAt+prompt+style+title.
          // Включаем custom-режим только если переданы ВСЕ 4 поля, иначе
          // безопасно наследуем параметры оригинала (нужен только audioId).
          const canCustom =
            r.continueAt !== undefined &&
            r.continueAt !== null &&
            !isNaN(Number(r.continueAt)) &&
            r.prompt && String(r.prompt).trim() &&
            r.style && String(r.style).trim() &&
            r.title && String(r.title).trim();

          const defaultParamFlag = !!canCustom;

          const extendBody: any = {
            defaultParamFlag,
            audioId,
            model: sunoModel,
            callBackUrl:
              r.callBackUrl ||
              'https://spichki.tw1.ru/api/v1/webhooks/kie-callback',
          };

          if (defaultParamFlag) {
            extendBody.continueAt = Number(r.continueAt);
            extendBody.prompt = String(r.prompt).trim();
            extendBody.style = String(r.style).trim();
            extendBody.title = String(r.title).trim();
          }

          // Опциональные параметры (можно слать в любом режиме)
          if (r.negativeTags) extendBody.negativeTags = r.negativeTags;
          if (r.vocalGender) extendBody.vocalGender = r.vocalGender;
          if (r.styleWeight !== undefined) extendBody.styleWeight = r.styleWeight;
          if (r.weirdnessConstraint !== undefined) {
            extendBody.weirdnessConstraint = r.weirdnessConstraint;
          }
          if (r.audioWeight !== undefined) extendBody.audioWeight = r.audioWeight;
          if (r.personaId) extendBody.personaId = r.personaId;

          this.logger.debug(
            `Sending request to KIE Suno EXTEND: ${JSON.stringify(extendBody).substring(0, 300)}`,
          );

          const response = await this.client.post(
            '/api/v1/generate/extend',
            extendBody,
          );
          const data = response.data;

          if (data.code !== 200) {
            throw new Error(data.msg || 'KIE Suno extend failed');
          }

          const taskId = data.data?.taskId;
          if (!taskId) throw new Error('No taskId in KIE Suno extend response');

          this.logger.log(
            `KIE Suno EXTEND task created: ${taskId} (model: ${sunoModel}, custom=${defaultParamFlag})`,
          );

          return {
            success: true,
            data: {
              taskId,
              urls: [],
              metadata: { model: sunoModel, apiType: 'suno', operation: 'extend' },
            },
            responseTimeMs: Date.now() - start,
            providerSlug: this.slug,
          };
        }

        const body: any = {
          prompt: r.prompt || request.prompt,
          customMode: r.customMode || false,
          instrumental: r.instrumental || false,
          model: sunoModel,
          callBackUrl:
            r.callBackUrl ||
            'https://spichki.tw1.ru/api/v1/webhooks/kie-callback',
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
          operation,
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
      if (error?.response) {
        this.logger.error(
          `KIE API response: status=${error.response.status}, ` +
          `data=${JSON.stringify(error.response.data)?.substring(0, 500)}`
        );
      }
      return this.handleError(error, start);
    }
  }

  // ═══════════════════════════════════════════════════════
  // GEMINI OMNI AUDIO (KIE jobs) — дизайн голосового профиля.
  // ⚠️ МОДЕЛЬ ОТКЛЮЧЕНА (isActive=false в реестре) — этот код сейчас
  //    недостижим, но НЕ мёртвый: он нужен при возврате модели.
  //    Причина отключения: результат приходит как resultObject
  //    (профиль голоса), а не URL трека — фронту нечего показать.
  //    Возврат: раскомментировать запись в provider-registry.service,
  //    убрать слаг из DEPRECATED_AUDIO_SLUGS, добавить в MediaResult
  //    отображение metadata.resultObject.
  // input: name (обяз., ≤100), voice_description (опц., ≤20000), example_dialogue (опц., ≤120)
  // ═══════════════════════════════════════════════════════
  private async generateGeminiOmniAudio(
    request: AudioGenerationRequest,
    start: number,
  ): Promise<GenerationResult> {
    try {
      const r = request as any;

      const name = (r.title && String(r.title).trim())
        || String(request.prompt || 'Voice profile').trim().substring(0, 100);

      const input: Record<string, any> = { name };
      if (request.prompt && request.prompt.trim()) {
        input.voice_description = request.prompt.trim();
      }
      if (r.exampleDialogue && String(r.exampleDialogue).trim()) {
        input.example_dialogue = String(r.exampleDialogue).trim().substring(0, 120);
      }

      this.logger.debug(
        `KIE Gemini Omni Audio generate: input=${JSON.stringify(input).substring(0, 400)}`,
      );

      const response = await this.client.post('/api/v1/jobs/createTask', {
        model: 'gemini-omni-audio',
        input,
      });

      const data = response.data;
      if (data.code !== 200) {
        throw new Error(data.msg || `KIE Gemini Omni Audio task creation failed (code ${data.code})`);
      }

      const taskId = data.data?.taskId;
      if (!taskId) throw new Error('No taskId in KIE Gemini Omni Audio response');

      return {
        success: true,
        data: { taskId, urls: [], metadata: { model: 'gemini-omni-audio' } },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    } catch (error: any) {
      this.logger.error(`KIE Gemini Omni Audio error: ${error.message}`);
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
    } catch (error: any) {
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
        return { status: 'completed', resultUrls: [], progress: 100 };
      }
      return { status, progress: task.progress || 0 };
    } catch (error: any) {
      this.logger.error(`KIE getLyricsTaskStatus error: ${error.message}`);
      return { status: 'failed', error: error.message };
    }
  }

  // ═══════════════════════════════════════════════════════
  // TEXT GENERATION — KIE Gemini models (with VISION support)
  // ═══════════════════════════════════════════════════════
  private static readonly KIE_TEXT_MODELS: Record<string, string> = {
    'gemini-3.1-pro': '/gemini-3.1-pro/v1/chat/completions',
    'gemini-3-flash': '/gemini-3-flash/v1/chat/completions',
  };

  private buildOpenAIContent(text: string, imageUrls?: string[]): string | any[] {
    if (!imageUrls || imageUrls.length === 0) {
      return text;
    }
    const parts: any[] = [];
    if (text && text.trim().length > 0) {
      parts.push({ type: 'text', text });
    }
    for (const url of imageUrls) {
      parts.push({ type: 'image_url', image_url: { url } });
    }
    return parts;
  }

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

    // 🆕 GPT 5.6 — отдельный codex endpoint
    if (KIE_CODEX_MODELS[request.model] || KIE_GROK_MODELS[request.model]) {
      return this.generateCodexText(request, start);
    }

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
      const messages = this.prepareMessages(request.messages as any[]);
      const hasImages = messages.some((m: any) => Array.isArray(m.content));

      this.logger.debug(
        `KIE generateText: model=${request.model}, endpoint=${endpoint}, hasImages=${hasImages}`,
      );

      const response = await this.client.post(endpoint, {
        messages,
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
    } catch (error: any) {
      this.logger.error(`KIE generateText error: ${error?.response?.status} - ${error.message}`);
      return this.handleError(error, start);
    }
  }

  // ═══════════════════════════════════════════════════════
  // 🆕 GPT 5.6 CODEX TEXT (KIE /codex/v1/responses)
  // Новый формат responses API: input[] + reasoning.effort,
  // ответ в output[].content[].text
  // ═══════════════════════════════════════════════════════
  private async generateCodexText(
    request: TextGenerationRequest,
    start: number,
  ): Promise<GenerationResult> {
    const isGrok = !!KIE_GROK_MODELS[request.model];
    const codexModel = isGrok
      ? KIE_GROK_MODELS[request.model]
      : KIE_CODEX_MODELS[request.model];
    const responsesEndpoint = isGrok ? '/grok/v1/responses' : '/codex/v1/responses';

    if (!codexModel) {
      return {
        success: false,
        error: {
          code: 'NOT_IMPLEMENTED',
          message: `Codex model ${request.model} not supported by KIE`,
          retryable: false,
        },
        responseTimeMs: 0,
        providerSlug: this.slug,
      };
    }

    try {
      // ─── Конвертация messages → input[] (responses API формат) ───
      const input = this.buildCodexInput(request.messages as any[]);

      // 🆕 reasoning.effort: low | medium | high | xhigh (дефолт low)
      const allowedEfforts = ['low', 'medium', 'high', 'xhigh'];
      const rawEffort = (request as any).reasoningEffort;
      const effort = allowedEfforts.includes(rawEffort) ? rawEffort : 'low';

      const body: Record<string, any> = {
        model: codexModel,
        input,
        stream: false,
        reasoning: { effort },
      };

      // 🆕 Web Access: добавляем инструмент web_search если включён на фронте
      const webSearchEnabled = (request as any).webSearch === true;
      if (webSearchEnabled) {
        body.tools = [{ type: 'web_search' }];
      }

      // 🆕 Динамический таймаут: high/xhigh effort думают дольше,
      // web_search добавляет ещё время на обход источников.
      // Базовый таймаут = 180с, наращиваем под тяжёлые режимы.
      const timeoutByEffort: Record<string, number> = {
        low: 180000,     // 3 мин
        medium: 300000,  // 5 мин
        high: 480000,    // 8 мин
        xhigh: 600000,   // 10 мин
      };
      let codexTimeout = timeoutByEffort[effort] ?? 180000;
      // web_search увеличивает время → добавляем запас
      if (webSearchEnabled) {
        codexTimeout += 120000; // +2 мин
      }

      this.logger.debug(
        `KIE Codex generate: model=${codexModel}, effort=${effort}, ` +
        `webSearch=${webSearchEnabled}, timeout=${codexTimeout}ms, ` +
        `inputBlocks=${input.length}`,
      );

      const response = await this.client.post(responsesEndpoint, body, {
        timeout: codexTimeout,
      });

      const data = response.data;

      // ─── Извлечение текста из output[].content[].text ───
      let content = '';
      const output = Array.isArray(data?.output) ? data.output : [];
      for (const item of output) {
        if (item?.type === 'message' && Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part?.type === 'output_text' && typeof part.text === 'string') {
              content += part.text;
            } else if (typeof part?.text === 'string') {
              content += part.text;
            }
          }
        }
      }

      // Fallback: иногда текст может лежать в output_text напрямую
      if (!content && typeof data?.output_text === 'string') {
        content = data.output_text;
      }

      this.logger.debug(
        `KIE Codex response: status=${data?.status}, contentLen=${content.length}, ` +
        `usage=${JSON.stringify(data?.usage || {})}`,
      );

      return {
        success: true,
        data: {
          content,
          metadata: { model: codexModel },
        },
        usage: {
          inputTokens: data?.usage?.input_tokens,
          outputTokens: data?.usage?.output_tokens,
          totalTokens: data?.usage?.total_tokens,
        },
        responseTimeMs: Date.now() - start,
        providerSlug: this.slug,
      };
    } catch (error: any) {
      this.logger.error(
        `KIE Codex generateText error: ${error?.response?.status} - ${error.message}`,
      );
      if (error?.response?.data) {
        this.logger.error(
          `KIE Codex error data: ${JSON.stringify(error.response.data).substring(0, 500)}`,
        );
      }
      return this.handleError(error, start);
    }
  }

  /**
   * 🆕 Конвертирует messages[] (chat формат) в input[] (codex responses формат).
   *
   * Chat: { role, content: string | any[], imageUrls?: [] }
   * Codex: { role, content: [{ type: 'input_text', text }, { type: 'input_image', image_url }] }
   */
  private buildCodexInput(messages: any[]): any[] {
    const input: any[] = [];

    for (const msg of messages) {
      const role = msg.role === 'assistant' ? 'assistant' : msg.role === 'system' ? 'system' : 'user';
      // 🔧 KIE Codex responses API: assistant → output_text, user/system → input_text.
      // input_text в блоке assistant вызывает 422 "The param is not a valid JSON object"
      // (подтверждено curl). Это ломало каждый 2-й запрос (история диалога с ответом ассистента).
      const textType = role === 'assistant' ? 'output_text' : 'input_text';
      const content: any[] = [];

      const textVal = typeof msg.content === 'string' ? msg.content : '';
      if (textVal && textVal.trim().length > 0) {
        content.push({ type: textType, text: textVal });
      }

      // Vision: imageUrls → input_image (только для user/system, у assistant входных картинок нет)
      if (role !== 'assistant' && Array.isArray(msg.imageUrls) && msg.imageUrls.length > 0) {
        for (const url of msg.imageUrls) {
          if (url) content.push({ type: 'input_image', image_url: url });
        }
      }

      // Если content уже массив (multimodal) — конвертируем OpenAI-формат
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part?.type === 'text' && part.text) {
            content.push({ type: textType, text: part.text });
          } else if (part?.type === 'image_url' && role !== 'assistant') {
            const url = part.image_url?.url || part.image_url;
            if (url) content.push({ type: 'input_image', image_url: url });
          }
        }
      }

      // Пропускаем пустые сообщения
      if (content.length === 0) continue;

      input.push({ role, content });
    }

    return input;
  }

  async *generateTextStream(request: TextGenerationRequest): AsyncGenerator<StreamChunk> {
    // 🆕 GPT 5.6 — codex API через настоящий SSE-стрим.
    // stream:true обходит Cloudflare 524 (origin_response_timeout 120с),
    // т.к. поток байтов идёт непрерывно и таймер "молчания" не срабатывает.
    if (KIE_CODEX_MODELS[request.model] || KIE_GROK_MODELS[request.model]) {
      yield* this.streamCodexText(request);
      return;
    }

    const endpoint = KieProvider.KIE_TEXT_MODELS[request.model];

    if (!endpoint) {
      yield { content: '', done: true, error: `Text model ${request.model} not supported by KIE` };
      return;
    }

    try {
      const messages = this.prepareMessages(request.messages as any[]);
      const hasImages = messages.some((m: any) => Array.isArray(m.content));

      this.logger.debug(
        `KIE generateTextStream: model=${request.model}, endpoint=${endpoint}, hasImages=${hasImages}`,
      );

      const response = await this.client.post(
        endpoint,
        {
          messages,
          max_tokens: request.maxTokens || 4096,
          temperature: request.temperature ?? 0.7,
          stream: true,
        },
        { responseType: 'stream', timeout: 180000 },
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

      this.logger.warn(`KIE stream ended without [DONE] for model ${request.model}`);
      yield { content: '', done: true };

    } catch (error: any) {
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
  // 🆕 GPT 5.6 CODEX STREAM (KIE /codex/v1/responses, stream:true)
  // Настоящий SSE-стрим — обходит Cloudflare 524 при long reasoning.
  // Формат событий responses API:
  //   response.output_text.delta  → { delta: "..." }
  //   response.completed          → { response: { usage } }
  //   response.failed / error     → ошибка
  // ═══════════════════════════════════════════════════════
  private async *streamCodexText(
    request: TextGenerationRequest,
  ): AsyncGenerator<StreamChunk> {
    const isGrok = !!KIE_GROK_MODELS[request.model];
    const codexModel = isGrok
      ? KIE_GROK_MODELS[request.model]
      : KIE_CODEX_MODELS[request.model];
    const responsesEndpoint = isGrok ? '/grok/v1/responses' : '/codex/v1/responses';

    if (!codexModel) {
      yield { content: '', done: true, error: `Codex/Grok model ${request.model} not supported by KIE` };
      return;
    }

    try {
      const input = this.buildCodexInput(request.messages as any[]);

      const allowedEfforts = ['low', 'medium', 'high', 'xhigh'];
      const rawEffort = (request as any).reasoningEffort;
      const effort = allowedEfforts.includes(rawEffort) ? rawEffort : 'low';

      const body: Record<string, any> = {
        model: codexModel,
        input,
        stream: true,
        reasoning: { effort },
      };

      const webSearchEnabled = (request as any).webSearch === true;
      if (webSearchEnabled) {
        body.tools = [{ type: 'web_search' }];
      }

      // Таймаут на неактивность потока. При stream:true чанки идут
      // регулярно, поэтому даём большой запас на паузы reasoning.
      const timeoutByEffort: Record<string, number> = {
        low: 300000,     // 5 мин
        medium: 480000,  // 8 мин
        high: 720000,    // 12 мин
        xhigh: 900000,   // 15 мин
      };
      let codexTimeout = timeoutByEffort[effort] ?? 300000;
      if (webSearchEnabled) codexTimeout += 180000; // +3 мин

      this.logger.debug(
        `KIE Codex STREAM: model=${codexModel}, effort=${effort}, ` +
        `webSearch=${webSearchEnabled}, timeout=${codexTimeout}ms, inputBlocks=${input.length}`,
      );

      const response = await this.client.post(responsesEndpoint, body, {
        responseType: 'stream',
        timeout: codexTimeout,
      });

      let buffer = '';
      let emittedContent = false;
      let usage: { inputTokens?: number; outputTokens?: number } = {};
      const stream = response.data;

      for await (const chunk of stream) {
        buffer += chunk.toString();

        // SSE-события разделены двойным переводом строки
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const evt of events) {
          // В событии могут быть строки "event: ..." и "data: ..."
          const dataLines = evt
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim());

          if (dataLines.length === 0) continue;
          const dataStr = dataLines.join('');

          if (dataStr === '[DONE]') {
            yield { content: '', done: true, usage };
            return;
          }

          let parsed: any;
          try {
            parsed = JSON.parse(dataStr);
          } catch {
            continue; // неполный/служебный чанк
          }

          const type = parsed?.type;

          // ─── Дельта текста ───
          if (type === 'response.output_text.delta') {
            const delta = typeof parsed.delta === 'string' ? parsed.delta : '';
            if (delta) {
              emittedContent = true;
              yield { content: delta, done: false };
            }
            continue;
          }

          // ─── Ошибки ───
          if (type === 'response.failed' || type === 'error') {
            const errMsg =
              parsed?.response?.error?.message ||
              parsed?.error?.message ||
              parsed?.message ||
              'Codex stream failed';
            this.logger.error(`KIE Codex stream event error: ${errMsg}`);
            yield { content: '', done: true, error: errMsg };
            return;
          }

          // ─── Завершение: забираем usage ───
          if (type === 'response.completed' || type === 'response.incomplete') {
            const u = parsed?.response?.usage;
            if (u) {
              usage = {
                inputTokens: u.input_tokens,
                outputTokens: u.output_tokens,
              };
            }
            // Fallback: если дельт не было, но есть готовый output — отдаём разом
            if (!emittedContent) {
              const out = Array.isArray(parsed?.response?.output)
                ? parsed.response.output
                : [];
              let full = '';
              for (const item of out) {
                if (item?.type === 'message' && Array.isArray(item.content)) {
                  for (const part of item.content) {
                    if (typeof part?.text === 'string') full += part.text;
                  }
                }
              }
              if (full) yield { content: full, done: false };
            }
            yield { content: '', done: true, usage };
            return;
          }
        }
      }

      // Поток закончился без явного завершающего события
      this.logger.warn(`KIE Codex stream ended without completed event (model=${codexModel})`);
      yield { content: '', done: true, usage };
    } catch (error: any) {
      const status = error?.response?.status;
      let errorMessage = error.message;

      try {
        if (error?.response?.data && typeof error.response.data.pipe === 'function') {
          const chunks: Buffer[] = [];
          for await (const c of error.response.data) {
            chunks.push(Buffer.from(c));
            if (chunks.length > 5) break;
          }
          const bodyStr = Buffer.concat(chunks).toString('utf8').substring(0, 500);
          try {
            const parsed = JSON.parse(bodyStr);
            errorMessage = parsed?.error?.message || parsed?.detail || parsed?.msg || bodyStr;
          } catch {
            errorMessage = bodyStr || error.message;
          }
        } else if (typeof error?.response?.data === 'string') {
          errorMessage = error.response.data.substring(0, 500);
        } else if (error?.response?.data?.detail) {
          errorMessage = error.response.data.detail;
        }
      } catch {
        errorMessage = `HTTP ${status}: ${error.message}`;
      }

      this.logger.error(`KIE Codex stream error: status=${status}, message=${errorMessage}`);
      yield { content: '', done: true, error: `KIE Codex: ${status || 'NETWORK'} - ${errorMessage}` };
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
    } catch (error: any) {
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
    const responseData = error?.response?.data;
    const message = responseData?.msg || responseData?.message || error.message;

    this.logger.error(
      `KIE API Error Details: status=${status}, ` +
      `message="${message}", ` +
      `fullResponse=${JSON.stringify(responseData)?.substring(0, 500)}`
    );

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