import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { GenerationType } from '@/common/interfaces';

export type ModelDocument = AIModel & Document;

// ─── ИНТЕРФЕЙСЫ ─────────────────────────────────────────

export interface PricingRule {
  conditions: Record<string, any>;   // { mode: 'turbo', resolution: '2K' }
  costInTokens: number;
  costInDollars: number;
  label?: string;                    // для админки
}

export interface UIParameterOption {
  value: string | number | boolean;
  label: string;
}

export interface UIParameter {
  key: string;                       // 'mode', 'resolution', 'duration'
  label: string;                     // 'Режим', 'Разрешение'
  type:
    | 'select'
    | 'toggle'
    | 'number'
    | 'text'
    | 'image-upload'
    | 'audio-upload'
    | 'video-upload';
  options?: UIParameterOption[];
  default?: any;
  affectsPrice?: boolean;
  visibleWhen?: Record<string, any>; // { mode: ['fast', 'turbo'] }
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}

export interface InputCapabilities {
  acceptsImages?: boolean;
  acceptsFiles?: boolean;
  acceptsAudio?: boolean;
  acceptsVideo?: boolean;
  maxInputImages?: number;
  maxFileSize?: number;              // в MB
  acceptedMimeTypes?: string[];
}

// ─── СХЕМА ──────────────────────────────────────────────

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

  // НОВЫЕ ПОЛЯ - стоимость за миллион токенов
  @Prop({ default: 0 })
  costPerMillionInputTokens: number; // в долларах

  @Prop({ default: 0 })
  costPerMillionOutputTokens: number; // в долларах

  // Фиксированная стоимость за генерацию (для изображений/видео/аудио)
  @Prop({ default: 0 })
  fixedCostPerGeneration: number; // в долларах

  // Курс конвертации долларов в наши внутренние токены
  // ⚠️ ИЗМЕНЕНО: было 100, теперь 30 (1$ ≈ 30 спичек по нашему курсу RUB=75/USD, 1🔥=3₽)
  @Prop({ default: 30 })
  tokensPerDollar: number;

  // Минимальная стоимость генерации в токенах
  @Prop({ default: 1 })
  minTokenCost: number;

  // DEPRECATED - оставляем для обратной совместимости
  @Prop({ required: false })
  tokenCost: number;

  @Prop({
    type: [{
      providerId: { type: Types.ObjectId, ref: 'Provider' },
      providerSlug: String,
      modelId: String,
      priority: Number,
      isActive: Boolean,
      metadata: Object, // 🆕 для доп. параметров маппинга (например, { version: 'pro' })
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
    includedInPlans?: string[]; // ['plus', 'max', 'ultimate'] - в каких подписках доступна
    freeLimitPerHour?: number;  // 🆕 для бесплатных моделей в подписках
    freeLimitPerDay?: number;   // 🆕
  };

  @Prop({ type: [String], default: [] })
  capabilities: string[];

  // 🆕 МАТРИЦА ЦЕН — основа динамического ценообразования
  // Каждое правило: conditions (что должно совпасть в params) → цена в спичках/долларах
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

  // 🆕 ПАРАМЕТРЫ ДЛЯ UI — описывают как фронт должен рисовать форму генерации
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

  // 🆕 КАКОЙ КОНТЕНТ ПРИНИМАЕТ МОДЕЛЬ (для чата с мультимодальностью)
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

// Составной индекс для поиска
AIModelSchema.index({ type: 1, isActive: 1, sortOrder: 1 });
// Удалён дублирующийся индекс для slug, так как он уже unique