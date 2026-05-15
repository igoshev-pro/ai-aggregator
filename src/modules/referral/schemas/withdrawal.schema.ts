import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WithdrawalDocument = Withdrawal & Document;

export enum WithdrawalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PAID = 'paid',
}

export enum WithdrawalMethod {
  CARD = 'card',
  SBP = 'sbp',
  CRYPTO = 'crypto',
}

@Schema({ timestamps: true })
export class Withdrawal {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId;

  /** Сумма в спичках (= рублях, 1:1) */
  @Prop({ required: true, min: 1 })
  amount: number;

  /** Сумма в рублях для выплаты */
  @Prop({ required: true, min: 1 })
  amountRub: number;

  @Prop({ required: true, type: String, enum: WithdrawalMethod })
  method: WithdrawalMethod;

  /** Реквизиты в свободной форме (номер карты, телефон, кошелёк) */
  @Prop({ required: true })
  requisites: string;

  @Prop({
    required: true,
    type: String,
    enum: WithdrawalStatus,
    default: WithdrawalStatus.PENDING,
  })
  status: WithdrawalStatus;

  /** Комментарий админа (причина отклонения, ID платежа и т.п.) */
  @Prop({ default: '' })
  adminNote: string;

  @Prop({ type: Date })
  processedAt: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  processedBy: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const WithdrawalSchema = SchemaFactory.createForClass(Withdrawal);

WithdrawalSchema.index({ userId: 1, createdAt: -1 });
WithdrawalSchema.index({ status: 1, createdAt: -1 });