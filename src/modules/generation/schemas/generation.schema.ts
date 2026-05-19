// src/modules/generation/schemas/generation.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { GenerationType, GenerationStatus } from '@/common/interfaces';

export type GenerationDocument = Generation & Document;

@Schema({ timestamps: true })
export class Generation {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: GenerationType })
  type: GenerationType;

  @Prop({ required: true })
  modelSlug: string;

  @Prop({ required: true, enum: GenerationStatus, default: GenerationStatus.PENDING })
  status: GenerationStatus;

  @Prop({ required: true })
  prompt: string;

  @Prop()
  negativePrompt: string;

  @Prop({ type: Object, default: {} })
  params: {
    // ─── IMAGE ────────────────────────────
    width?: number;
    height?: number;
    aspectRatio?: string;
    resolution?: string;       // '1K' | '2K' | '4K' | '720p' | '1080p' | '768P'
    quality?: string;          // 'basic' | 'high' (seedream)
    outputFormat?: string;     // 'png' | 'jpg'
    steps?: number;
    seed?: number;
    numImages?: number;
    style?: string;
    inputUrls?: string[];      // img2img
    mode?: string;             // 🆕 midjourney: normal/fast/turbo; kling: std/pro
    version?: string;          // 🆕 flux: normal/pro

    // ─── VIDEO ────────────────────────────
    imageUrl?: string;         // i2v (single image)
    imageUrls?: string[];      // 🆕 i2v (multiple, kling)
    videoUrls?: string[];      // 🆕 kling motion-control
    duration?: number;
    sound?: boolean;           // 🆕 kling sound
    stable?: boolean;          // 🆕 sora stable (зарезервировано на будущее)
    removeWatermark?: boolean; // 🆕 sora
    promptOptimizer?: boolean; // 🆕 hailuo

    // ─── AUDIO (Suno) ─────────────────────
    operation?: string;        // 🆕 generate/extend/boost/cover/...
    title?: string;            // 🆕 suno track title
    instrumental?: boolean;
    customMode?: boolean;      // 🆕 suno
    audioUrl?: string;         // 🆕 для extend/cover

    // ─── AUDIO (ElevenLabs) ───────────────
    voiceId?: string;
    language?: string;
    stability?: number;        // 🆕
    similarity?: number;       // 🆕
    speed?: number;            // 🆕
    loop?: boolean;            // 🆕 SFX
    promptInfluence?: number;  // 🆕 SFX
    dialogue?: Array<{ text: string; voice: string }>; // 🆕

    // ─── EXTRA ────────────────────────────
    [key: string]: any;        // на случай произвольных параметров
  };

  @Prop({ type: [String], default: [] })
  resultUrls: string[];

  @Prop({ type: [String], default: [] })
  storageUrls: string[]; // постоянные URL в S3

  @Prop({ type: [String], default: [] })
  storageKeys: string[]; // ключи для удаления из S3

  @Prop({ default: false })
  savedToStorage: boolean; // флаг что сохранено в S3

  @Prop()
  resultContent: string;

  @Prop()
  taskId: string;

  @Prop()
  providerSlug: string;

  @Prop({ default: 0 })
  progress: number;

  @Prop()
  eta: number;

  // НОВЫЕ ПОЛЯ для точного учёта токенов
  @Prop({ default: 0 })
  inputTokens: number; // реальные токены от провайдера

  @Prop({ default: 0 })
  outputTokens: number; // реальные токены от провайдера

  @Prop({ default: 0 })
  totalProviderTokens: number; // inputTokens + outputTokens

  @Prop({ default: 0 })
  costInDollars: number; // стоимость в долларах

  @Prop({ default: 0 })
  tokensCost: number; // стоимость в наших внутренних токенах

  // 🆕 Аудит расчёта цены — какое правило сработало в pricingMatrix
  @Prop({ type: Object, default: null })
  pricingBreakdown: {
    modelSlug: string;
    modelName: string;
    type: string;
    rule?: string;
    params: Record<string, any>;
    costInTokens: number;
    costInDollars: number;
    fallback: boolean;
  } | null;

  @Prop({ default: false })
  isRefunded: boolean;

  @Prop()
  startedAt: Date;

  @Prop()
  completedAt: Date;

  @Prop()
  responseTimeMs: number;

  @Prop()
  errorMessage: string;

  @Prop({ default: 0 })
  retryCount: number;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;

  @Prop({ default: false })
  isFavorite: boolean;
}

export const GenerationSchema = SchemaFactory.createForClass(Generation);

GenerationSchema.index({ userId: 1, createdAt: -1 });
GenerationSchema.index({ userId: 1, type: 1, createdAt: -1 });
GenerationSchema.index({ status: 1, taskId: 1 });
GenerationSchema.index({ userId: 1, isFavorite: 1, createdAt: -1 });