import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SubscriptionPlanDocument = SubscriptionPlanEntity & Document;

@Schema({ _id: false })
export class FreeModelAccessSchema {
  @Prop({ required: true }) modelSlug: string;
  @Prop({ required: true }) displayName: string;
  @Prop({ default: null, type: Number }) hourlyLimit: number | null;
  @Prop({ default: null, type: Number }) dailyLimit: number | null;
}

@Schema({ _id: false })
export class PlanFeaturesSchema {
  @Prop({ default: 50 }) maxDailyGenerations: number;
  @Prop({ default: false }) priorityQueue: boolean;
  @Prop({ default: false }) exclusiveModels: boolean;
  @Prop({ default: false }) noWatermark: boolean;
  @Prop({ default: 20 }) maxContextMessages: number;
}

@Schema({ timestamps: true, collection: 'subscription_plans' })
export class SubscriptionPlanEntity {
  /** Уникальный ключ плана (basic/plus/max/ultimate/...) */
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  planKey: string;

  @Prop({ required: true }) name: string;
  @Prop({ default: '' }) description: string;

  @Prop({ required: true, min: 0 }) priceRub: number;
  @Prop({ default: 0, min: 0 }) tokensPerMonth: number;
  @Prop({ default: 0, min: 0 }) bonusTokens: number;

  /** 'limited' | 'full' */
  @Prop({ default: 'limited', enum: ['limited', 'full'] })
  modelsAccess: 'limited' | 'full';

  @Prop({ type: [FreeModelAccessSchema], default: [] })
  freeModels: FreeModelAccessSchema[];

  @Prop({ type: PlanFeaturesSchema, default: () => ({}) })
  features: PlanFeaturesSchema;

  @Prop({ type: [String], default: [] })
  capabilities: string[];

  // UI
  @Prop({ default: '#60a5fa' }) color: string;
  @Prop({ default: 'Zap' }) icon: string; // имя lucide-иконки
  @Prop({ default: false }) isPopular: boolean;

  @Prop({ default: true }) isActive: boolean;
  @Prop({ default: 0 }) sortOrder: number;
}

export const SubscriptionPlanSchema =
  SchemaFactory.createForClass(SubscriptionPlanEntity);

SubscriptionPlanSchema.index({ isActive: 1, sortOrder: 1 });