import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TokenPackageDocument = TokenPackageEntity & Document;

@Schema({ timestamps: true, collection: 'token_packages' })
export class TokenPackageEntity {
  /** ID пакета — slug, например pack_300 */
  @Prop({ required: true, unique: true, trim: true })
  packageId: string;

  @Prop({ required: true }) label: string;
  @Prop({ required: true, min: 1 }) tokens: number;
  @Prop({ required: true, min: 0 }) priceRub: number;

  /** Бонус % сверху (например, 20 = +20% токенов сверху) */
  @Prop({ default: 0, min: 0 }) bonusPercent: number;

  @Prop({ default: false }) popular: boolean;
  @Prop({ default: false }) best: boolean;

  @Prop({ default: true }) isActive: boolean;
  @Prop({ default: 0 }) sortOrder: number;
}

export const TokenPackageSchema =
  SchemaFactory.createForClass(TokenPackageEntity);

TokenPackageSchema.index({ isActive: 1, sortOrder: 1 });