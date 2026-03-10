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
  tokensPerMonth: number; // Кол-во токенов в месяц

  @Prop({ default: 0 })
  priceRub: number;

  @Prop({ type: Object, default: {} })
  features: {
    maxDailyGenerations: number;
    priorityQueue: boolean;
    exclusiveModels: boolean;
    noWatermark: boolean;
    maxContextMessages: number;
  };
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);

SubscriptionSchema.index({ userId: 1, isActive: 1 });
SubscriptionSchema.index({ endDate: 1 });