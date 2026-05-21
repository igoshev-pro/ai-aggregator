import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, SchemaTypes, Types } from 'mongoose';
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
    | 'boolean'
    | 'number'
    | 'text'
    | 'image-upload'
    | 'audio-upload'
    | 'video-upload';
  options?: UIParameterOption[];
  defaultValue?: any;                // 👈 переименовано из `default` (избегаем конфликта с Mongoose)
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
  acceptsVideos?: boolean;           // 👈 алиас, используется в сидере (kling-motion)
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


  // 🆕 Поддерживает ли модель vision (картинки на вход для чата)
  @Prop({ default: false })
  supportsVision: boolean;


  @Prop({ default: 0 })
  sortOrder: number;


  // Стоимость за миллион токенов
  @Prop({ default: 0 })
  costPerMillionInputTokens: number; // в долларах


  @Prop({ default: 0 })
  costPerMillionOutputTokens: number; // в долларах


  // Фиксированная стоимость за генерацию (для изображений/видео/аудио)
  @Prop({ default: 0 })
  fixedCostPerGeneration: number; // в долларах


  // Курс конвертации долларов в наши внутренние токены
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
      providerId: { type: SchemaTypes.ObjectId, ref: 'Provider' },
      providerSlug: { type: String },
      modelId: { type: String },
      priority: { type: Number },
      isActive: { type: Boolean },
      metadata: { type: SchemaTypes.Mixed },
      _id: false,
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


  @Prop({ type: SchemaTypes.Mixed, default: {} })
  defaultParams: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    width?: number;
    height?: number;
    steps?: number;
    duration?: number;
    fps?: number;
    aspectRatio?: string;
  };


  @Prop({ type: SchemaTypes.Mixed, default: {} })
  limits: {
    maxInputTokens?: number;
    maxOutputTokens?: number;
    maxImagesPerRequest?: number;
    maxResolution?: string;
    maxDuration?: number;
    cooldownSeconds?: number;
    includedInPlans?: string[];
    freeLimitPerHour?: number;
    freeLimitPerDay?: number;
  };


  @Prop({ type: [String], default: [] })
  capabilities: string[];


  // 🆕 МАТРИЦА ЦЕН — основа динамического ценообразования
  // ⚠️ ВАЖНО: каждое поле обёрнуто в { type: ... } чтобы Mongoose не путал
  // ключ `type` со спецификатором типа схемы
  @Prop({
    type: [{
      conditions: { type: SchemaTypes.Mixed },
      costInTokens: { type: Number },
      costInDollars: { type: Number },
      label: { type: String },
      _id: false,
    }],
    default: [],
  })
  pricingMatrix: PricingRule[];


  // 🆕 ПАРАМЕТРЫ ДЛЯ UI — описывают как фронт должен рисовать форму генерации
  // ⚠️ ВАЖНО: каждое поле обёрнуто в { type: ... } — особенно поле `type`,
  // иначе Mongoose интерпретирует его как тип всего объекта (CastError!)
  @Prop({
    type: [{
      key: { type: String },
      label: { type: String },
      type: { type: String },                                  // 👈 поле "type", а не указание типа
      options: {
        type: [{
          value: { type: SchemaTypes.Mixed },
          label: { type: String },
          _id: false,
        }],
        default: [],
      },
      defaultValue: { type: SchemaTypes.Mixed },               // 👈 переименовано из `default`
      affectsPrice: { type: Boolean },
      visibleWhen: { type: SchemaTypes.Mixed },
      min: { type: Number },
      max: { type: Number },
      step: { type: Number },
      placeholder: { type: String },
      _id: false,
    }],
    default: [],
  })
  uiParameters: UIParameter[];


  // 🆕 КАКОЙ КОНТЕНТ ПРИНИМАЕТ МОДЕЛЬ (для чата с мультимодальностью)
  @Prop({ type: SchemaTypes.Mixed, default: {} })
  inputCapabilities: InputCapabilities;


  @Prop({ type: SchemaTypes.Mixed, default: {} })
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