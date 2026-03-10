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

  // Промпт/запрос
  @Prop({ required: true })
  prompt: string;

  @Prop()
  negativePrompt: string;

  // Параметры генерации
  @Prop({ type: Object, default: {} })
  params: {
    width?: number;
    height?: number;
    steps?: number;
    seed?: number;
    numImages?: number;
    style?: string;
    aspectRatio?: string;
    duration?: number;
    fps?: number;
    resolution?: string;
    imageUrl?: string; // for img2img, img2video
    instrumental?: boolean;
    voiceId?: string;
    language?: string;
  };

  // Результат
  @Prop({ type: [String], default: [] })
  resultUrls: string[];

  @Prop()
  resultContent: string; // для текстовых результатов

  // Task tracking для async генераций
  @Prop()
  taskId: string;

  @Prop()
  providerSlug: string;

  @Prop({ default: 0 })
  progress: number; // 0-100

  @Prop()
  eta: number; // секунды до завершения

  // Стоимость
  @Prop({ default: 0 })
  tokensCost: number;

  @Prop({ default: false })
  isRefunded: boolean;

  // Время
  @Prop()
  startedAt: Date;

  @Prop()
  completedAt: Date;

  @Prop()
  responseTimeMs: number;

  // Ошибки
  @Prop()
  errorMessage: string;

  @Prop({ default: 0 })
  retryCount: number;

  // Метаданные
  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;

  // Пользователь добавил в избранное
  @Prop({ default: false })
  isFavorite: boolean;
}

export const GenerationSchema = SchemaFactory.createForClass(Generation);

GenerationSchema.index({ userId: 1, createdAt: -1 });
GenerationSchema.index({ userId: 1, type: 1, createdAt: -1 });
GenerationSchema.index({ status: 1, taskId: 1 });
GenerationSchema.index({ userId: 1, isFavorite: 1, createdAt: -1 });