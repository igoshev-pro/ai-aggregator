// src/modules/users/schemas/user.schema.ts




import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { UserRole, SubscriptionPlan, AuthProvider } from '@/common/interfaces';




@Schema({ timestamps: true })
export class User {
  // ─── Auth Provider ────────────────────────────────────────
  @Prop({ type: String, enum: AuthProvider, default: AuthProvider.TELEGRAM })
  authProvider: AuthProvider;




  // ─── Telegram Auth ────────────────────────────────────────
  @Prop({ type: Number, default: null })
  telegramId: number | null;




  @Prop({ default: false })
  isPremiumTelegram: boolean;




  // ─── Email Auth ───────────────────────────────────────────
  @Prop({ type: String, default: null })
  email: string | null;




  /** Почта без точек/+меток (см. canonicalEmail) — только для поиска дублей. */
  @Prop({ type: String, default: null, index: true })
  emailCanonical: string | null;

  @Prop({ type: String, default: null, select: false })
  passwordHash: string | null;




  @Prop({ default: false })
  isEmailVerified: boolean;




  // ─── Google Auth ──────────────────────────────────────────
  @Prop({ type: String, default: null })
  googleId: string | null;




  // ─── Profile ──────────────────────────────────────────────
  @Prop({ default: '' })
  firstName: string;




  @Prop({ default: '' })
  lastName: string;




  @Prop({ default: '' })
  username: string;




  @Prop({ default: '' })
  photoUrl: string;




  @Prop({ default: '' })
  languageCode: string;




  // ─── Balance ──────────────────────────────────────────────
  // 🔥 ВАЖНО: убран min: 0 для всех балансов, чтобы избежать
  // ValidationError при float-погрешностях (например -1.7e-16).
  // Защита от отрицательных значений теперь в UsersService.
  // ──────────────────────────────────────────────────────────




  @Prop({ default: 0 })
  tokenBalance: number;




  @Prop({ default: 0 })
  bonusTokens: number;




  /**
   * Кэшбэк от рефералов (10% от покупок приглашённых).
   * Тратится как обычные спички, но может быть выведен реальными деньгами.
   */
  @Prop({ default: 0 })
  cashbackBalance: number;




  /**
   * Всего заработано кэшбеком за всё время (для статистики).
   * Не уменьшается при тратах/выводе.
   */
  @Prop({ default: 0, min: 0 })
  cashbackEarnedTotal: number;




  @Prop({ default: 0 })
  totalTokensSpent: number;




  @Prop({ default: 0 })
  totalDeposited: number;




  // ─── Role & Subscription ─────────────────────────────────
  @Prop({ type: String, enum: UserRole, default: UserRole.USER })
  role: UserRole;




  @Prop({
    type: String,
    enum: SubscriptionPlan,
    default: SubscriptionPlan.FREE,
  })
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




  @Prop({ default: false, index: true })
  isDeleted: boolean;




  @Prop({ type: Date, default: null })
  deletedAt: Date | null;




  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy: Types.ObjectId | null;




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




// Уникальность способов входа.
//
// Раньше здесь стояло sparse + partialFilterExpression {$ne: null}, а у полей
// в @Prop — ещё и sparse: true. Mongo не принимает $ne в фильтре частичного
// индекса и не даёт совмещать его со sparse, а sparse из @Prop занимал имя
// email_1 обычным (не уникальным) индексом. В итоге уникальных индексов в
// базе не было вовсе, и параллельные регистрации заводили дубли.
//
// Частичный индекс только по реальным значениям: null у Telegram-пользователя
// без почты (и наоборот) не участвует и не конфликтует. Фильтр через $gt, а
// не $type: из {email: 'x'} планировщик выводит 'x' > '' и использует индекс
// для поиска, а с $type такой вывод не гарантирован.
UserSchema.index(
  { telegramId: 1 },
  { unique: true, partialFilterExpression: { telegramId: { $gt: 0 } } },
);
UserSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $gt: '' } } },
);
UserSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $gt: '' } } },
);
UserSchema.index({ username: 1 });
UserSchema.index({ role: 1 });
UserSchema.index({ createdAt: -1 });