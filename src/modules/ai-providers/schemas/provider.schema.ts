import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ProviderDocument = Provider & Document;

@Schema({ timestamps: true })
export class Provider {
  @Prop({ required: true, unique: true })
  slug: string; // 'openrouter', 'evolink', 'kie', 'replicate'

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  baseUrl: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: 1 })
  priority: number; // Для fallback — чем ниже, тем приоритетнее

  @Prop({ type: Object, default: {} })
  healthStatus: {
    isHealthy: boolean;
    lastCheck: Date;
    responseTime: number; // ms
    errorRate: number; // %
    consecutiveErrors: number;
  };

  @Prop({ type: Object, default: {} })
  rateLimits: {
    requestsPerMinute: number;
    requestsPerDay: number;
    currentMinuteCount: number;
    currentDayCount: number;
  };

  @Prop({ type: Object })
  config: Record<string, any>; // Provider-specific config
}

export const ProviderSchema = SchemaFactory.createForClass(Provider);