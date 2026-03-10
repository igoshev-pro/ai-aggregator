import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type FavoriteDocument = Favorite & Document;

@Schema({ timestamps: true })
export class Favorite {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  type: string; // 'generation' | 'conversation' | 'model'

  @Prop({ required: true })
  itemId: string;

  @Prop()
  title: string;

  @Prop()
  previewUrl: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const FavoriteSchema = SchemaFactory.createForClass(Favorite);

FavoriteSchema.index({ userId: 1, type: 1, itemId: 1 }, { unique: true });