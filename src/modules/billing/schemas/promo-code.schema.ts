import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PromoCodeDocument = PromoCode & Document;

/**
 * Тип промокода — определяет, что он даёт пользователю.
 */
export enum PromoCodeType {
  /** Начисляет бонус-токены после успешной оплаты (или сразу, если применён напрямую). */
  BONUS_TOKENS = 'bonus_tokens',
  /** Скидка в процентах от суммы платежа (1-100). */
  DISCOUNT_PERCENT = 'discount_percent',
  /** Фиксированная скидка в рублях от суммы платежа. */
  DISCOUNT_RUB = 'discount_rub',
  /** Даёт N дней подписки бесплатно (без оплаты). */
  SUBSCRIPTION_DAYS = 'subscription_days',
}

/**
 * Контекст применения — к каким покупкам применим промокод.
 */
export enum PromoApplyTo {
  /** К любой покупке (и подписка, и пакет). */
  ANY = 'any',
  /** Только к подпискам. */
  SUBSCRIPTION = 'subscription',
  /** Только к пакетам токенов. */
  TOKEN_PACKAGE = 'token_package',
  /** Применяется отдельно (без покупки) — даёт бонус сразу. */
  STANDALONE = 'standalone',
}

@Schema({ timestamps: true })
export class PromoCode {
  // ─── Идентификация ────────────────────────────────────────────
  @Prop({ required: true, unique: true, uppercase: true, trim: true, index: true })
  code: string;

  @Prop({ required: true, trim: true })
  description: string;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(PromoCodeType),
    default: PromoCodeType.BONUS_TOKENS,
    index: true,
  })
  type: PromoCodeType;

  @Prop({
    type: String,
    required: true,
    enum: Object.values(PromoApplyTo),
    default: PromoApplyTo.ANY,
  })
  applyTo: PromoApplyTo;

  // ─── Значения (зависят от type) ───────────────────────────────
  @Prop({ type: Number, default: 0, min: 0 })
  bonusTokens: number;

  @Prop({ type: Number, default: 0, min: 0, max: 100 })
  discountPercent: number;

  @Prop({ type: Number, default: 0, min: 0 })
  discountRub: number;

  @Prop({ type: Number, default: 0, min: 0 })
  subscriptionDays: number;

  @Prop({ type: String, enum: ['pro', 'premium'], default: null })
  subscriptionPlan?: 'pro' | 'premium' | null;

  // ─── Ограничения применения ───────────────────────────────────
  @Prop({ type: [String], default: [] })
  applicablePlans: string[];

  @Prop({ type: [String], default: [] })
  applicablePackages: string[];

  @Prop({ type: Number, default: 0, min: 0 })
  minPurchaseRub: number;

  // ─── Лимиты использования ─────────────────────────────────────
  /** null = без ограничения. */
  @Prop({ type: Number, default: null })
  maxUses: number | null;

  @Prop({ type: Number, default: 0 })
  currentUses: number;

  @Prop({ type: Number, default: 1, min: 1 })
  maxUsesPerUser: number;

  // ─── Сроки ────────────────────────────────────────────────────
  @Prop({ type: Date, default: null })
  startsAt: Date | null;

  @Prop({ type: Date, default: null, index: true })
  expiresAt: Date | null;

  // ─── Статусы ──────────────────────────────────────────────────
  @Prop({ type: Boolean, default: true, index: true })
  isActive: boolean;

  // ─── Кто использовал ──────────────────────────────────────────
  @Prop({
    type: [
      {
        userId: { type: Types.ObjectId, ref: 'User', required: true },
        usesCount: { type: Number, default: 1 },
        lastUsedAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  usages: Array<{
    userId: Types.ObjectId;
    usesCount: number;
    lastUsedAt: Date;
  }>;

  // ─── Статистика ───────────────────────────────────────────────
  @Prop({ type: Number, default: 0 })
  totalDiscountGivenRub: number;

  @Prop({ type: Number, default: 0 })
  totalBonusTokensGiven: number;

  @Prop({ type: Number, default: 0 })
  totalSubscriptionDaysGiven: number;

  // ─── Метаданные ───────────────────────────────────────────────
  @Prop({ type: String, default: null })
  createdBy: string | null;

  @Prop({ type: String, default: null })
  internalNote: string | null;
}

export const PromoCodeSchema = SchemaFactory.createForClass(PromoCode);

// Композитный индекс — для быстрого поиска активных и не истёкших
PromoCodeSchema.index({ code: 1, isActive: 1 });
PromoCodeSchema.index({ isActive: 1, expiresAt: 1 });