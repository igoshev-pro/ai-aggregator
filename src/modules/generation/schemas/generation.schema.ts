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
    width?: number;
    height?: number;
    aspectRatio?: string;    // ← ДОБАВИТЬ
    resolution?: string;     // ← ДОБАВИТЬ
    quality?: string;        // ← ДОБАВИТЬ
    outputFormat?: string;   // ← ДОБАВИТЬ
    steps?: number;
    seed?: number;
    numImages?: number;
    style?: string;
    imageUrl?: string;
    inputUrls?: string[];    // ← ДОБАВИТЬ
    duration?: number;
    instrumental?: boolean;
    voiceId?: string;
    language?: string;
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