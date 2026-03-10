// src/modules/analytics/schemas/analytics-event.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AnalyticsEventDocument = AnalyticsEvent & Document;

@Schema({ timestamps: true })
export class AnalyticsEvent {
  @Prop({ required: true, index: true })
  event: string; // 'page_view', 'generation_start', 'payment_init', 'model_select', etc.

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId;

  @Prop()
  sessionId: string;

  @Prop({ type: Object, default: {} })
  properties: Record<string, any>;

  @Prop()
  source: string; // 'miniapp', 'webapp', 'bot'

  @Prop()
  platform: string; // 'ios', 'android', 'desktop', 'web'

  @Prop()
  userAgent: string;

  @Prop()
  ip: string;
}

export const AnalyticsEventSchema = SchemaFactory.createForClass(AnalyticsEvent);

AnalyticsEventSchema.index({ event: 1, createdAt: -1 });
AnalyticsEventSchema.index({ userId: 1, event: 1, createdAt: -1 });
AnalyticsEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // TTL 90 дней