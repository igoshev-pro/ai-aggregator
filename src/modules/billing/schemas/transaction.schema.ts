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
  amount: number; // в токенах (положительное — приход, отрицательное — расход)

  @Prop({ default: 0 })
  balanceBefore: number;

  @Prop({ default: 0 })
  balanceAfter: number;

  @Prop({ required: true })
  description: string;

  @Prop({ enum: PaymentStatus })
  paymentStatus: PaymentStatus;

  // Связь с генерацией
  @Prop()
  generationId: string;

  @Prop()
  generationType: string; // text, image, video, audio

  @Prop()
  modelSlug: string;

  // Связь с платежом
  @Prop()
  externalPaymentId: string; // ID из платёжной системы

  @Prop()
  paymentProvider: string; // yookassa, cryptomus, stars

  @Prop()
  paymentAmountRub: number; // сумма в рублях

  // Промокод
  @Prop()
  promoCode: string;

  // Реферал
  @Prop({ type: Types.ObjectId, ref: 'User' })
  referralUserId: Types.ObjectId;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

TransactionSchema.index({ userId: 1, createdAt: -1 });
TransactionSchema.index({ userId: 1, type: 1, createdAt: -1 });
TransactionSchema.index({ externalPaymentId: 1 });