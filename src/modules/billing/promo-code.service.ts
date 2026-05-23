// src/modules/billing/promo-code.service.ts
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PromoCode,
  PromoCodeDocument,
  PromoCodeType,
  PromoApplyTo,
} from './schemas/promo-code.schema';

/**
 * Контекст применения промокода — передаётся из BillingService при оплате.
 */
export interface PromoApplyContext {
  purchaseType: 'subscription' | 'token_package' | 'standalone';
  /** Сумма покупки в рублях (для скидок). */
  amountRub?: number;
  /** Ключ плана подписки (lowercase: 'plus', 'pro', 'ultimate'). */
  planKey?: string;
  /** ID пакета токенов. */
  packageId?: string;
}

/**
 * Результат валидации — содержит сам промокод и рассчитанный эффект.
 */
export interface PromoValidationResult {
  promo: PromoCodeDocument;
  /** Человекочитаемый ярлык для UI ("-20%", "+500🔥", "30 дней PLUS"). */
  effectLabel: string;
  /** Размер скидки в рублях (для DISCOUNT_*). */
  discountRub: number;
  /** Сколько токенов начислить (для BONUS_TOKENS). */
  bonusTokens: number;
  /** Сколько дней подписки дать (для SUBSCRIPTION_DAYS). */
  subscriptionDays: number;
  /** Какой план активировать (для SUBSCRIPTION_DAYS). */
  subscriptionPlan: string | null;
  /** Итоговая сумма к оплате после применения скидки. */
  finalAmountRub: number;
}

@Injectable()
export class PromoCodeService {
  private readonly logger = new Logger(PromoCodeService.name);

  constructor(
    @InjectModel(PromoCode.name)
    private readonly promoCodeModel: Model<PromoCodeDocument>,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // ВАЛИДАЦИЯ
  // ═══════════════════════════════════════════════════════════════

  /**
   * Валидирует промокод и считает его эффект.
   * НЕ помечает использование — это делается отдельно через markUsed()
   * после успешной оплаты (или сразу для STANDALONE).
   */
  async validate(
    code: string,
    userId: string,
    context: PromoApplyContext,
  ): Promise<PromoValidationResult> {
    if (!code || !code.trim()) {
      throw new BadRequestException('Промокод не указан');
    }

    const normalizedCode = code.trim().toUpperCase();

    const promo = await this.promoCodeModel.findOne({
      code: normalizedCode,
      isActive: true,
    });

    if (!promo) {
      throw new BadRequestException('Промокод не найден или неактивен');
    }

    const now = new Date();

    // ── Сроки ───────────────────────────────────────────────────
    if (promo.startsAt && promo.startsAt > now) {
      throw new BadRequestException('Промокод ещё не активен');
    }
    if (promo.expiresAt && promo.expiresAt < now) {
      throw new BadRequestException('Срок действия промокода истёк');
    }

    // ── Глобальный лимит ────────────────────────────────────────
    if (promo.maxUses !== null && promo.currentUses >= promo.maxUses) {
      throw new BadRequestException('Лимит использований промокода исчерпан');
    }

    // ── Лимит на одного пользователя ────────────────────────────
    const userOid = new Types.ObjectId(userId);
    const userUsage = promo.usages.find((u) => u.userId.equals(userOid));
    if (userUsage && userUsage.usesCount >= promo.maxUsesPerUser) {
      throw new BadRequestException('Вы уже использовали этот промокод');
    }

    // ── Контекст применения (applyTo) ───────────────────────────
    this.validateApplyContext(promo, context);

    // ── Ограничения по плану/пакету ─────────────────────────────
    if (
      context.purchaseType === 'subscription' &&
      promo.applicablePlans.length > 0
    ) {
      const planKey = (context.planKey || '').toLowerCase();
      const allowed = promo.applicablePlans.map((p) => p.toLowerCase());
      if (!allowed.includes(planKey)) {
        throw new BadRequestException(
          `Промокод действует только для планов: ${promo.applicablePlans.join(', ')}`,
        );
      }
    }

    if (
      context.purchaseType === 'token_package' &&
      promo.applicablePackages.length > 0
    ) {
      if (!context.packageId || !promo.applicablePackages.includes(context.packageId)) {
        throw new BadRequestException(
          `Промокод действует только для пакетов: ${promo.applicablePackages.join(', ')}`,
        );
      }
    }

    // ── Минимальная сумма ───────────────────────────────────────
    if (
      promo.minPurchaseRub > 0 &&
      context.amountRub !== undefined &&
      context.amountRub < promo.minPurchaseRub
    ) {
      throw new BadRequestException(
        `Минимальная сумма для промокода: ${promo.minPurchaseRub}₽`,
      );
    }

    // ── Расчёт эффекта ──────────────────────────────────────────
    return this.computeEffect(promo, context);
  }

  /**
   * Проверка соответствия promo.applyTo и контекста покупки.
   */
  private validateApplyContext(
    promo: PromoCodeDocument,
    context: PromoApplyContext,
  ) {
    const at = promo.applyTo;
    const pt = context.purchaseType;

    if (at === PromoApplyTo.ANY) return;

    if (at === PromoApplyTo.SUBSCRIPTION && pt !== 'subscription') {
      throw new BadRequestException(
        'Этот промокод применяется только к подпискам',
      );
    }
    if (at === PromoApplyTo.TOKEN_PACKAGE && pt !== 'token_package') {
      throw new BadRequestException(
        'Этот промокод применяется только к пакетам токенов',
      );
    }
    if (at === PromoApplyTo.STANDALONE && pt !== 'standalone') {
      throw new BadRequestException(
        'Этот промокод применяется отдельно (без покупки)',
      );
    }
  }

  /**
   * Расчёт финальной суммы и эффекта.
   */
  private computeEffect(
    promo: PromoCodeDocument,
    context: PromoApplyContext,
  ): PromoValidationResult {
    const amountRub = context.amountRub || 0;
    let discountRub = 0;
    let bonusTokens = 0;
    let subscriptionDays = 0;
    let effectLabel = '';

    switch (promo.type) {
      case PromoCodeType.BONUS_TOKENS:
        bonusTokens = promo.bonusTokens;
        effectLabel = `+${promo.bonusTokens} 🔥 спичек`;
        break;

      case PromoCodeType.DISCOUNT_PERCENT:
        discountRub = Math.floor((amountRub * promo.discountPercent) / 100);
        effectLabel = `−${promo.discountPercent}% (${discountRub}₽)`;
        break;

      case PromoCodeType.DISCOUNT_RUB:
        discountRub = Math.min(promo.discountRub, amountRub);
        effectLabel = `−${discountRub}₽`;
        break;

      case PromoCodeType.SUBSCRIPTION_DAYS:
        subscriptionDays = promo.subscriptionDays;
        effectLabel = `${promo.subscriptionDays} дней ${(
          promo.subscriptionPlan || 'подписки'
        ).toUpperCase()} бесплатно`;
        break;
    }

    const finalAmountRub = Math.max(0, amountRub - discountRub);

    return {
      promo,
      effectLabel,
      discountRub,
      bonusTokens,
      subscriptionDays,
      subscriptionPlan: promo.subscriptionPlan,
      finalAmountRub,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // ОТМЕТКА ИСПОЛЬЗОВАНИЯ
  // ═══════════════════════════════════════════════════════════════

  /**
   * Помечает промокод как использованный пользователем.
   * Атомарно увеличивает currentUses и обновляет статистику.
   */
  async markUsed(
    promoId: string | Types.ObjectId,
    userId: string,
    effect: {
      discountRub?: number;
      bonusTokens?: number;
      subscriptionDays?: number;
    },
  ) {
    const userOid = new Types.ObjectId(userId);
    const promoOid =
      typeof promoId === 'string' ? new Types.ObjectId(promoId) : promoId;

    const promo = await this.promoCodeModel.findById(promoOid);
    if (!promo) {
      this.logger.warn(`markUsed: promo ${promoId} not found`);
      return;
    }

    // Обновляем usages
    const existing = promo.usages.find((u) => u.userId.equals(userOid));
    if (existing) {
      existing.usesCount += 1;
      existing.lastUsedAt = new Date();
    } else {
      promo.usages.push({
        userId: userOid,
        usesCount: 1,
        lastUsedAt: new Date(),
      });
    }

    promo.currentUses += 1;
    promo.totalDiscountGivenRub += effect.discountRub || 0;
    promo.totalBonusTokensGiven += effect.bonusTokens || 0;
    promo.totalSubscriptionDaysGiven += effect.subscriptionDays || 0;

    await promo.save();

    this.logger.log(
      `🎟 Promo ${promo.code} used by ${userId} | ` +
        `discount=${effect.discountRub || 0}₽ ` +
        `bonus=${effect.bonusTokens || 0}🔥 ` +
        `days=${effect.subscriptionDays || 0}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // CRUD — для админки
  // ═══════════════════════════════════════════════════════════════

  async create(data: {
    code: string;
    description: string;
    type: PromoCodeType;
    applyTo?: PromoApplyTo;
    bonusTokens?: number;
    discountPercent?: number;
    discountRub?: number;
    subscriptionDays?: number;
    subscriptionPlan?: string | null;
    applicablePlans?: string[];
    applicablePackages?: string[];
    minPurchaseRub?: number;
    maxUses?: number | null;
    maxUsesPerUser?: number;
    startsAt?: Date | null;
    expiresAt?: Date | null;
    createdBy?: string | null;
    internalNote?: string | null;
  }) {
    const code = data.code.trim().toUpperCase();

    const exists = await this.promoCodeModel.findOne({ code });
    if (exists) {
      throw new BadRequestException(`Промокод ${code} уже существует`);
    }

    // Валидация значений по типу
    this.validateCreateData(data);

    const promo = await this.promoCodeModel.create({
      ...data,
      code,
      applyTo: data.applyTo || PromoApplyTo.ANY,
    });

    this.logger.log(`🎟 Promo ${code} created (type=${data.type})`);
    return promo.toObject();
  }

  private validateCreateData(data: any) {
    switch (data.type) {
      case PromoCodeType.BONUS_TOKENS:
        if (!data.bonusTokens || data.bonusTokens <= 0) {
          throw new BadRequestException(
            'bonusTokens должен быть > 0 для type=BONUS_TOKENS',
          );
        }
        break;
      case PromoCodeType.DISCOUNT_PERCENT:
        if (
          !data.discountPercent ||
          data.discountPercent <= 0 ||
          data.discountPercent > 100
        ) {
          throw new BadRequestException(
            'discountPercent должен быть в диапазоне 1-100',
          );
        }
        break;
      case PromoCodeType.DISCOUNT_RUB:
        if (!data.discountRub || data.discountRub <= 0) {
          throw new BadRequestException(
            'discountRub должен быть > 0 для type=DISCOUNT_RUB',
          );
        }
        break;
      case PromoCodeType.SUBSCRIPTION_DAYS:
        if (!data.subscriptionDays || data.subscriptionDays <= 0) {
          throw new BadRequestException(
            'subscriptionDays должен быть > 0 для type=SUBSCRIPTION_DAYS',
          );
        }
        if (!data.subscriptionPlan) {
          throw new BadRequestException(
            'subscriptionPlan обязателен для type=SUBSCRIPTION_DAYS',
          );
        }
        break;
      default:
        throw new BadRequestException(`Неизвестный type: ${data.type}`);
    }
  }

  async findAll(filter?: {
    isActive?: boolean;
    type?: PromoCodeType;
    search?: string;
  }) {
    const q: any = {};
    if (filter?.isActive !== undefined) q.isActive = filter.isActive;
    if (filter?.type) q.type = filter.type;
    if (filter?.search) {
      const rx = new RegExp(filter.search.trim(), 'i');
      q.$or = [{ code: rx }, { description: rx }];
    }

    return this.promoCodeModel
      .find(q)
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async findByCode(code: string) {
    const promo = await this.promoCodeModel
      .findOne({ code: code.trim().toUpperCase() })
      .lean()
      .exec();
    if (!promo) throw new NotFoundException(`Промокод ${code} не найден`);
    return promo;
  }

  async findById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid promo id');
    }
    const promo = await this.promoCodeModel.findById(id).lean().exec();
    if (!promo) throw new NotFoundException('Промокод не найден');
    return promo;
  }

  async update(id: string, updates: Partial<PromoCode>) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid promo id');
    }

    // code менять нельзя
    delete (updates as any).code;
    // usages/currentUses/статистику менять нельзя
    delete (updates as any).usages;
    delete (updates as any).currentUses;
    delete (updates as any).totalDiscountGivenRub;
    delete (updates as any).totalBonusTokensGiven;
    delete (updates as any).totalSubscriptionDaysGiven;

    const updated = await this.promoCodeModel
      .findByIdAndUpdate(id, { $set: updates }, { new: true })
      .lean()
      .exec();

    if (!updated) throw new NotFoundException('Промокод не найден');
    this.logger.log(`🎟 Promo ${updated.code} updated`);
    return updated;
  }

  async deactivate(code: string) {
    const normalized = code.trim().toUpperCase();
    const updated = await this.promoCodeModel
      .findOneAndUpdate({ code: normalized }, { isActive: false }, { new: true })
      .lean()
      .exec();
    if (!updated) throw new NotFoundException(`Промокод ${code} не найден`);
    this.logger.log(`🎟 Promo ${normalized} deactivated`);
    return updated;
  }

  async activate(code: string) {
    const normalized = code.trim().toUpperCase();
    const updated = await this.promoCodeModel
      .findOneAndUpdate({ code: normalized }, { isActive: true }, { new: true })
      .lean()
      .exec();
    if (!updated) throw new NotFoundException(`Промокод ${code} не найден`);
    this.logger.log(`🎟 Promo ${normalized} activated`);
    return updated;
  }

  async remove(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid promo id');
    }
    const removed = await this.promoCodeModel.findByIdAndDelete(id).lean();
    if (!removed) throw new NotFoundException('Промокод не найден');
    this.logger.warn(`🎟 Promo ${removed.code} DELETED`);
    return { deleted: true, code: removed.code };
  }

  /**
   * Статистика по промокоду — список использований с данными пользователей.
   */
  async getUsageStats(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid promo id');
    }

    const promo = await this.promoCodeModel
      .findById(id)
      .populate({
        path: 'usages.userId',
        select: '_id firstName lastName username telegramId email photoUrl',
      })
      .lean()
      .exec();

    if (!promo) throw new NotFoundException('Промокод не найден');

    return {
      code: promo.code,
      type: promo.type,
      currentUses: promo.currentUses,
      maxUses: promo.maxUses,
      totalDiscountGivenRub: promo.totalDiscountGivenRub,
      totalBonusTokensGiven: promo.totalBonusTokensGiven,
      totalSubscriptionDaysGiven: promo.totalSubscriptionDaysGiven,
      usages: promo.usages,
    };
  }
}