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
    required: true,
    enum: Object.values(PromoCodeType),
    default: PromoCodeType.BONUS_TOKENS,
    index: true,
  })
  type: PromoCodeType;

  @Prop({
    required: true,
    enum: Object.values(PromoApplyTo),
    default: PromoApplyTo.ANY,
  })
  applyTo: PromoApplyTo;

  // ─── Значения (зависят от type) ───────────────────────────────
  /** Для type=BONUS_TOKENS — сколько токенов начислить. */
  @Prop({ default: 0, min: 0 })
  bonusTokens: number;

  /** Для type=DISCOUNT_PERCENT — процент скидки (1-100). */
  @Prop({ default: 0, min: 0, max: 100 })
  discountPercent: number;

  /** Для type=DISCOUNT_RUB — фиксированная скидка в рублях. */
  @Prop({ default: 0, min: 0 })
  discountRub: number;

  /** Для type=SUBSCRIPTION_DAYS — сколько дней подписки. */
  @Prop({ default: 0, min: 0 })
  subscriptionDays: number;

  /** Для type=SUBSCRIPTION_DAYS — какой план активировать. */
  @Prop({ default: null })
  subscriptionPlan: string | null;

  // ─── Ограничения применения ───────────────────────────────────
  /** Применим только к этим плановым ключам. null/[] = к любому. */
  @Prop({ type: [String], default: [] })
  applicablePlans: string[];

  /** Применим только к этим packageId. null/[] = к любому. */
  @Prop({ type: [String], default: [] })
  applicablePackages: string[];

  /** Минимальная сумма покупки в рублях для применения скидки. */
  @Prop({ default: 0, min: 0 })
  minPurchaseRub: number;

  // ─── Лимиты использования ─────────────────────────────────────
  /** null = без ограничения. */
  @Prop({ default: null })
  maxUses: number | null;

  @Prop({ default: 0 })
  currentUses: number;

  /** Сколько раз один юзер может использовать. */
  @Prop({ default: 1, min: 1 })
  maxUsesPerUser: number;

  // ─── Сроки ────────────────────────────────────────────────────
  @Prop({ default: null })
  startsAt: Date | null;

  @Prop({ default: null, index: true })
  expiresAt: Date | null;

  // ─── Статусы ──────────────────────────────────────────────────
  @Prop({ default: true, index: true })
  isActive: boolean;

  // ─── Кто использовал (для maxUsesPerUser) ─────────────────────
  /**
   * Массив { userId, usesCount, lastUsedAt } — компактнее чем дублировать строки.
   * Поскольку maxUsesPerUser обычно = 1, можно держать как массив userId.
   * Для гибкости — храним подробнее.
   */
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
  @Prop({ default: 0 })
  totalDiscountGivenRub: number;

  @Prop({ default: 0 })
  totalBonusTokensGiven: number;

  @Prop({ default: 0 })
  totalSubscriptionDaysGiven: number;

  // ─── Метаданные ───────────────────────────────────────────────
  @Prop({ default: null })
  createdBy: string | null;

  @Prop({ default: null })
  internalNote: string | null;
}

export const PromoCodeSchema = SchemaFactory.createForClass(PromoCode);

// Композитный индекс — для быстрого поиска активных и не истёкших
PromoCodeSchema.index({ code: 1, isActive: 1 });
PromoCodeSchema.index({ isActive: 1, expiresAt: 1 });