import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { TransactionType, PaymentStatus } from '@/common/interfaces';

export type TransactionDocument = Transaction & Document;

@Schema({ timestamps: true })
export class Transaction {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(TransactionType),
    index: true,
  })
  type: TransactionType;

  @Prop({ type: Number, required: true })
  amount: number;

  @Prop({ type: Number, default: 0 })
  balanceBefore: number;

  @Prop({ type: Number, default: 0 })
  balanceAfter: number;

  @Prop({ type: String, required: true })
  description: string;

  @Prop({ type: String, enum: Object.values(PaymentStatus), index: true })
  paymentStatus: PaymentStatus;

  @Prop({ type: String })
  generationId: string;

  @Prop({ type: String })
  generationType: string;

  @Prop({ type: String, index: true })
  modelSlug: string;

  @Prop({ type: String, index: true })
  externalPaymentId: string;

  @Prop({ type: String, index: true })
  paymentProvider: string;

  @Prop({ type: Number })
  paymentAmountRub: number;

  @Prop({ type: String, uppercase: true, trim: true })
  promoCode: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  referralUserId: Types.ObjectId;

  // ─── Точный учёт ──────────────────────────────────────────────
  @Prop({ type: Number, default: 0 })
  inputTokens: number;

  @Prop({ type: Number, default: 0 })
  outputTokens: number;

  @Prop({ type: Number, default: 0 })
  costInDollars: number;

  @Prop({ type: Number, default: 0 })
  costInTokens: number;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

// ─── Базовые ───────────────────────────────────────────────────
TransactionSchema.index({ userId: 1, createdAt: -1 });
TransactionSchema.index({ userId: 1, type: 1, createdAt: -1 });
TransactionSchema.index({ paymentStatus: 1, createdAt: -1 });

// 🆕 Webhook lookup (hot path при каждом платеже)
TransactionSchema.index(
  { externalPaymentId: 1, paymentProvider: 1 },
  { sparse: true },
);

// 🆕 Для checkFreeModelAccess — частые count'ы за час/день
TransactionSchema.index({
  userId: 1,
  type: 1,
  modelSlug: 1,
  'metadata.freeAccess': 1,
  createdAt: -1,
});

// 🆕 Для getRevenueStats и admin-аналитики
TransactionSchema.index({ type: 1, paymentStatus: 1, createdAt: -1 });