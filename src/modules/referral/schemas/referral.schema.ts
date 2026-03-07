import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ReferralDocument = Referral & Document;

@Schema({ timestamps: true })
export class Referral {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  referrerId: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  referredId: Types.ObjectId;

  @Prop({ default: 0 })
  bonusEarned: number; // Сколько бонусов принёс реферал

  @Prop({ default: false })
  hasPurchased: boolean; // Делал ли реферал покупку

  @Prop()
  firstPurchaseAt: Date;
}

export const ReferralSchema = SchemaFactory.createForClass(Referral);

ReferralSchema.index({ referrerId: 1 });
ReferralSchema.index({ referredId: 1 }, { unique: true });