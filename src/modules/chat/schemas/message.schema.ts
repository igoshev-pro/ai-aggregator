import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MessageDocument = Message & Document;

@Schema({ timestamps: true })
export class Message {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Conversation', index: true })
  conversationId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: ['user', 'assistant', 'system'] })
  role: string;

  @Prop({ required: true })
  content: string;

  // Для сообщений с изображениями (vision)
  @Prop({ type: [String], default: [] })
  imageUrls: string[];

  @Prop()
  modelSlug: string;

  @Prop()
  providerSlug: string;

  @Prop({ type: Object })
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };

  @Prop()
  responseTimeMs: number;

  @Prop({ default: 0 })
  tokensCost: number;

  @Prop({ default: false })
  isError: boolean;

  @Prop()
  errorMessage: string;

  // Для streaming — помечаем что сообщение ещё генерируется
  @Prop({ default: false })
  isStreaming: boolean;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

MessageSchema.index({ conversationId: 1, createdAt: 1 });