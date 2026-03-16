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

  @Prop({ 
    required: function() { 
      // content обязателен только если не isStreaming
      return !this.isStreaming; 
    }, 
    default: '' 
  })
  content: string;

  @Prop({ type: [String], default: [] })
  imageUrls: string[];

  @Prop()
  modelSlug: string;

  @Prop()
  providerSlug: string;

  // НОВЫЕ ПОЛЯ для точного учёта токенов
  @Prop({ default: 0 })
  inputTokens: number;

  @Prop({ default: 0 })
  outputTokens: number;

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

  @Prop({ default: false })
  isStreaming: boolean;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
MessageSchema.index({ conversationId: 1, createdAt: 1 });