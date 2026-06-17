import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { SubscriptionPlan } from '@/common/interfaces';

export type SubscriptionDocument = Subscription & Document;

@Schema({ timestamps: true })
export class Subscription {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: SubscriptionPlan })
  plan: SubscriptionPlan;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  autoRenew: boolean;

  @Prop()
  paymentProvider: string;

  @Prop()
  externalSubscriptionId: string;

  @Prop({ default: 0 })
  tokensPerMonth: number;

  // 🆕 Бонусные спички, начисляемые единоразово при активации плана
  @Prop({ default: 0 })
  bonusTokens: number;

  @Prop({ default: 0 })
  priceRub: number;

  // 🆕 Расширяемая структура — фичи разных планов могут отличаться
  @Prop({ type: Object, default: {} })
  features: Record<string, any>;

  // 🆕 Произвольные данные активации (флаг promo, кол-во дней и т.д.)
  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);

// 🆕 Для cron checkExpiredSubscriptions (каждый час)
SubscriptionSchema.index({ isActive: 1, endDate: 1 });

// 🆕 Для поиска активной подписки юзера (getBalance, и т.д.)
SubscriptionSchema.index({ userId: 1, isActive: 1, endDate: -1 });

// 🆕 Для миграции deprecated планов
SubscriptionSchema.index({ isActive: 1, plan: 1 });