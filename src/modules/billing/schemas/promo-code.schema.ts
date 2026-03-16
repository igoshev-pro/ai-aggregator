import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PromoCodeDocument = PromoCode & Document;

@Schema({ timestamps: true })
export class PromoCode {
  @Prop({ required: true, unique: true, uppercase: true })
  code: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  bonusTokens: number;

  @Prop({ default: 0 })
  discountPercent: number; // Скидка на пополнение

  @Prop({ default: null })
  maxUses: number; // null = unlimited

  @Prop({ default: 0 })
  currentUses: number;

  @Prop({ default: 1 })
  maxUsesPerUser: number;

  @Prop()
  expiresAt: Date;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: [String], default: [] })
  usedByUsers: string[]; // telegramId или userId

  @Prop()
  createdBy: string; // admin userId
}

export const PromoCodeSchema = SchemaFactory.createForClass(PromoCode);

// Удалён дублирующийся индекс, так как code уже unique