import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ConversationDocument = Conversation & Document;

@Schema({ timestamps: true })
export class Conversation {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  modelSlug: string;

  @Prop({ default: 'Новый чат' })
  title: string;

  @Prop({ default: false })
  isPinned: boolean;

  @Prop({ default: false })
  isArchived: boolean;

  @Prop({ default: 0 })
  messageCount: number;

  @Prop({ default: 0 })
  totalTokensUsed: number;

  // Системный промпт
  @Prop()
  systemPrompt: string;

  // Настройки для этого чата
  @Prop({ type: Object, default: {} })
  settings: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
  };

  @Prop()
  lastMessageAt: Date;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

ConversationSchema.index({ userId: 1, createdAt: -1 });
ConversationSchema.index({ userId: 1, isPinned: -1, lastMessageAt: -1 });