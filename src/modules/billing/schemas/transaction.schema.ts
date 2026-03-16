import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { TransactionType, PaymentStatus } from '@/common/interfaces';

export type TransactionDocument = Transaction & Document;

@Schema({ timestamps: true })
export class Transaction {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: TransactionType })
  type: TransactionType;

  @Prop({ required: true })
  amount: number;

  @Prop({ default: 0 })
  balanceBefore: number;

  @Prop({ default: 0 })
  balanceAfter: number;

  @Prop({ required: true })
  description: string;

  @Prop({ enum: PaymentStatus })
  paymentStatus: PaymentStatus;

  @Prop()
  generationId: string;

  @Prop()
  generationType: string;

  @Prop()
  modelSlug: string;

  @Prop()
  externalPaymentId: string;

  @Prop()
  paymentProvider: string;

  @Prop()
  paymentAmountRub: number;

  @Prop()
  promoCode: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  referralUserId: Types.ObjectId;

  // НОВЫЕ ПОЛЯ для точного учёта
  @Prop({ default: 0 })
  inputTokens: number;

  @Prop({ default: 0 })
  outputTokens: number;

  @Prop({ default: 0 })
  costInDollars: number;

  @Prop({ default: 0 })
  costInTokens: number;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

TransactionSchema.index({ userId: 1, createdAt: -1 });
TransactionSchema.index({ userId: 1, type: 1, createdAt: -1 });
TransactionSchema.index({ externalPaymentId: 1 });