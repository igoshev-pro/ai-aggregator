import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { UserRole, SubscriptionPlan, AuthProvider } from '@/common/interfaces';

@Schema({ timestamps: true })
export class User {
  // ─── Auth Provider ────────────────────────────────────────
  @Prop({ type: String, enum: AuthProvider, default: AuthProvider.TELEGRAM })
  authProvider: AuthProvider;

  // ─── Telegram Auth (optional for email/google users) ──────
  @Prop({ type: Number, default: null, sparse: true, index: true })
  telegramId: number | null;

  @Prop({ default: false })
  isPremiumTelegram: boolean;

  // ─── Email Auth (optional for telegram users) ─────────────
  @Prop({ type: String, default: null, sparse: true, index: true })
  email: string | null;

  @Prop({ type: String, default: null, select: false })
  passwordHash: string | null;

  @Prop({ default: false })
  isEmailVerified: boolean;

  // ─── Google Auth ──────────────────────────────────────────
  @Prop({ type: String, default: null, sparse: true })
  googleId: string | null;

  // ─── Profile ──────────────────────────────────────────────
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

  // ─── Balance ──────────────────────────────────────────────
  @Prop({ default: 0, min: 0 })
  tokenBalance: number;

  @Prop({ default: 0, min: 0 })
  bonusTokens: number;

  @Prop({ default: 0 })
  totalTokensSpent: number;

  @Prop({ default: 0 })
  totalDeposited: number;

  // ─── Role & Subscription ─────────────────────────────────
  @Prop({ type: String, enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Prop({ type: String, enum: SubscriptionPlan, default: SubscriptionPlan.FREE })
  subscriptionPlan: SubscriptionPlan;

  @Prop({ type: Date, default: null })
  subscriptionExpiresAt: Date | null;

  // ─── Referral ─────────────────────────────────────────────
  @Prop({ unique: true, sparse: true })
  referralCode: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  referredBy: Types.ObjectId | null;

  @Prop({ default: 0 })
  referralCount: number;

  @Prop({ default: 0 })
  referralEarnings: number;

  // ─── Limits ───────────────────────────────────────────────
  @Prop({ default: 0 })
  dailyGenerations: number;

  @Prop({ type: Date, default: null })
  dailyGenerationsResetAt: Date | null;

  // ─── Status ───────────────────────────────────────────────
  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  isBanned: boolean;

  @Prop({ default: '' })
  banReason: string;

  @Prop({ type: Date, default: null })
  lastActiveAt: Date | null;

  // ─── Settings ─────────────────────────────────────────────
  @Prop({ type: Object, default: {} })
  settings: {
    defaultTextModel?: string;
    defaultImageModel?: string;
    defaultVideoModel?: string;
    theme?: string;
    language?: string;
    notifications?: boolean;
  };

  // ─── Timestamps (виртуальные, заполняются Mongoose) ───────
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<User>;

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index(
  { telegramId: 1 },
  { unique: true, sparse: true, partialFilterExpression: { telegramId: { $ne: null } } },
);
UserSchema.index(
  { email: 1 },
  { unique: true, sparse: true, partialFilterExpression: { email: { $ne: null } } },
);
UserSchema.index(
  { googleId: 1 },
  { unique: true, sparse: true, partialFilterExpression: { googleId: { $ne: null } } },
);
UserSchema.index({ username: 1 });
UserSchema.index({ referralCode: 1 });
UserSchema.index({ role: 1 });
UserSchema.index({ createdAt: -1 });