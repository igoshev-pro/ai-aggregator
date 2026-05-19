🎯 SPICHKI AI — Контекст рефакторинга (v3.0)

v3.0 (текущая): разобран весь код провайдеров, storage, interfaces. План работ резко сокращён.
v2.0: дополнено реальными данными БД.
v1.0: концепция.
0. 📊 СВОДКА — РЕАЛЬНОЕ СОСТОЯНИЕ КОДА

0.1. Провайдеры — что уже работает ✅

Файл	Что умеет	Уровень готовности
base-provider.abstract.ts	Базовый интерфейс с DTO для image/video/audio/text	✅ есть все нужные поля (aspectRatio, resolution, quality, outputFormat, inputUrls)
evolink.provider.ts	text (OpenAI + Claude), image, video (Kling I2V/Motion + Veo + Sora 2 Pro), audio	✅ работает, есть маппинг параметров
kie.provider.ts	image (Flux/Seedream/Nano-Banana/MJ/Imagen), video (Sora/Kling/Runway/Hailuo с авто-переключением t2v↔i2v), audio (ElevenLabs 6 моделей + Suno), text (Gemini)	✅✅ сильно проработан, есть KIE_MODEL_PARAMS и VIDEO_MODEL_MAP с параметризацией
openrouter.provider.ts	text стрим + non-stream	✅ работает
openrouter-image.provider.ts	только GPT-5 Image через /chat/completions с modalities: ['image']	✅ работает
replicate.provider.ts	заготовка text/image/video/audio	⚠️ есть, но не используется по факту
provider-registry.service.ts	инициализация + DB sync + health check + встроенный seed моделей	⚠️ внимание! там уже есть seedDefaultModels() — наш сид-скрипт должен заменить эту логику
0.2. Critical insight — seedDefaultModels в registry

🚨 Важно: provider-registry.service.ts уже содержит полный сид 35 моделей прямо в коде (метод seedDefaultModels). Он выполняется при каждом старте приложения через onModuleInit!

Это значит:

Любые ручные изменения в БД через mongosh — затрутся при рестарте (поля из сида перезаписываются через findOneAndUpdate с upsert)
Сид-скрипт надо писать не отдельным файлом, а обновлять seedDefaultModels в registry
ИЛИ — вынести сид во внешний скрипт, а из registry убрать перезапись
0.3. KIE — параметры моделей УЖЕ настроены

В kie.provider.ts уже есть полная таблица KIE_MODEL_PARAMS для image и VIDEO_MODEL_MAP для video с описанием доступных параметров. То что я в v2.0 спрашивал «как передать resolution/quality/sound» — уже отвечено в коде:

Image (из KIE_MODEL_PARAMS):

Модель	aspectRatio	resolution/quality	inputImages
flux-2/flex-text-to-image	7 опций	resolution: 1K, 2K	—
flux-2/flex-image-to-image	8 опций	resolution: 1K, 2K	input_urls, max 8
flux-2/pro-text-to-image	7 опций	resolution: 1K, 2K	—
flux-2/pro-image-to-image	8 опций	resolution: 1K, 2K	input_urls, max 8
seedream/5-lite-text-to-image	8 опций	quality: basic/high	—
seedream/5-lite-image-to-image	8 опций	quality: basic/high	image_urls, max 14
google/imagen4-fast	5 опций	—	—
nano-banana-2	15 опций	resolution: 1K/2K/4K + outputFormat	image_input, max 14
nano-banana-pro	11 опций	resolution: 1K/2K/4K + outputFormat	image_input, max 8
mj_txt2img / mj_img2img	7 опций	resolution: 1K/2K	—
Video (из VIDEO_MODEL_MAP):

Модель	duration	aspect	special
sora-2-text-to-video	n_frames: 10/15	portrait/landscape	removeWatermark
sora-2-image-to-video	n_frames: 10/15	portrait/landscape	removeWatermark
kling-3.0/video	3–15	16:9/9:16/1:1	sound, mode (std/pro), multi_shots
kling-3.0/motion-control	3–15	16:9/9:16/1:1	mode
runway	5/10	5 опций	quality (через body)
hailuo/02-text-to-video-standard	6/10	—	promptOptimizer
hailuo/2-3-image-to-video-standard	6/10	—	resolution (768P/...)
hailuo/2-3-image-to-video-pro	6/10	—	resolution
hailuo/02-text-to-video-pro	6/10	—	promptOptimizer
❗ В БД для Hailuo Pro нет mapping на hailuo/02-text-to-video-pro — текущая запись hailuo-2.3-pro имеет только hailuo/2-3-image-to-video-pro. Это означает что для text-to-video Hailuo Pro не работает (нет fallback). Нужно либо добавить второй маппинг, либо сделать так как sora-2 — отдельные slug'и.

Audio (Suno + ElevenLabs):

Suno V4: эндпоинт /api/v1/generate, есть отдельный мапинг моделей V3_5/V4/V4_5/V5
ElevenLabs: 6 модельных ID работают через /api/v1/jobs/createTask
Suno операции (extend/boost/cover etc.) — ⚠️ нет в коде, только generate
0.4. Storage — полная картина

storage.service.ts — готов:

✅ Timeweb Cloud S3 настроен (forcePathStyle: true, region ru-1)
✅ downloadAndSave(url, userId, type) — основной метод
✅ uploadBuffer(buffer, key, contentType) — для пользовательских загрузок
✅ saveBase64 — для GPT-5 Image и подобных
✅ Структура: ${type}s/${userId}/${uuid}.${ext} (images/, videos/, audios/)
❌ Нет контроллера /upload — для img2img нужно создать
0.5. Interfaces — статус enum'ов

✅ SubscriptionPlan: уже расширен до 5 планов (FREE, BASIC, PLUS, MAX, ULTIMATE) + deprecated PRO, UNLIMITED
✅ GenerationType, GenerationStatus, UserRole, TransactionType — есть
⚠️ limits.includedInPlans в сиде использует ['pro', 'unlimited'] — нужно обновить на новые планы
0.6. .env Evolink


EVOLINK_API_KEY=xxx
EVOLINK_BASE_URL=https://api.evolink.ai/v1
✅ Понятно.

1. 🎯 ЦЕЛЕВАЯ АРХИТЕКТУРА — ТОЧНЕЕ

1.1. Что НЕ нужно делать (отменяется из v2.0)

Задача из v2.0	Почему отменяется
Передавать resolution: 1K/2K/4K через специальный маппинг	✅ Уже работает в kie.provider.ts через input.resolution
Маппить quality: basic/high для seedream	✅ Уже работает
Маппить outputFormat для nano-banana	✅ Уже работает
Передавать sound: bool для Kling	✅ Уже работает (input.sound)
Передавать mode: std/pro для Kling	✅ Уже работает (input.mode)
Передавать removeWatermark для Sora	✅ Уже работает
Передавать promptOptimizer для Hailuo	✅ Уже работает
Авто-переключение t2v↔i2v для Sora/Hailuo	✅ Уже работает в generateVideo через детекцию hasImage
1.2. Что НУЖНО сделать (после изучения кода)

🔴 Критично — основное:

Добавить pricingMatrix + uiParameters в схему AIModel (новые поля)
Обновить seedDefaultModels в provider-registry.service.ts:
Добавить pricingMatrix для 11 моделей
Добавить uiParameters для 11 моделей
Обновить цены (fixedCostPerGeneration) согласно прайсу SPICHKI
Обновить includedInPlans на новые планы (['plus', 'max', 'ultimate'] вместо ['pro', 'unlimited'])
Деактивировать deepseek-v4, elevenlabs-tts
Изменить tokensPerDollar на ~30
Создать PricingService с методом calculatePrice(modelSlug, params)
Создать эндпоинт POST /generation/calculate-price
Интегрировать PricingService в GenerationService (заменить billingService.calculateGenerationCost)
🟡 Среднее — расширение функций:

Suno операции — добавить operation параметр в generateAudio в kie.provider.ts:
Найти эндпоинты у KIE: extend, boost, cover, mashup, music_video, add_vocals, add_instrumental
Расширить switch-case в generateAudio для Suno
Hailuo Pro text-to-video — добавить отдельный slug hailuo-2.3-pro-t2v или второй mapping в hailuo-2.3-pro
Контроллер /upload — для пользовательских загрузок изображений
Чат мультимодальность — attachments в Message schema + vision для evolink
🟢 Опционально:

Админка управления pricingMatrix
Расширить capabilities text-моделей (documents, voice-input)
inputCapabilities в AIModel
2. 📋 КАТАЛОГ МОДЕЛЕЙ — ФИНАЛЬНЫЕ МАТРИЦЫ ЦЕН

2.1. Текст — без pricingMatrix, через costPerMillionInput/OutputTokens

Действия: оставляем как есть, только меняем includedInPlans:

grok-4: ['plus', 'max', 'ultimate']
gpt-5.4: ['ultimate']
claude-opus-4.6: ['ultimate']
claude-sonnet-4.6: ['plus', 'max', 'ultimate']
gpt-oss-120b, deepseek-v3.2, grok-4.1-fast: безлимит для ['plus', 'max', 'ultimate']
deepseek-v4: isActive: false
2.2. Изображения — pricingMatrix

Ts

// midjourney
pricingMatrix: [
  { conditions: { mode: 'normal' }, costInTokens: 2, costInDollars: 0.015, label: 'Обычный' },
  { conditions: { mode: 'fast' },   costInTokens: 4, costInDollars: 0.04,  label: 'Быстрый' },
  { conditions: { mode: 'turbo' },  costInTokens: 6, costInDollars: 0.06,  label: 'Турбо' },
],
uiParameters: [
  {
    key: 'mode', label: 'Режим', type: 'select',
    options: [
      { value: 'normal', label: 'Обычный (2🔥)' },
      { value: 'fast',   label: 'Быстрый (4🔥)' },
      { value: 'turbo',  label: 'Турбо (6🔥)' },
    ],
    default: 'normal', affectsPrice: true,
  },
  {
    key: 'aspectRatio', label: 'Соотношение', type: 'select',
    options: [
      { value: '1:1', label: '1:1' }, { value: '16:9', label: '16:9' },
      { value: '9:16', label: '9:16' }, { value: '4:3', label: '4:3' },
      { value: '3:4', label: '3:4' }, { value: '3:2', label: '3:2' },
      { value: '2:3', label: '2:3' },
    ],
    default: '1:1', affectsPrice: false,
  },
]

// flux-2 — нужны 2 mapping (normal/pro)
providerMappings: [
  { providerSlug: 'kie', modelId: 'flux-2/flex-text-to-image', priority: 1, isActive: true,
    metadata: { version: 'normal' } },
  { providerSlug: 'kie', modelId: 'flux-2/pro-text-to-image',  priority: 2, isActive: true,
    metadata: { version: 'pro' } },
],
pricingMatrix: [
  { conditions: { version: 'normal', resolution: '1K' }, costInTokens: 5, costInDollars: 0.06 },
  { conditions: { version: 'normal', resolution: '2K' }, costInTokens: 8, costInDollars: 0.10 },
  { conditions: { version: 'pro',    resolution: '1K' }, costInTokens: 2, costInDollars: 0.02 },
  { conditions: { version: 'pro',    resolution: '2K' }, costInTokens: 3, costInDollars: 0.04 },
],
uiParameters: [
  { key: 'version', label: 'Версия', type: 'select',
    options: [{value:'normal',label:'Normal'}, {value:'pro',label:'Pro'}],
    default: 'pro', affectsPrice: true },
  { key: 'resolution', label: 'Разрешение', type: 'select',
    options: [{value:'1K',label:'1K'},{value:'2K',label:'2K'}],
    default: '1K', affectsPrice: true },
  { key: 'aspectRatio', label: 'Соотношение', type: 'select', /* ... */ affectsPrice: false },
]

// nano-banana-2
pricingMatrix: [
  { conditions: { resolution: '1K' }, costInTokens: 4, costInDollars: 0.039 },
  { conditions: { resolution: '2K' }, costInTokens: 4, costInDollars: 0.039 },
  { conditions: { resolution: '4K' }, costInTokens: 6, costInDollars: 0.06 },
]

// nano-banana-pro
pricingMatrix: [
  { conditions: { resolution: '1K' }, costInTokens: 6, costInDollars: 0.06 },
  { conditions: { resolution: '2K' }, costInTokens: 6, costInDollars: 0.06 },
  { conditions: { resolution: '4K' }, costInTokens: 8, costInDollars: 0.08 },
]

// flat-цены:
gpt-5-image: fixedCostPerGeneration → 4🔥
gpt-image-1.5-lite: → 2🔥
midjourney-img2img: → 2🔥
seedream-5-lite: → 2🔥
imagen-4: → 2🔥
flux-2-img2img: → 5🔥
2.3. Видео — pricingMatrix

Ts

// sora-2 (KIE) - n_frames: 10/15
pricingMatrix: [
  { conditions: { duration: 10 }, costInTokens: 14, costInDollars: 0.15 },
  { conditions: { duration: 15 }, costInTokens: 16, costInDollars: 0.18 },
  { conditions: { duration: 10, stable: true }, costInTokens: 16, costInDollars: 0.18 },
  { conditions: { duration: 15, stable: true }, costInTokens: 18, costInDollars: 0.20 },
]
// ❗ Sora "stable" — у KIE такого параметра НЕТ в VIDEO_MODEL_MAP.
//   Нужно либо найти как передать в KIE, либо отказаться от параметра.

// kling-3.0
pricingMatrix: [
  { conditions: { resolution: '720p' },                 costInTokens: 5, costInDollars: 0.06 },
  { conditions: { resolution: '720p', sound: true },    costInTokens: 6, costInDollars: 0.07 },
  { conditions: { resolution: '1080p' },                costInTokens: 6, costInDollars: 0.07 },
  { conditions: { resolution: '1080p', sound: true },   costInTokens: 9, costInDollars: 0.11 },
]
uiParameters: [
  { key: 'resolution', label: 'Качество', type: 'select',
    options: [{value:'720p',label:'720p'},{value:'1080p',label:'1080p'}],
    default: '720p', affectsPrice: true },
  { key: 'sound', label: 'Со звуком', type: 'toggle', default: false, affectsPrice: true },
]
// ❗ KIE Kling: текущий код подставляет mode (std/pro), но не resolution.
//   Нужно проверить — поддерживает ли Kling 3.0/video поле resolution.

// runway
pricingMatrix: [
  { conditions: { resolution: '720p',  duration: 5 },  costInTokens: 6,  costInDollars: 0.07 },
  { conditions: { resolution: '720p',  duration: 10 }, costInTokens: 15, costInDollars: 0.16 },
  { conditions: { resolution: '1080p', duration: 5 },  costInTokens: 15, costInDollars: 0.16 },
  { conditions: { resolution: '1080p', duration: 10 }, costInTokens: 30, costInDollars: 0.32 },
]

// hailuo-2.3-standard
pricingMatrix: [
  { conditions: { resolution: '768P',  duration: 6 },  costInTokens: 10, costInDollars: 0.10 },
  { conditions: { resolution: '768P',  duration: 10 }, costInTokens: 16, costInDollars: 0.17 },
  { conditions: { resolution: '1080P', duration: 6 },  costInTokens: 16, costInDollars: 0.17 },
]

// hailuo-2.3-pro
pricingMatrix: [
  { conditions: { resolution: '768P',  duration: 6 },  costInTokens: 14, costInDollars: 0.16 },
  { conditions: { resolution: '768P',  duration: 10 }, costInTokens: 28, costInDollars: 0.30 },
  { conditions: { resolution: '1080P', duration: 6 },  costInTokens: 35, costInDollars: 0.40 },
]

// veo-3.1-fast (Evolink)
pricingMatrix: [
  { conditions: { resolution: '720p' }, costInTokens: 15, costInDollars: 0.15 },
  { conditions: { resolution: '4K' },   costInTokens: 46, costInDollars: 0.50 },
]
// ❗ Evolink Veo: текущий код передаёт resolution → body.quality. Нужно проверить
//   поддерживает ли Evolink Veo поле quality='4K'.

// veo-3.1-pro
pricingMatrix: [
  { conditions: { resolution: '1080p' }, costInTokens: 75,  costInDollars: 0.80 },
  { conditions: { resolution: '4K' },    costInTokens: 112, costInDollars: 1.20 },
]

// flat: sora-2-img2vid=14🔥, sora-2-pro=87🔥, kling-3.0-img2vid=5🔥, kling-3.0-motion=5🔥
2.4. Аудио — pricingMatrix только для Suno

Ts

// suno-v4 — операции
pricingMatrix: [
  { conditions: { operation: 'boost' },            costInTokens: 1, costInDollars: 0.013 },
  { conditions: { operation: 'generate' },         costInTokens: 4, costInDollars: 0.06 },
  { conditions: { operation: 'extend' },           costInTokens: 4, costInDollars: 0.06 },
  { conditions: { operation: 'add_vocals' },       costInTokens: 4, costInDollars: 0.06 },
  { conditions: { operation: 'cover' },            costInTokens: 4, costInDollars: 0.06 },
  { conditions: { operation: 'add_instrumental' }, costInTokens: 4, costInDollars: 0.06 },
  { conditions: { operation: 'mashup' },           costInTokens: 4, costInDollars: 0.06 },
  { conditions: { operation: 'music_video' },      costInTokens: 4, costInDollars: 0.06 },
]
// ❗ В KIE текущий код умеет только 'generate'. Нужно добавить остальные 7 операций
//   с правильными KIE endpoints.

// elevenlabs-* — все flat, уже правильно

3. 🛠 ПЛАН РАБОТ — ФИНАЛ

✅ Этап 0. Обновить AIModel схему ⚡ ПРИОРИТЕТ

Файл: src/modules/ai-providers/schemas/model.schema.ts

Полная обновлённая версия:

Ts

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { GenerationType } from '@/common/interfaces';

export type ModelDocument = AIModel & Document;

// ─── НОВЫЕ ИНТЕРФЕЙСЫ ───────────────────────────────────

export interface PricingRule {
  conditions: Record<string, any>;   // { mode: 'turbo', resolution: '2K' }
  costInTokens: number;
  costInDollars: number;
  label?: string;                     // для админки
}

export interface UIParameterOption {
  value: string | number | boolean;
  label: string;
}

export interface UIParameter {
  key: string;                        // 'mode', 'resolution', 'duration'...
  label: string;                      // 'Режим', 'Разрешение'
  type: 'select' | 'toggle' | 'number' | 'text' | 'image-upload' | 'audio-upload' | 'video-upload';
  options?: UIParameterOption[];
  default?: any;
  affectsPrice?: boolean;
  visibleWhen?: Record<string, any>;  // условия отображения: { mode: ['fast', 'turbo'] }
  min?: number;                       // для type='number'
  max?: number;
  step?: number;
  placeholder?: string;               // для type='text'
}

export interface InputCapabilities {
  acceptsImages?: boolean;
  acceptsFiles?: boolean;
  acceptsAudio?: boolean;
  acceptsVideo?: boolean;
  maxInputImages?: number;
  maxFileSize?: number;               // в MB
  acceptedMimeTypes?: string[];
}

// ─── СХЕМА ───────────────────────────────────────────────

@Schema({ timestamps: true })
export class AIModel {
  @Prop({ required: true, unique: true })
  slug: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  displayName: string;

  @Prop()
  description: string;

  @Prop()
  icon: string;

  @Prop({ required: true, enum: GenerationType })
  type: GenerationType;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  isPremium: boolean;

  @Prop({ default: 0 })
  sortOrder: number;

  @Prop({ default: 0 })
  costPerMillionInputTokens: number;

  @Prop({ default: 0 })
  costPerMillionOutputTokens: number;

  @Prop({ default: 0 })
  fixedCostPerGeneration: number;

  @Prop({ default: 30 })  // ⚠️ ИЗМЕНЕНО: было 100, теперь 30 (1$ ≈ 30 спичек)
  tokensPerDollar: number;

  @Prop({ default: 1 })
  minTokenCost: number;

  // DEPRECATED
  @Prop({ required: false })
  tokenCost: number;

  @Prop({
    type: [{
      providerId: { type: Types.ObjectId, ref: 'Provider' },
      providerSlug: String,
      modelId: String,
      priority: Number,
      isActive: Boolean,
      metadata: Object,             // ⚠️ ДОБАВЛЕНО: { version: 'pro' } для flux
    }],
    default: [],
  })
  providerMappings: {
    providerId: Types.ObjectId;
    providerSlug: string;
    modelId: string;
    priority: number;
    isActive: boolean;
    metadata?: Record<string, any>;
  }[];

  @Prop({ type: Object, default: {} })
  defaultParams: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    width?: number;
    height?: number;
    steps?: number;
    duration?: number;
    fps?: number;
  };

  @Prop({ type: Object, default: {} })
  limits: {
    maxInputTokens?: number;
    maxOutputTokens?: number;
    maxImagesPerRequest?: number;
    maxResolution?: string;
    maxDuration?: number;
    cooldownSeconds?: number;
    includedInPlans?: string[];     // ['plus', 'max', 'ultimate']
    freeLimitPerHour?: number;      // ⚠️ ДОБАВЛЕНО: для Ultimate (10/час)
    freeLimitPerDay?: number;       // ⚠️ ДОБАВЛЕНО: для Ultimate (60/сутки)
  };

  @Prop({ type: [String], default: [] })
  capabilities: string[];

  // ⚠️ НОВОЕ ПОЛЕ
  @Prop({
    type: [{
      conditions: Object,
      costInTokens: Number,
      costInDollars: Number,
      label: String,
    }],
    default: [],
  })
  pricingMatrix: PricingRule[];

  // ⚠️ НОВОЕ ПОЛЕ
  @Prop({
    type: [{
      key: String,
      label: String,
      type: String,
      options: [{ value: Object, label: String }],
      default: Object,
      affectsPrice: Boolean,
      visibleWhen: Object,
      min: Number,
      max: Number,
      step: Number,
      placeholder: String,
    }],
    default: [],
  })
  uiParameters: UIParameter[];

  // ⚠️ НОВОЕ ПОЛЕ
  @Prop({ type: Object, default: {} })
  inputCapabilities: InputCapabilities;

  @Prop({ type: Object, default: {} })
  stats: {
    totalRequests: number;
    avgResponseTime: number;
    successRate: number;
  };
}

export const AIModelSchema = SchemaFactory.createForClass(AIModel);
AIModelSchema.index({ type: 1, isActive: 1, sortOrder: 1 });
Миграция: новые поля имеют default: [] / default: {} → существующие записи не сломаются, поля просто будут пустыми. Сид-скрипт их заполнит.

✅ Этап 1. PricingService

Файл: src/modules/billing/pricing.service.ts (новый)

Ts

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AIModel, ModelDocument, PricingRule } from '../ai-providers/schemas/model.schema';

export interface PriceCalculation {
  costInTokens: number;
  costInDollars: number;
  matchedRule?: PricingRule;
  fallback: boolean;        // true если использовали fixedCostPerGeneration
  breakdown: {
    modelSlug: string;
    modelName: string;
    type: string;
    rule?: string;          // label правила
    params: Record<string, any>;
  };
}

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    @InjectModel(AIModel.name) private modelModel: Model<ModelDocument>,
  ) {}

  /**
   * Рассчитать стоимость генерации.
   * Для text — использует costPerMillionInput/OutputTokens (legacy метод).
   * Для media — ищет правило в pricingMatrix → fixedCostPerGeneration.
   */
  async calculatePrice(
    modelSlug: string,
    params: Record<string, any> = {},
  ): Promise<PriceCalculation> {
    const model = await this.modelModel.findOne({ slug: modelSlug, isActive: true });

    if (!model) {
      throw new NotFoundException(`Model "${modelSlug}" not found or inactive`);
    }

    // Для текстовых моделей — другая логика (по usage), здесь возвращаем минимум
    if (model.type === 'text') {
      return {
        costInTokens: model.minTokenCost,
        costInDollars: model.fixedCostPerGeneration || 0,
        fallback: true,
        breakdown: {
          modelSlug: model.slug,
          modelName: model.name,
          type: 'text',
          rule: 'minimum (real cost will be calculated after streaming)',
          params,
        },
      };
    }

    // 1. Ищем подходящее правило в pricingMatrix
    const matched = this.findMatchingRule(model.pricingMatrix, params);

    if (matched) {
      return {
        costInTokens: matched.costInTokens,
        costInDollars: matched.costInDollars,
        matchedRule: matched,
        fallback: false,
        breakdown: {
          modelSlug: model.slug,
          modelName: model.name,
          type: model.type,
          rule: matched.label || JSON.stringify(matched.conditions),
          params,
        },
      };
    }

    // 2. Fallback: fixedCostPerGeneration
    const fallbackTokens = Math.max(
      model.minTokenCost,
      Math.ceil((model.fixedCostPerGeneration || 0) * (model.tokensPerDollar || 30)),
    );

    return {
      costInTokens: fallbackTokens,
      costInDollars: model.fixedCostPerGeneration || 0,
      fallback: true,
      breakdown: {
        modelSlug: model.slug,
        modelName: model.name,
        type: model.type,
        rule: 'fixed-price fallback',
        params,
      },
    };
  }

  /**
   * Найти правило где ВСЕ conditions ⊆ params.
   * Возвращает первое подходящее (порядок в массиве важен — более специфичные сверху).
   */
  private findMatchingRule(
    matrix: PricingRule[],
    params: Record<string, any>,
  ): PricingRule | null {
    if (!matrix || matrix.length === 0) return null;

    // Сортируем по числу условий (больше условий = выше приоритет)
    const sorted = [...matrix].sort(
      (a, b) => Object.keys(b.conditions).length - Object.keys(a.conditions).length,
    );

    for (const rule of sorted) {
      const allMatch = Object.entries(rule.conditions).every(([key, expected]) => {
        const actual = params[key];

        // Массив значений в правиле — params должен быть одним из них
        if (Array.isArray(expected)) {
          return expected.includes(actual);
        }
        return actual === expected;
      });

      if (allMatch) {
        this.logger.debug(
          `Pricing rule matched for ${JSON.stringify(rule.conditions)} → ${rule.costInTokens}🔥`,
        );
        return rule;
      }
    }

    return null;
  }
}
⚠️ Нужен файл: src/modules/billing/billing.service.ts — чтобы я понял как BillingService сейчас связан с UsersService и интегрировал PricingService без поломок.

✅ Этап 2. Эндпоинт POST /generation/calculate-price

Файл 1: src/modules/generation/dto/calculate-price.dto.ts (новый)

Ts

import { IsString, IsObject, IsOptional } from 'class-validator';

export class CalculatePriceDto {
  @IsString()
  modelSlug: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, any>;
}
Файл 2: src/modules/generation/generation.controller.ts — добавить эндпоинт

Ts

@Post('calculate-price')
@UseGuards(JwtAuthGuard)  // или сделать публичным
async calculatePrice(@Body() dto: CalculatePriceDto) {
  return this.pricingService.calculatePrice(dto.modelSlug, dto.params || {});
}
⚠️ Нужен файл: src/modules/generation/generation.controller.ts — чтобы понять стиль.

✅ Этап 3. Унификация Generation DTO

Файл: src/modules/generation/dto/generation.dto.ts (полный рефактор)

Ts

import { IsString, IsOptional, IsNumber, IsBoolean, IsArray, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class DialogueLineDto {
  @IsString() text: string;
  @IsString() voice: string;
}

export class BaseGenerationDto {
  @IsString()
  modelSlug: string;

  @IsString()
  prompt: string;

  @IsOptional() @IsString()
  negativePrompt?: string;

  /** Произвольные параметры — попадают в pricingMatrix matcher */
  @IsOptional() @IsObject()
  params?: Record<string, any>;
}

export class ImageGenerationDto extends BaseGenerationDto {
  // Общие
  @IsOptional() @IsString()
  aspectRatio?: string;
  @IsOptional() @IsString()
  resolution?: string;            // '1K' | '2K' | '4K'
  @IsOptional() @IsString()
  quality?: string;               // 'basic' | 'high' (seedream)
  @IsOptional() @IsString()
  outputFormat?: string;          // 'png' | 'jpg'
  @IsOptional() @IsNumber()
  numImages?: number;
  @IsOptional() @IsArray()
  inputUrls?: string[];           // img2img

  // ─── НОВЫЕ ПАРАМЕТРЫ ───
  @IsOptional() @IsString()
  mode?: string;                  // midjourney: normal/fast/turbo
  @IsOptional() @IsString()
  version?: string;               // flux: normal/pro
  @IsOptional() @IsNumber()
  seed?: number;
  @IsOptional() @IsString()
  style?: string;
}

export class VideoGenerationDto extends BaseGenerationDto {
  @IsOptional() @IsString()
  imageUrl?: string;              // i2v
  @IsOptional() @IsArray()
  imageUrls?: string[];
  @IsOptional() @IsNumber()
  duration?: number;
  @IsOptional() @IsString()
  aspectRatio?: string;
  @IsOptional() @IsString()
  resolution?: string;            // '720p' | '1080p' | '4K' | '768P'
  @IsOptional() @IsString()
  mode?: string;                  // kling: std/pro
  @IsOptional() @IsBoolean()
  sound?: boolean;                // kling sound
  @IsOptional() @IsBoolean()
  stable?: boolean;               // sora stable
  @IsOptional() @IsBoolean()
  removeWatermark?: boolean;      // sora
  @IsOptional() @IsBoolean()
  promptOptimizer?: boolean;      // hailuo
  @IsOptional() @IsString()
  style?: string;
  @IsOptional() @IsArray()
  videoUrls?: string[];           // kling motion-control
}

export class AudioGenerationDto extends BaseGenerationDto {
  // Suno
  @IsOptional() @IsString()
  operation?: string;             // generate/extend/boost/cover/...
  @IsOptional() @IsString()
  style?: string;
  @IsOptional() @IsBoolean()
  instrumental?: boolean;
  @IsOptional() @IsBoolean()
  customMode?: boolean;
  @IsOptional() @IsString()
  title?: string;
  @IsOptional() @IsNumber()
  duration?: number;
  @IsOptional() @IsString()
  audioUrl?: string;              // для extend/cover/etc.

  // ElevenLabs TTS
  @IsOptional() @IsString()
  voiceId?: string;
  @IsOptional() @IsString()
  language?: string;
  @IsOptional() @IsNumber()
  stability?: number;
  @IsOptional() @IsNumber()
  similarity?: number;
  @IsOptional() @IsNumber()
  speed?: number;

  // ElevenLabs SFX
  @IsOptional() @IsBoolean()
  loop?: boolean;
  @IsOptional() @IsNumber()
  promptInfluence?: number;

  // ElevenLabs Dialogue
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => DialogueLineDto)
  dialogue?: DialogueLineDto[];
}
⚠️ Нужен файл: src/modules/generation/dto/ — текущие DTO, чтобы я аккуратно мерж сделал.

✅ Этап 4. Интеграция в GenerationService

Файл: src/modules/generation/generation.service.ts — заменить:

Ts

// БЫЛО:
const { costInTokens } = await this.billingService.calculateGenerationCost(dto.modelSlug);

// СТАЛО:
const priceCalc = await this.pricingService.calculatePrice(
  dto.modelSlug,
  this.extractPricingParams(dto),
);
const costInTokens = priceCalc.costInTokens;

// Сохраняем в Generation:
generation.pricingBreakdown = priceCalc.breakdown;
И добавить хелпер для извлечения параметров влияющих на цену:

Ts

private extractPricingParams(dto: any): Record<string, any> {
  // Только те поля что используются в pricingMatrix
  return {
    mode: dto.mode,
    version: dto.version,
    resolution: dto.resolution,
    quality: dto.quality,
    duration: dto.duration,
    sound: dto.sound,
    stable: dto.stable,
    operation: dto.operation,
    // input для авто-определения img2img:
    hasInputImage: !!(dto.imageUrl || dto.inputUrls?.length || dto.imageUrls?.length),
  };
}
⚠️ Нужен файл: src/modules/generation/generation.service.ts — обязательно, без него не интегрировать.

✅ Этап 5. Обновить seedDefaultModels в registry

Файл: src/modules/ai-providers/provider-registry.service.ts

Заменить весь seedDefaultModels на новый массив с:

pricingMatrix для 11 моделей (из раздела 2)
uiParameters для 11 моделей
inputCapabilities для нужных
Обновлённые цены и includedInPlans
isActive: false для deepseek-v4 и elevenlabs-tts
tokensPerDollar: 30
Я напишу этот файл полностью — это самая большая правка (~700 строк). После моего ответа ты накатишь его и сделаешь docker restart api.

⏳ Этап 6. Suno операции (KIE)

Файл: src/modules/ai-providers/providers/kie.provider.ts → метод generateAudio

Сейчас в Suno используется только /api/v1/generate. Нужно расширить:

Ts

// Внутри блока if (sunoModels.has(modelId)):
const operation = r.operation || 'generate';

const sunoEndpoints: Record<string, string> = {
  generate:         '/api/v1/generate',
  extend:           '/api/v1/generate/extend',
  add_vocals:       '/api/v1/generate/add-vocals',
  cover:            '/api/v1/generate/cover',
  add_instrumental: '/api/v1/generate/add-instrumental',
  boost:            '/api/v1/generate/boost-music-style',
  mashup:           '/api/v1/generate/mashup',
  music_video:      '/api/v1/mj/generate-music-video',
};

const endpoint = sunoEndpoints[operation] || sunoEndpoints.generate;
// + добавить uploadUrl/audioUrl в body для extend/cover/add_*
🔴 Нужны от тебя:

Подтверждение эндпоинтов KIE по операциям Suno (или дай curl на их /models или ссылку на доки)
⏳ Этап 7. Hailuo Pro Text-to-Video

В БД сейчас у hailuo-2.3-pro только маппинг на hailuo/2-3-image-to-video-pro. Для text-to-video нужен второй маппинг.

Решение в сиде: добавить второй маппинг:

Ts

providerMappings: [
  { providerSlug: 'kie', modelId: 'hailuo/2-3-image-to-video-pro', priority: 1, isActive: true,
    metadata: { mode: 'i2v' } },
  { providerSlug: 'kie', modelId: 'hailuo/02-text-to-video-pro',   priority: 2, isActive: true,
    metadata: { mode: 't2v' } },
],
А в KIE уже есть авто-переключение по hasImage → провайдер сам выберет нужный.

⏳ Этап 8. Контроллер /upload

Для img2img / vision в чате нужен:


POST /api/v1/upload/image    multipart/form-data → { url, key, size }
POST /api/v1/upload/audio    → { url, key, size }
POST /api/v1/upload/file     → { url, key, size, mimeType }
Использует существующий StorageService.uploadBuffer. ~30 строк кода.

⚠️ Спрошу: есть ли уже какой-то upload контроллер? Может в users.controller для аватаров? Скинь если есть.

⏳ Этап 9. Чат — мультимодальность

Файлы:

src/modules/chat/schemas/message.schema.ts → добавить attachments[]
src/modules/chat/chat.service.ts → в buildContext пробрасывать images для vision-моделей
evolink.provider.ts → расширить convertToClaudeMessages для поддержки [{type:'image', source:...}]
openrouter.provider.ts → для vision моделей пробрасывать массив content [{type:'text'}, {type:'image_url', image_url:{url}}]
⚠️ Нужен файл: src/modules/chat/chat.service.ts + message.schema.ts

⏳ Этап 10. Админка — pricingMatrix

Эндпоинты:

PUT /admin/models/:slug/pricing — обновить pricingMatrix
PUT /admin/models/:slug/parameters — обновить uiParameters
PUT /admin/models/:slug — общие настройки

⚠️ Нужен файл: src/modules/admin/admin.controller.ts

4. ⚠️ ВАЖНЫЕ ЗАМЕЧАНИЯ К РЕАЛИЗАЦИИ

4.1. Конфликт с seedDefaultModels при рестарте

🔴 КРИТИЧНО: provider-registry.service.ts выполняет seedDefaultModels() при каждом onModuleInit. Это значит:

Если мы обновим запись в БД через mongosh или админку — она затрётся при следующем рестарте API
Поля pricingMatrix / uiParameters из БД (если их нет в коде сида) — тоже могут затереться через findOneAndUpdate с upsert
Решения (выбрать одно):

Вариант А (рекомендую): Сид обновляет только базовые поля, а pricingMatrix/uiParameters — через $setOnInsert (только при создании, не при обновлении):

Ts

await this.modelModel.findOneAndUpdate(
  { slug: modelData.slug },
  {
    $set: {
      // Эти поля всегда обновляются:
      name, displayName, description, type, isActive,
      providerMappings, defaultParams, limits, capabilities,
      costPerMillionInputTokens, costPerMillionOutputTokens,
      fixedCostPerGeneration, tokensPerDollar, minTokenCost, tokenCost,
    },
    $setOnInsert: {
      // Эти поля задаются только при первом создании, потом — только админка:
      pricingMatrix: modelData.pricingMatrix || [],
      uiParameters: modelData.uiParameters || [],
      inputCapabilities: modelData.inputCapabilities || {},
    },
  },
  { upsert: true, new: true },
);
Вариант Б: Отключить seedDefaultModels совсем, держать сид в отдельном npm-скрипте:

Bash

npm run seed:models  # запускается вручную после деплоя
Вариант В: Сид всегда перезаписывает всё (как сейчас) — но тогда админка должна обновлять и код сида тоже (через git PR или через файл-конфиг).

→ Моя рекомендация: Вариант А — он даёт админу гибкость, но при добавлении новой модели через код она инициализируется правильно.

4.2. Маппинг params фронт ↔ KIE — несоответствия

Сейчас фронт (по DTO) может прислать одни ключи, а KIE ждёт другие. Текущая логика в kie.provider.ts:

Что приходит из DTO	Что отправляется в KIE	Где происходит маппинг
aspectRatio: '1:1'	input.aspect_ratio	прямо в provider
resolution: '1K'	input.resolution	в provider
quality: 'high' (seedream)	input.quality	в provider
inputUrls: [...]	input.input_urls / input.image_urls / input.image_input	зависит от модели (через KIE_MODEL_PARAMS.inputImagesField)
imageUrl: '...'	input.image_urls = [imageUrl]	в provider (video)
sound: true	input.sound	в provider
mode: 'std'	input.mode + input.multi_shots, input.multi_prompt	в provider (Kling)
duration: 10	input.duration или input.n_frames: '10'	зависит от модели
resolution: '720p'	body.quality (Runway) или input.resolution: '768P' (Hailuo)	в provider
Проблема 1: для Hailuo KIE требует resolution: '768P' или '1080P' (заглавная P), а мы будем хранить в БД '768p' (строчная). Решение: в pricingMatrix.conditions использовать тот же формат что в KIE (заглавная P), а фронт сам прислал в этом формате. Или нормализовать на стороне PricingService (приводить к lowercase для сравнения).

Проблема 2: для Kling 3.0 в VIDEO_MODEL_MAP есть hasMode: true, но нет поля для resolution! Если KIE Kling не поддерживает 1080p — наш pricingMatrix с условием resolution: '1080p' никогда не сработает на бэке. Нужно либо:

Проверить документацию KIE Kling — поддерживает ли он resolution/quality
Если нет — убрать resolution из uiParameters Kling и использовать flat-цену
🔴 К тебе: документация KIE Kling по параметрам.

Проблема 3: Veo через Evolink — текущий evolink.provider.ts маппит resolution → body.quality. Поддерживает ли Evolink quality: '4K'? Сейчас в defaultParams Veo нет ничего. Нужно либо узнать у Evolink, либо протестировать.

🔴 К тебе: документация Evolink по Veo.

Проблема 4: Sora stable — параметра нет ни в KIE, ни в Evolink. Откуда он? Если это бизнес-требование — возможно, "stable" = quality: 'standard' у Evolink Sora 2 Pro. Уточни.

4.3. Авто-переключение flux normal ↔ pro

Сейчас в БД flux-2 имеет один маппинг flux-2/flex-text-to-image. Если фронт пришлёт version: 'pro' — pricingMatrix посчитает правильную цену, но KIE отправит запрос на normal модель.

Решение: добавить логику в kie.provider.ts — переключение modelId по version:

Ts

// В generateImage, перед формированием input:
const isImg2Img = (request as any).inputUrls?.length > 0;
const version = (request as any).version || 'pro';

let modelId = request.model;
if (modelId.startsWith('flux-2/')) {
  // Поддерживаем: flux-2/flex-text-to-image, flux-2/pro-text-to-image,
  //               flux-2/flex-image-to-image, flux-2/pro-image-to-image
  const variant = version === 'pro' ? 'pro' : 'flex';
  const direction = isImg2Img ? 'image-to-image' : 'text-to-image';
  modelId = `flux-2/${variant}-${direction}`;
  this.logger.debug(`Flux auto-switch: → ${modelId}`);
}
Это аналогично существующей логике Sora/Hailuo переключения в generateVideo.

4.4. Hailuo Pro: img2v vs t2v

Сейчас в БД у hailuo-2.3-pro маппинг только на hailuo/2-3-image-to-video-pro. Если пользователь не загрузит картинку — генерация упадёт.

В KIE авто-переключение работает только если VIDEO_MODEL_MAP содержит парную модель. Сейчас:

hailuo/2-3-image-to-video-pro ↔ hailuo/02-text-to-video-pro ✅ обе в VIDEO_MODEL_MAP
→ Просто сменим маппинг в БД на hailuo/02-text-to-video-pro как priority 1, KIE сам переключит на i2v при наличии картинки.

Аналогично для hailuo-2.3-standard: ставим priority 1 на hailuo/02-text-to-video-standard.

4.5. tokensPerDollar = 30 — пересчёт ценников

Сейчас в БД у моделей tokensPerDollar разный (от 30 до 1000). При смене на 30 нужно проверить что pricingMatrix правильный.

Пример: для nano-banana-pro:

В прайсе: 6🔥 за 1K/2K, 8🔥 за 4K
Стоимость в $: ~$0.06 / ~$0.08 (по нашей цене 1🔥 = $0.033)
В коде fixedCostPerGeneration: 0.04
Если оставить tokensPerDollar=30:

0.04 × 30 = 1.2 → minTokenCost=5 → выйдет 5🔥 (правильно)
НО для pricingMatrix мы прямо пишем costInTokens: 6 → используется как есть, не пересчитывается
Значит tokensPerDollar важен только для fallback через fixedCostPerGeneration. В pricingMatrix цена в спичках задаётся напрямую — это нормально.

⚠️ Но! Если в БД остаются модели без pricingMatrix (например, text-модели), для них tokensPerDollar критично. По коду сида tokenCost рассчитывается как:

Ts

tokenCost = Math.max(minTokenCost, Math.ceil(fixedCostPerGeneration * tokensPerDollar));
Это deprecated поле, но сейчас используется в админке. Нужно ли поддерживать корректность? Думаю, да, но как fallback. Решение: пересчитать всё.

4.6. Совместимость billing.service со старым флоу

В chat.service уже есть:

Ts

await this.billingService.chargeForGeneration(
  userId, modelSlug, 'text', conversationId,
  lastUsage?.inputTokens, lastUsage?.outputTokens,
);
Этот метод по-прежнему нужен для текста — там цена считается после стрима по реальным токенам. PricingService не заменяет его, а дополняет для media.

Финальная схема:

text (чат): BillingService.chargeForGeneration по usage (как сейчас)
image/video/audio: PricingService.calculatePrice + BillingService.recordDeduction (или как там)
⚠️ Поэтому обязательно нужен файл billing.service.ts — без него ломаю существующий чат.

4.7. Storage — нет публичного URL для S3

В storage.service.ts:

Ts

this.publicUrl = this.config.get('S3_PUBLIC_URL', '');
getPublicUrl(key) { return `${this.publicUrl}/${key}`; }
Если S3_PUBLIC_URL не задан — получим /key.png (битый URL). Из реальной генерации видим что URL формируется как:


https://s3.timeweb.cloud/15f093e9-3f11-4102-9b84-7e88c06f555d/audios/...
→ S3_PUBLIC_URL=https://s3.timeweb.cloud/15f093e9-3f11-4102-9b84-7e88c06f555d должен быть в .env.

🔴 К тебе: подтверди, что эта переменная задана в .env сервера.

4.8. Replicate — выключить?

В provider-registry Replicate инициализируется если задан REPLICATE_API_KEY. По коду провайдеры моделей никогда не маппятся на replicate — он не используется. Можно:

Удалить файл replicate.provider.ts
Удалить инициализацию из provider-registry
ИЛИ оставить как «запасной» провайдер на будущее.

→ Не критично, но засоряет код. Рекомендую: удалить или закомментировать.

4.9. WebSocket / уведомления о цене

Текущий поток:


POST /generation/image → списать → put в queue → consumer → WS notify
Что если пользователь сначала хочет узнать цену с конкретными параметрами? Сейчас фронт должен:

На каждое изменение селекта → POST /generation/calculate-price
Получить цену
При нажатии «Сгенерировать» → POST /generation/image (с теми же params)
Риск: между шагами 2 и 3 — админ обновил pricingMatrix → цены разные. Решение: на бэке при создании генерации ещё раз вызвать PricingService.calculatePrice и списать по нему. Эндпоинт /calculate-price — только для UI-preview.

→ Это и так логично, но в комментарии в коде написать важно.

5. 📝 ФИНАЛЬНЫЙ ЧЕКЛИСТ ФАЙЛОВ ОТ ТЕБЯ

🔴 Критично перед началом:

src/modules/billing/billing.service.ts — методы calculateGenerationCost, chargeForGeneration, recordRefund
src/modules/generation/generation.service.ts — методы generateImage, generateVideo, generateAudio, refundGeneration, validateBalance
src/modules/generation/generation.controller.ts — текущие эндпоинты
src/modules/generation/dto/ — текущие DTO для image/video/audio (структура папки и содержимое)
🟡 Желательно (для этапов 6+):

src/modules/users/users.service.ts — deductTokens, refundTokens (надо понять интерфейс)
src/modules/chat/chat.service.ts + chat/schemas/message.schema.ts — для чата
src/modules/admin/admin.controller.ts — для админки
.env сервера (только ключи без значений) — подтвердить наличие S3_PUBLIC_URL, всех API ключей
🟢 Не обязательно:

Фронт (api.ts, типы, страницы генерации) — увидим когда дойдём до этапа 8
6. 🚀 ПОРЯДОК ВЫПОЛНЕНИЯ — ТЕКУЩАЯ ИТЕРАЦИЯ


┌─────────────────────────────────────────────────┐
│ [Сейчас] Жду от тебя:                          │
│  - billing.service.ts                           │
│  - generation.service.ts                        │
│  - generation.controller.ts                     │
│  - generation/dto/* (текущие DTO)               │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ Я в одном сообщении выдам:                     │
│  1. Обновлённый model.schema.ts                 │
│  2. PricingService целиком                      │
│  3. Новый generation.dto.ts                     │
│  4. Обновлённый seedDefaultModels (~500 строк)  │
│  5. Дифф для GenerationService (intеграция)     │
│  6. Дифф для GenerationController (новый эндп.)│
│  7. Дифф для billing.module.ts (регистрация)    │
│  8. Инструкции по rollout                       │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ Ты:                                             │
│  1. Накатываешь                                 │
│  2. docker restart api                          │
│  3. Проверяешь логи (новые поля в моделях)      │
│  4. Тестируешь /calculate-price                 │
│  5. Делаешь одну реальную генерацию             │
│  6. Скидываешь результат                        │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ Следующая итерация:                            │
│  - Suno операции (этап 6)                       │
│  - Upload контроллер (этап 8)                   │
│  - Чат мультимодальность (этап 9)               │
└─────────────────────────────────────────────────┘
7. 📊 ФИНАЛЬНАЯ ОЦЕНКА ТРУДОЗАТРАТ — v3.0

Этап	Время	Зависимости	Статус
0. AIModel schema	0.3ч	—	✅ готов написать
1. PricingService	1ч	schema	✅ готов написать
2. Эндпоинт /calculate-price	0.3ч	PricingService	✅ готов написать
3. Унификация DTO	0.5ч	—	✅ готов написать
4. Интеграция в GenerationService	1ч	нужен billing.service.ts + generation.service.ts	⏳ ждём файлы
5. Обновлённый seedDefaultModels	2ч	—	✅ готов написать
6. Suno операции в KIE	1.5ч	доки KIE	⏳ ждём доки
7. Hailuo маппинги	0.1ч	—	✅ в сиде
8. Upload контроллер	0.5ч	—	✅ готов написать
9. Чат мультимодальность	2ч	chat.service.ts	⏳ ждём файлы
10. Админка pricingMatrix	1.5ч	admin.controller.ts	⏳ ждём файлы
Итог: ~11 часов вместо 20.5ч из v2.0 — сократилось благодаря тому что вся параметризация KIE уже работает в коде.

Первая итерация (этапы 0–5, 7): ~5 часов кода + час на проверку = 1 рабочий день.

8. 📌 КЛЮЧЕВЫЕ ВЫВОДЫ v3.0

🎉 Хорошие новости:

Вся параметризация моделей уже работает в kie.provider.ts (KIE_MODEL_PARAMS, VIDEO_MODEL_MAP)
Авто-переключение t2v↔i2v работает для Sora и Hailuo
Storage Timeweb готов — только нужен S3_PUBLIC_URL в env
ElevenLabs уже 6 моделей в БД — упростилось
SubscriptionPlan уже расширен до 5 планов
⚠️ Что нужно решить:

Стратегия сида — вариант А/Б/В (рекомендую А — $setOnInsert)
Kling 3.0 resolution — поддерживает ли KIE? Если нет — flat-цена
Veo 4K — поддерживает ли Evolink? Если нет — flat-цена
Sora stable — что это? Если требование не критично — убрать
Flux маппинг — добавить переключение flex ↔ pro в provider
Suno операции — найти эндпоинты KIE для extend/boost/cover/...
🔧 Что точно делаем:

Обновить схему AIModel (3 новых поля)
Написать PricingService
Эндпоинт /calculate-price
Унифицировать Generation DTO
Переписать seedDefaultModels с 11 матрицами цен
Деактивировать deepseek-v4, elevenlabs-tts
Изменить tokensPerDollar на 30
Обновить includedInPlans на новые планы
❓ Что НЕ ясно но не блокирует:

Конкретные эндпоинты Suno операций (можно сделать после первой итерации)
Поддержка мультимодальности в Evolink Claude (есть в Anthropic API, нужно проверить через Evolink)
Терминология «токены» vs «спички» в UI (косметика, делаем потом)
Конец контекста v3.0.
Следующая версия v4.0 — после получения файлов billing/generation и первого тестового деплоя.


🎯 SPICHKI AI — Контекст рефакторинга (v4.0)

v4.0 (текущая): разобраны billing/generation/dto. Все архитектурные решения приняты. Готов кодить.
v3.0: разобраны провайдеры.
v2.0: данные из БД.
v1.0: концепция.
0. 📊 РАЗОБРАННЫЕ ФАЙЛЫ — КЛЮЧЕВЫЕ ВЫВОДЫ

0.1. billing.service.ts — что есть

Методы которые трогаем / не трогаем:

Метод	Что делает	Действия
calculateGenerationCost(slug, in?, out?)	Цена по fixedCostPerGeneration или costPerMillion*	⚠️ Заменим вызов через PricingService, сам метод оставим для совместимости
chargeForGeneration(userId, slug, type, genId, in?, out?)	Списание + проверка freeAccess + транзакция	✅ Оставляем без изменений
recordRefund(...)	Запись refund-транзакции	✅ Оставляем
checkFreeModelAccess(...)	Проверка лимитов 10/час, 60/сутки	✅ Оставляем
Ключевое открытие — система подписок уже полностью переделана:

В billing.service.ts уже:

✅ 5 планов (BASIC, PLUS, MAX, ULTIMATE + FREE)
✅ deprecated PRO/UNLIMITED через PLAN_MIGRATION
✅ bonusTokens отдельно от tokensPerMonth
✅ freeModels с hourlyLimit/dailyLimit
✅ getTokenPackages() + getSubscriptionPlans() с конвертацией RUB/USD
✅ Курс RUB_TO_USD_RATE = 75 (1 спичка = 3₽ = $0.04)
✅ referralService.markReferralPurchase для кэшбека 10%
✅ 6 платёжных провайдеров (yookassa, cryptomus, stars, freedompay, tochka, heleket)
Это значит: план миграции из v3.0 пункт «обновить includedInPlans на новые планы» — это только в seedDefaultModels, всё остальное (billing) уже сделано.

0.2. generation.service.ts — что есть

Текущий поток (один и тот же для image/video/audio):

Ts

generateImage(userId, dto) {
  const model = await aiProviders.getModelBySlug(dto.modelSlug);
  const { costInTokens } = await billing.calculateGenerationCost(dto.modelSlug);  // ← БЕЗ params!
  await this.validateBalance(userId, costInTokens);
  const generation = new this.generationModel({...});
  await generation.save();
  await users.deductTokens(userId, costInTokens, 'generation_reserve');
  await this.generationQueue.add('process-generation', {...});
  return { generationId, status, tokensCost };
}
Точка инъекции PricingService: одна строка в каждом из 3 методов.

0.3. generation.controller.ts — что есть

3 эндпоинта: POST /image, POST /video, POST /audio + history/favorites/status.

Точка добавления: один новый эндпоинт POST /calculate-price + один новый импорт.

0.4. image-generation.dto.ts — что есть

Все 3 DTO уже в одном файле! Это удобно, не надо делать рефактор именования.

Что уже есть (нужное нам):

✅ aspectRatio, resolution, quality, outputFormat, inputUrls (image)
✅ imageUrl, imageUrls, duration, mode, sound, removeWatermark, promptOptimizer, waterMark (video)
✅ voiceId, language, stability, similarity, speed, loop, promptInfluence, audioUrl, dialogue[] (audio)
Что нужно добавить:

❌ mode в ImageGenerationDto (для midjourney normal/fast/turbo)
❌ version в ImageGenerationDto (для flux normal/pro)
❌ stable в VideoGenerationDto (для sora)
❌ operation в AudioGenerationDto (для suno operations)
❌ title в AudioGenerationDto (для suno)
❌ videoUrls в VideoGenerationDto (для kling motion-control)
→ Минимальный патч ~10 строк, никакого большого рефактора.

0.5. Поток текста (чат) — не трогаем

В чате используется billing.chargeForGeneration(userId, modelSlug, 'text', ...) уже после стрима — это оставляем как есть, PricingService для текста возвращает minTokenCost как preview-значение.

1. 🎯 ФИНАЛЬНЫЕ РЕШЕНИЯ ПО ВСЕМ ОТКРЫТЫМ ВОПРОСАМ

1.1. Стратегия сида: Вариант А ($setOnInsert) ✅

Аргументы:

Админка пока не написана, но как только напишем — админу не придётся каждый раз редактировать seedDefaultModels через git
Существующие пользователи не сломаются — pricingMatrix остаётся при рестарте
При добавлении новой модели через код — она нормально инициализируется
1.2. Sora stable — отказываемся ✅

В KIE нет такого параметра. Из прайса убираем строки «stable+10s=16, stable+15s=18» — оставляем только базовую матрицу:

Ts

pricingMatrix: [
  { conditions: { duration: 10 }, costInTokens: 14, costInDollars: 0.15 },
  { conditions: { duration: 15 }, costInTokens: 16, costInDollars: 0.18 },
]
1.3. Kling 3.0 resolution — проверить позже, пока flat ✅

KIE Kling сейчас принимает mode: std/pro. Это не resolution, но похожая логика (std=720p, pro=1080p по сути).

Решение:

В uiParameters использовать mode (как в провайдере) с label «720p» / «1080p»
В pricingMatrix использовать mode тоже
sound: true/false остаётся
Ts

pricingMatrix: [
  { conditions: { mode: 'std' },                costInTokens: 5, costInDollars: 0.06 },
  { conditions: { mode: 'std',  sound: true },  costInTokens: 6, costInDollars: 0.07 },
  { conditions: { mode: 'pro' },                costInTokens: 6, costInDollars: 0.07 },
  { conditions: { mode: 'pro',  sound: true },  costInTokens: 9, costInDollars: 0.11 },
],
uiParameters: [
  { key: 'mode', label: 'Качество', type: 'select',
    options: [
      { value: 'std', label: '720p (стандарт)' },
      { value: 'pro', label: '1080p (premium)' },
    ],
    default: 'std', affectsPrice: true },
  { key: 'sound', label: 'Со звуком', type: 'toggle', default: false, affectsPrice: true },
]
→ Это решает Проблему 2 из v3.0.

1.4. Veo 4K — временно flat, проверить с Evolink ⏳

Прайс: 720p=15🔥, 4K=46🔥. Пока в Evolink не подтвердили — делаем flat-цену 15🔥 (минимум), а в uiParameters показываем только 720p. После уточнения с Evolink — добавим 4K через админку.

Аналогично Veo Pro: пока flat 75🔥.

1.5. Hailuo 768P/1080P — используем формат KIE ✅

В pricingMatrix.conditions пишем '768P'/'1080P' (заглавная P, как у KIE). Фронт должен прислать тот же формат — это нормально, в uiParameters.options.value тоже будет '768P'.

1.6. Flux переключение — в провайдер ✅

Добавим логику в kie.provider.ts.generateImage:

Ts

const version = (request as any).version || 'pro';  // по умолчанию pro (дешевле)
const hasInputImages = (request as any).inputUrls?.length > 0;

if (modelId === 'flux-2/flex-text-to-image' || modelId === 'flux-2/pro-text-to-image') {
  const variant = version === 'pro' ? 'pro' : 'flex';
  const direction = hasInputImages ? 'image-to-image' : 'text-to-image';
  modelId = `flux-2/${variant}-${direction}`;
}
1.7. Suno операции — выносим в отдельный этап (после первой итерации) ✅

KIE поддерживает только /api/v1/generate пока. Остальные операции (extend, boost, cover...) сейчас не делаем, оставляем в pricingMatrix для будущего, но uiParameters.options ограничиваем одним generate.

→ В первой итерации Suno будет работать как сейчас (flat 4🔥).

1.8. Replicate — оставляем, не используем ✅

Не трогаем — не блокирует.

1.9. S3_PUBLIC_URL — нужно подтверждение

🔴 Вопрос к тебе: подтверди что в .env сервера есть:


S3_PUBLIC_URL=https://s3.timeweb.cloud/15f093e9-3f11-4102-9b84-7e88c06f555d
Если нет — генерации сохраняют битые URL.

1.10. Терминология — в коде tokens, в UI клиента 🔥 ✅

Не трогаем. В UI BillingService.getBalance() возвращает tokenBalance: 100 — фронт сам показывает «100 🔥».

1.11. tokensPerDollar — 30 ✅

Курс: 1🔥 = 3₽, 75₽ = 1(‘RUB 
T
​	
 O 
U
​	
 SD 
R
​	
 ATE=75‘вbilling.service)→1 = 25🔥. С округлением дефолт 30 оставляем — это используется только для fallback fixedCostPerGeneration → tokens, в реальных расчётах работает прямой costInTokens из pricingMatrix.

2. 🛠 ПЛАН ИТЕРАЦИИ 1 — ФИНАЛ

Файлы которые буду менять:

#	Файл	Тип	Размер изменений
1	src/modules/ai-providers/schemas/model.schema.ts	замена	~150 строк
2	src/modules/billing/pricing.service.ts	новый	~120 строк
3	src/modules/billing/billing.module.ts	дифф	+2 строки (регистрация)
4	src/modules/generation/dto/calculate-price.dto.ts	новый	~20 строк
5	src/modules/generation/dto/image-generation.dto.ts	дифф	+30 строк (добавить mode, version, stable, operation, title, videoUrls)
6	src/modules/generation/generation.controller.ts	дифф	+20 строк (calculate-price endpoint)
7	src/modules/generation/generation.service.ts	дифф	~40 строк (intеграция PricingService)
8	src/modules/generation/generation.module.ts	дифф	+2 строки (импорт BillingModule если ещё нет)
9	src/modules/ai-providers/provider-registry.service.ts	большая правка	~700 строк (обновлённый seedDefaultModels)
10	src/modules/ai-providers/providers/kie.provider.ts	дифф	+30 строк (flux switch + suno operation prep)
Итого: ~1100 строк кода в одной итерации.

Что НЕ делаем в этой итерации:

❌ Контроллер /upload (этап 8)
❌ Чат мультимодальность (этап 9)
❌ Админка pricingMatrix (этап 10)
❌ Suno операции (этап 6)
❌ Удаление Replicate
3. 📐 МАППИНГ DTO → params для PricingService

Сейчас параметры в DTO раскиданы — нужна функция-извлекатель в generation.service.ts:

Ts

/**
 * Извлекает из DTO только те параметры, которые влияют на цену.
 * Используется как ключ для поиска в pricingMatrix.
 */
private extractPricingParams(dto: any): Record<string, any> {
  const hasInputImage = !!(
    dto.imageUrl ||
    dto.inputUrls?.length ||
    dto.imageUrls?.length
  );

  return {
    // Image params
    mode: dto.mode,           // midjourney, kling
    version: dto.version,     // flux
    resolution: dto.resolution,
    quality: dto.quality,

    // Video params
    duration: dto.duration,
    sound: dto.sound,
    stable: dto.stable,

    // Audio params
    operation: dto.operation,

    // Авто-определение i2i / i2v
    hasInputImage,

    // Кол-во изображений (для image generation с numImages > 1)
    numImages: dto.numImages || 1,
  };
}
И вставка в каждый generate* метод:

Ts

async generateImage(userId: string, dto: ImageGenerationDto) {
  const model = await this.aiProvidersService.getModelBySlug(dto.modelSlug);

  // 🆕 Новый расчёт с учётом параметров
  const priceCalc = await this.pricingService.calculatePrice(
    dto.modelSlug,
    this.extractPricingParams(dto),
  );
  const costInTokens = priceCalc.costInTokens;

  await this.validateBalance(userId, costInTokens);
  // ... остальной код без изменений
}
4. 🚦 ROLLOUT PLAN


┌─ ШАГ 1: Бэкап БД ─────────────────────────────────┐
│ mongodump --uri="mongodb://localhost/spichki" ... │
└────────────────────────────────────────────────────┘
                    ↓
┌─ ШАГ 2: Накатить код ─────────────────────────────┐
│ git pull / scp файлов                              │
│ docker-compose build api                           │
│ docker-compose up -d api                           │
└────────────────────────────────────────────────────┘
                    ↓
┌─ ШАГ 3: Проверить логи ───────────────────────────┐
│ docker logs spichki-api -f                         │
│ Ожидаем:                                           │
│   ✅ "🌱 Syncing existing AI models..."            │
│   ✅ "Synced 35 AI models"                         │
│   ✅ NO ERRORS                                     │
└────────────────────────────────────────────────────┘
                    ↓
┌─ ШАГ 4: Проверить БД ─────────────────────────────┐
│ docker exec mongodb mongosh                        │
│ db.aimodels.findOne({slug: 'midjourney'}, {       │
│   pricingMatrix: 1, uiParameters: 1               │
│ })                                                 │
│ → должны быть заполнены                            │
└────────────────────────────────────────────────────┘
                    ↓
┌─ ШАГ 5: Тест эндпоинта ───────────────────────────┐
│ curl -X POST .../generation/calculate-price \      │
│   -H "Authorization: Bearer ..."                   │
│   -d '{"modelSlug":"midjourney","params":         │
│        {"mode":"turbo"}}'                          │
│ → должно вернуть {"costInTokens":6, ...}          │
└────────────────────────────────────────────────────┘
                    ↓
┌─ ШАГ 6: Реальная генерация ───────────────────────┐
│ Через фронт или curl сгенерируй один image        │
│ Проверь:                                           │
│   - списано правильно тикенов                      │
│   - сохранилось в S3                               │
│   - resultUrls есть в БД                           │
└────────────────────────────────────────────────────┘
                    ↓
┌─ ROLLBACK PLAN (если что-то сломалось) ───────────┐
│ git revert                                         │
│ docker-compose restart api                         │
│ Новые поля в БД (pricingMatrix/uiParameters)      │
│ остаются — не мешают старому коду                  │
└────────────────────────────────────────────────────┘
5. 🚨 РИСКИ И МИТИГАЦИЯ

Риск	Вероятность	Митигация
seedDefaultModels затрёт pricingMatrix существующих 44 моделей	Низкая (используем $setOnInsert)	Если что — перенакатить сид-скрипт
Старый фронт пришлёт без новых params → pricingMatrix не сматчится → fallback к fixedCostPerGeneration	Высокая	✅ Это и есть правильное поведение — fallback работает
pricingService бросит exception если модель неактивна	Средняя	Уже обработано через NotFoundException
BillingService.chargeForGeneration всё ещё считает по calculateGenerationCost (без params)	Средняя	✅ Это нормально — он используется после генерации, когда мы уже знаем costInTokens из generation.tokensCost. Уточнение нужно: перепроверить что chargeForGeneration не пересчитывает заново. Если пересчитывает — нужно передавать сохранённый costInTokens.
Suno генерация — нет operation в params → fallback к generate (4🔥)	Низкая	✅ Работает как сейчас
⚠️ Уточнение по BillingService.chargeForGeneration

Перечитал код — в нём:

Ts

const { costInDollars, costInTokens } = await this.calculateGenerationCost(modelSlug, inputTokens, outputTokens);
await this.usersService.deductTokens(userId, costInTokens, 'generation');
То есть списывает по calculateGenerationCost, не по сохранённому в Generation.tokensCost!

Это работает корректно ТОЛЬКО для текста (inputTokens/outputTokens передаются после стрима).

Для image/video/audio в текущем generation.service.ts:

calculateGenerationCost(slug) → 4🔥 (без params)
validateBalance + deductTokens(4) — резерв
Generation.tokensCost = 4
После завершения генерации — chargeForGeneration НЕ ВЫЗЫВАЕТСЯ для image/video/audio (только для текста в чате)
→ Значит, image/video/audio списывается через users.deductTokens(generation_reserve) напрямую, а транзакция создаётся... где-то ещё? Возможно в generation.consumer.ts после успешной генерации.

🔴 Нужен файл: src/modules/generation/generation.consumer.ts — чтобы понять как закрывается транзакция для media.

Без него есть риск что после моей правки image/video/audio начнёт списываться правильно (через PricingService), но транзакция в БД не запишется. Это критично для:

истории платежей пользователя
статистики (getRevenueStats)
лимитов freeAccess
6. 📝 ЧЕКЛИСТ ФАЙЛОВ ОТ ТЕБЯ — ИТОГ

🔴 Критично перед стартом кода:

src/modules/generation/generation.consumer.ts — самый важный, чтобы понять как закрывается транзакция media-генерации
src/modules/generation/generation.module.ts — чтобы понять текущие импорты и не сломать DI
src/modules/billing/billing.module.ts — чтобы зарегистрировать PricingService
🟡 Желательно:

src/modules/users/users.service.ts — методы deductTokens, addTokens, addBonusTokens, addCashback, refundTokens — для понимания интерфейса
Подтверждение .env: S3_PUBLIC_URL=https://s3.timeweb.cloud/15f093e9-3f11-4102-9b84-7e88c06f555d
🟢 Не обязательно (для следующих итераций):

src/modules/chat/chat.service.ts — для чата мультимодальности
src/modules/chat/schemas/message.schema.ts
src/modules/admin/admin.controller.ts
src/modules/storage/storage.module.ts (или где регистрируется StorageService) — для upload контроллера
7. 📊 ОЦЕНКА — v4.0

Этап	Время	Зависимости	Статус
0. AIModel schema	0.3ч	—	✅ готов
1. PricingService	0.5ч	schema	✅ готов
2. Эндпоинт calculate-price	0.3ч	PricingService	✅ готов
3. Расширение DTO	0.3ч	—	✅ готов
4. Интеграция в GenerationService	1ч	нужен generation.consumer.ts	⏳ ждём файл
5. seedDefaultModels (~700 строк)	2ч	—	✅ готов
6. Flux switch в KIE provider	0.3ч	—	✅ готов
Первая итерация: ~5 часов чистого кодинга + 1 час на проверки = 6 часов = 1 рабочий день.

После получения 3 критичных файлов — готов выдать всё единым сообщением (~1100 строк готового кода + инструкции по rollout).

8. 📌 КЛЮЧЕВЫЕ РЕШЕНИЯ v4.0 (одним абзацем)

Сид: вариант А ($setOnInsert) — admin сможет править через UI без перезаписи при рестарте.
Sora stable — отказываемся, KIE не поддерживает. Только duration: 10/15.
Kling resolution — используем mode: std/pro (как в KIE), показываем юзеру как «720p/1080p».
Veo 4K — временно flat 15🔥 / 75🔥, потом уточним с Evolink → добавим через админку.
Hailuo — формат '768P'/'1080P' (заглавная P, как у KIE) в pricingMatrix и uiParameters.
Flux переключение — добавим автоматику в kie.provider.ts (один маппинг в БД → переключение flex/pro × t2i/i2i внутри провайдера).
Suno операции — пока только generate (как сейчас), pricingMatrix готовим на будущее, в uiParameters показываем только одну опцию.
Hailuo Pro t2v — в providerMappings ставим hailuo/02-text-to-video-pro priority 1, авто-переключение в KIE сам сработает.
Replicate — не трогаем, оставляем как заглушку.
S3 URL — нужно подтверждение S3_PUBLIC_URL в .env сервера.
tokensPerDollar: 30 — дефолт для fallback. В pricingMatrix цена в спичках задаётся напрямую (без пересчёта через курс).
Терминология — tokens в коде, 🔥 в UI клиента. Не трогаем.
PricingService для text — возвращает minTokenCost как preview. Реальное списание — через BillingService.chargeForGeneration(usage) после стрима (как сейчас).
DTO — расширяем существующий image-generation.dto.ts (не создаём новый файл generation.dto.ts).
Transaction для media — нужно посмотреть generation.consumer.ts, чтобы понять где закрывается транзакция (либо chargeForGeneration, либо отдельная запись).
🚦 ЧТО НУЖНО ЧТОБЫ НАЧАТЬ

🔴 КРИТИЧНО — 3 файла + 1 подтверждение:

1. src/modules/generation/generation.consumer.ts

Зачем: понять как сейчас закрывается финальная транзакция для image/video/audio после успешной генерации. Без этого есть риск что:

Списание generation_reserve останется висеть (без transaction.completed)
freeModelAccess лимиты сломаются (счётчик не инкрементится)
getRevenueStats потеряет данные о генерациях
2. src/modules/generation/generation.module.ts

Зачем: проверить:

Импортирует ли он BillingModule (нужно для PricingService)
Какие провайдеры зарегистрированы
Нет ли циклической зависимости (часто forwardRef нужен)
3. src/modules/billing/billing.module.ts

Зачем: зарегистрировать новый PricingService в providers и добавить в exports, чтобы GenerationModule мог его использовать.

4. Подтверждение .env (просто да/нет):


S3_PUBLIC_URL=https://s3.timeweb.cloud/<bucket-id>
Есть в .env? Какое значение? (можно без bucket-id, просто скажи «да, прописан» или «нет, надо добавить»).

🟡 ЖЕЛАТЕЛЬНО — для полной картины (не блокирует):

5. src/modules/users/users.service.ts

Зачем: убедиться что deductTokens(userId, amount, reason) — это правильная сигнатура (видел в коде вызовы с 'generation_reserve' и 'generation').

🟢 ПОТОМ — для следующих итераций (не сейчас):

chat.service.ts + message.schema.ts — для мультимодальности
admin.controller.ts — для админки pricingMatrix
storage.module.ts — для upload контроллера
📦 ЧТО Я ВЫДАМ В СЛЕДУЮЩЕМ СООБЩЕНИИ

После получения этих 3 файлов + подтверждения .env, в одном сообщении выкачу:


─── ФАЙЛЫ (10 артефактов) ─────────────────────────
1. src/modules/ai-providers/schemas/model.schema.ts          [полная замена]
2. src/modules/billing/pricing.service.ts                    [новый]
3. src/modules/billing/billing.module.ts                     [дифф]
4. src/modules/generation/dto/calculate-price.dto.ts         [новый]
5. src/modules/generation/dto/image-generation.dto.ts        [дифф]
6. src/modules/generation/generation.controller.ts           [дифф]
7. src/modules/generation/generation.service.ts              [дифф]
8. src/modules/generation/generation.module.ts               [дифф если нужно]
9. src/modules/ai-providers/provider-registry.service.ts     [полная замена ~700 строк]
10. src/modules/ai-providers/providers/kie.provider.ts       [дифф для flux switch]

─── ИНСТРУКЦИИ ────────────────────────────────────
- Команды для накатки
- Команды для проверки в mongosh
- curl-команды для теста /calculate-price
- Чеклист «что должно работать после деплоя»
- Rollback инструкции если что-то сломалось
🎬 ИТОГ

Готовность к старту: 95%.

Жду от тебя 3 файла + 1 ответ про .env → выдаю всю первую итерацию за один заход.

После твоего деплоя и проверки → итерация 2 (Suno операции + upload контроллер + чат мультимодальность).

📌 Если что-то из «желательно» можешь скинуть сразу — лучше, но не блокирует.

🎯 SPICHKI AI — Контекст рефакторинга (v5.0 FINAL)

v5.0 (текущая): Все файлы разобраны. Архитектура понята на 100%. Старт кодинга.
0. 🔍 НОВЫЕ ВЫВОДЫ ПОСЛЕ РАЗБОРА 3 ФАЙЛОВ

0.1. generation.consumer.ts — критичные открытия

✅ Как сейчас работает поток media-генерации:


1. GenerationService.generateImage()
   ├─ calculateGenerationCost(slug) → costInTokens (БЕЗ params!)
   ├─ validateBalance
   ├─ Generation.create() → status: PENDING, tokensCost: X
   ├─ users.deductTokens(X, 'generation_reserve')  ← СПИСАНИЕ СРАЗУ
   └─ queue.add('process-generation')

2. GenerationConsumer.handleGeneration()
   ├─ updateGeneration(status: PROCESSING)
   ├─ aiProviders.generateImage() / Video / Audio
   ├─ Если taskId → pollTaskUntilComplete() (Long polling)
   ├─ saveToStorage() (S3)
   └─ updateGeneration(status: COMPLETED, resultUrls)

3. При ошибке:
   ├─ updateGeneration(status: FAILED)
   └─ refundGeneration() → users.refundTokens + billing.recordRefund
🚨 КРИТИЧНОЕ НАБЛЮДЕНИЕ:

Для media-генераций транзакция TransactionType.GENERATION НЕ создаётся вообще!

Сравни:

Текст (чат): billing.chargeForGeneration() → создаёт Transaction{type:GENERATION, amount:-N} в БД
Media: users.deductTokens(X, 'generation_reserve') → списывает с баланса, но транзакцию не пишет
Последствия:

❌ getTransactionHistory() для media-генераций возвращает пусто
❌ getRevenueStats() агрегирует только текстовые генерации
❌ checkFreeModelAccess() для image/video считает транзакции с type:GENERATION — их нет, поэтому лимит «10/час» не работает для image-моделей! Только для текстовых.
Решение в нашей итерации:

Вариант 1 (минимальный): Оставляем как есть, не трогаем consumer. Просто внедряем PricingService в GenerationService для расчёта costInTokens. Это БЕЗОПАСНО и не ломает существующий поток.

Вариант 2 (правильный): Добавляем вызов billingService.chargeForGeneration() в consumer после успешной генерации (или в GenerationService сразу после queue.add). Это исправит баг с пропавшими транзакциями и freeModelAccess.

Моя рекомендация: Вариант 2, но с осторожностью:

Ts

// В generation.service.ts — после deductTokens:
await this.usersService.deductTokens(userId, costInTokens, 'generation_reserve');

// 🆕 Создаём транзакцию сразу (для истории, статистики, freeAccess)
await this.billingService.recordGeneration({
  userId,
  modelSlug: dto.modelSlug,
  generationId: generation._id.toString(),
  generationType: type,
  costInTokens,
  costInDollars: priceCalc.costInDollars,
  freeAccess: false,  // freeAccess проверим отдельно
  metadata: priceCalc.breakdown,
});
Но! В BillingService сейчас нет метода recordGeneration — есть chargeForGeneration (с дополнительной проверкой freeAccess и deductTokens).

Финальное решение:

В рамках первой итерации делаем Вариант 1 (минимальный риск):

✅ Расчёт costInTokens через PricingService
✅ Эндпоинт /calculate-price для UI preview
✅ Сохранение pricingBreakdown в Generation для аудита
❌ НЕ трогаем consumer — он работает
В итерации 2 — отдельной задачей добавим запись транзакций для media (это уже багфикс, не часть рефакторинга).

0.2. generation.module.ts — оценка

✅ Что хорошо:

BillingModule уже импортируется через forwardRef
StorageModule импортирован
Bull queue настроен правильно
⚠️ Что заметил:

GenerationGateway есть → WS-уведомления работают
В providers нет PricingService — он будет инжектиться из BillingModule
Циклическая зависимость уже решена через forwardRef(() => BillingModule)
Изменения в generation.module.ts: НИКАКИХ. PricingService будет экспортироваться из BillingModule.

0.3. billing.module.ts — что менять

Нужно:

Добавить PricingService в providers
Добавить PricingService в exports (чтобы GenerationModule мог использовать)
Других правок нет. AIModel schema уже подключена через MongooseModule.forFeature.

0.4. .env — точно проверь!

В твоём .env:

Env

S3_BUCKET=your-bucket-name           # ⚠️ ШАБЛОН — нужно поменять
S3_PUBLIC_URL=https://s3.timeweb.cloud/your-bucket-name  # ⚠️ ШАБЛОН!
🔴 Это значения-заглушки! Реальный URL из логов:


https://s3.timeweb.cloud/15f093e9-3f11-4102-9b84-7e88c06f555d/audios/...
Вопрос к тебе:

В продакшен .env уже подставлены реальные значения?

Если нет → перед накаткой моего кода обязательно замени в .env:

Env

S3_BUCKET=15f093e9-3f11-4102-9b84-7e88c06f555d
S3_PUBLIC_URL=https://s3.timeweb.cloud/15f093e9-3f11-4102-9b84-7e88c06f555d
S3_ACCESS_KEY=<реальный>
S3_SECRET_KEY=<реальный>
Без этого новые генерации будут сохраняться в /your-bucket-name/... (битый URL).

Если в продакшен уже правильные значения, и ты скинул мне .env.example — всё ОК.

1. 🎯 ФИНАЛЬНОЕ РЕШЕНИЕ ПО ТРАНЗАКЦИЯМ

Итерация 1 (сейчас):

✅ Внедряем PricingService в расчёт цены
✅ Эндпоинт /calculate-price
✅ Сохраняем pricingBreakdown в Generation для аудита
❌ НЕ трогаем consumer — работает как сейчас
Итерация 2 (потом): Багфикс — добавим запись транзакций для media-генераций (отдельная задача, отдельное тестирование).

2. 📋 ФИНАЛЬНЫЙ ПЛАН — что выкачу СЕЙЧАС

Файлы (10 артефактов):

#	Файл	Тип	Действие
1	model.schema.ts	замена	+ pricingMatrix, uiParameters, inputCapabilities, metadata в providerMappings
2	pricing.service.ts	новый	Класс с calculatePrice()
3	billing.module.ts	дифф	+PricingService в providers/exports
4	calculate-price.dto.ts	новый	DTO для эндпоинта
5	image-generation.dto.ts	дифф	+ mode, version, stable, operation, title, videoUrls
6	generation.controller.ts	дифф	+ POST /calculate-price
7	generation.service.ts	дифф	+ extractPricingParams(), замена calculateGenerationCost на pricingService.calculatePrice
8	generation.schema.ts	дифф	+ поле pricingBreakdown (опциональное, для аудита)
9	provider-registry.service.ts	большая правка	Обновлённый seedDefaultModels() с матрицами цен
10	kie.provider.ts	дифф	+ Flux switch (flex/pro × t2i/i2i)
Файлы которые НЕ трогаем:

❌ generation.consumer.ts — работает, не ломаем
❌ generation.module.ts — уже правильно настроен
❌ billing.service.ts — все методы оставляем
3. 🚦 ROLLOUT PLAN — финал


Шаг 0: ОБЯЗАТЕЛЬНО проверить .env на продакшене
   └─ S3_BUCKET и S3_PUBLIC_URL должны быть РЕАЛЬНЫМИ

Шаг 1: Бэкап БД
   mongodump --uri="mongodb://..." --out=./backup-$(date +%Y%m%d)

Шаг 2: Накатка
   git pull
   docker-compose build api
   docker-compose up -d api

Шаг 3: Проверка логов
   docker logs spichki-api -f --tail=100
   ✅ "🌱 Syncing existing AI models..."
   ✅ "Synced 35 AI models"
   ✅ NO ERRORS

Шаг 4: Проверка БД
   docker exec -it spichki-mongodb mongosh
   use spichki
   db.aimodels.findOne({slug: 'midjourney'}, {pricingMatrix:1, uiParameters:1})
   → должны быть заполнены

Шаг 5: Тест /calculate-price
   curl -X POST http://localhost:3000/api/v1/generation/calculate-price \
     -H "Authorization: Bearer <JWT>" \
     -H "Content-Type: application/json" \
     -d '{"modelSlug":"midjourney","params":{"mode":"turbo"}}'
   → {"costInTokens":6, "costInDollars":0.06, ...}

Шаг 6: Реальная генерация
   Через фронт сгенерируй image с разными mode
   Проверь:
   - Списано правильно (mode:turbo = 6🔥, mode:normal = 2🔥)
   - Сохранилось в S3
   - Generation.pricingBreakdown заполнен

Шаг 7: Rollback (если что)
   git revert HEAD
   docker-compose restart api
   (новые поля в БД остаются, не мешают)
4. ⚠️ ЕЩЁ ОДИН РИСК — НАШЁЛ В consumer.ts

В pollTaskUntilComplete после taskResult.status === 'completed' обновляется Generation, но не передаются resultContent, responseTimeMs, metadata. Это бывшая проблема, но в нашем рефакторинге не трогаем — это отдельная задача.

5. 🎬 ИТОГ — СТАРТУЕМ

Готовность: 100%.

Что я сделаю прямо сейчас (в следующем сообщении):

✅ Выдам 10 файлов одним сообщением (~1100 строк)
✅ С детальными инструкциями по rollout
✅ С curl-командами для теста

Что ты сделаешь:

⚠️ СНАЧАЛА проверь .env на продакшене — реальные значения S3, не шаблон
Бэкап БД
Накатка кода
docker-compose restart api
Тест эндпоинта /calculate-price
Скинешь результат и логи
После твоего «деплой ОК» → итерация 2:

Запись транзакций для media (багфикс)
Suno операции
Upload контроллер
Чат мультимодальность
Админка
