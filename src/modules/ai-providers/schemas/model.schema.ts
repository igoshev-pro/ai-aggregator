import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { GenerationType } from '@/common/interfaces';

export type ModelDocument = AIModel & Document;

@Schema({ timestamps: true })
export class AIModel {
  @Prop({ required: true, unique: true })
  slug: string; // 'gpt-4o', 'claude-3.5-sonnet', 'midjourney', etc.

  @Prop({ required: true })
  name: string; // Display name

  @Prop({ required: true })
  displayName: string;

  @Prop()
  description: string;

  @Prop()
  icon: string; // URL к иконке

  @Prop({ required: true, enum: GenerationType })
  type: GenerationType;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  isPremium: boolean; // Доступен только premium пользователям

  @Prop({ default: 0 })
  sortOrder: number;

  // Стоимость в токенах
  @Prop({ required: true })
  tokenCost: number;

  // Маппинг на провайдеров (fallback chain)
  @Prop({
    type: [{
      providerId: { type: Types.ObjectId, ref: 'Provider' },
      providerSlug: String,
      modelId: String, // ID модели у провайдера
      priority: Number,
      isActive: Boolean,
    }],
    default: [],
  })
  providerMappings: {
    providerId: Types.ObjectId;
    providerSlug: string;
    modelId: string; // e.g., 'openai/gpt-4o' for openrouter
    priority: number;
    isActive: boolean;
  }[];

  // Настройки модели
  @Prop({ type: Object, default: {} })
  defaultParams: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    // Image params
    width?: number;
    height?: number;
    steps?: number;
    // Video params
    duration?: number;
    fps?: number;
  };

  // Лимиты
  @Prop({ type: Object, default: {} })
  limits: {
    maxInputTokens?: number;
    maxOutputTokens?: number;
    maxImagesPerRequest?: number;
    maxResolution?: string;
    maxDuration?: number; // seconds for video
    cooldownSeconds?: number; // Between requests
  };

  // Поддерживаемые возможности
  @Prop({ type: [String], default: [] })
  capabilities: string[]; // 'streaming', 'vision', 'function_calling', etc.

  @Prop({ type: Object, default: {} })
  stats: {
    totalRequests: number;
    avgResponseTime: number;
    successRate: number;
  };
}

export const AIModelSchema = SchemaFactory.createForClass(AIModel);

AIModelSchema.index({ type: 1, isActive: 1, sortOrder: 1 });
AIModelSchema.index({ slug: 1 });