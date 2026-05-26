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

  /** Сумма в рублях для выплаты */
  @Prop({ required: true, min: 100 })  // 🆕 синхронизация с MIN_WITHDRAWAL_AMOUNT
  amount: number;

  @Prop({ required: true, min: 100 })  // 🆕
  amountRub: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  processedBy: Types.ObjectId;

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



  createdAt: Date;
  updatedAt: Date;
}

export const WithdrawalSchema = SchemaFactory.createForClass(Withdrawal);

WithdrawalSchema.index({ userId: 1, createdAt: -1 });
WithdrawalSchema.index({ status: 1, createdAt: -1 });