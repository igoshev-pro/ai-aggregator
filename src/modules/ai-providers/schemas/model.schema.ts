import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { GenerationType } from '@/common/interfaces';

export type ModelDocument = AIModel & Document;

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
  @Prop({ default: 100 })
  tokensPerDollar: number; // 1$ = 100 токенов по умолчанию

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
    }],
    default: [],
  })
  providerMappings: {
    providerId: Types.ObjectId;
    providerSlug: string;
    modelId: string;
    priority: number;
    isActive: boolean;
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
    includedInPlans?: string[]; // ['pro', 'unlimited'] - в каких подписках доступна
  };

  @Prop({ type: [String], default: [] })
  capabilities: string[];

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