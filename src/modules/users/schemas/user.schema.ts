// src/modules/users/schemas/user.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { UserRole, SubscriptionPlan } from '@/common/interfaces';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, index: true })
  telegramId: number;

  @Prop({ default: '' })
  firstName: string;

  @Prop({ default: '' })
  lastName: string;

  @Prop({ default: '', index: true })
  username: string;

  @Prop({ default: '' })
  photoUrl: string;

  @Prop({ default: '' })
  languageCode: string;

  @Prop({ default: false })
  isPremiumTelegram: boolean;

  @Prop({ default: 0, min: 0 })
  tokenBalance: number;

  @Prop({ default: 0, min: 0 })
  bonusTokens: number;

  @Prop({ default: 0 })
  totalTokensSpent: number;

  @Prop({ default: 0 })
  totalDeposited: number;

  @Prop({ type: String, enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Prop({ type: String, enum: SubscriptionPlan, default: SubscriptionPlan.FREE })
  subscriptionPlan: SubscriptionPlan;

  @Prop({ type: Date, default: null })
  subscriptionExpiresAt: Date | null;

  @Prop({ unique: true, sparse: true })
  referralCode: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  referredBy: Types.ObjectId | null;

  @Prop({ default: 0 })
  referralCount: number;

  @Prop({ default: 0 })
  referralEarnings: number;

  @Prop({ default: 0 })
  dailyGenerations: number;

  @Prop({ type: Date, default: null })
  dailyGenerationsResetAt: Date | null;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  isBanned: boolean;

  @Prop({ default: '' })
  banReason: string;

  @Prop({ type: Date, default: null })
  lastActiveAt: Date | null;

  @Prop({ type: Object, default: {} })
  settings: {
    defaultTextModel?: string;
    defaultImageModel?: string;
    defaultVideoModel?: string;
    theme?: string;
    language?: string;
    notifications?: boolean;
  };
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ telegramId: 1 });
UserSchema.index({ username: 1 });
UserSchema.index({ referralCode: 1 });
UserSchema.index({ role: 1 });
UserSchema.index({ createdAt: -1 });