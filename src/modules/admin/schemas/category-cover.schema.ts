import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CategoryCoverDocument = CategoryCover & Document;

export type CategoryId = 'text' | 'image' | 'video' | 'audio';

@Schema({ collection: 'category_covers', timestamps: true })
export class CategoryCover {
  @Prop({ required: true, unique: true, index: true })
  categoryId: CategoryId;

  @Prop({ required: true })
  imageUrl: string;

  @Prop({ default: '' })
  s3Key: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;
}

export const CategoryCoverSchema = SchemaFactory.createForClass(CategoryCover);