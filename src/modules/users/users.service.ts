// src/modules/users/users.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { TelegramUser, AuthProvider } from '@/common/interfaces';
import { v4 as uuidv4 } from 'uuid';

// ─── 🆕 Глобальные константы точности баланса ─────────────────────
// Должны совпадать с константами в BillingService.
const TOKEN_PRECISION = 2;          // 2 знака после запятой
const FLOAT_EPSILON = 1e-9;         // допуск для float-сравнений
const MAX_DEDUCT_RETRIES = 3;       // 🆕 попыток при race condition

/** Округляет число до TOKEN_PRECISION знаков. */
function roundTokens(value: number): number {
  const factor = Math.pow(10, TOKEN_PRECISION);
  return Math.round(value * factor) / factor;
}

/**
 * Приводит почту к единому виду: Ivan@Mail.RU и ivan@mail.ru — один и тот
 * же ящик, и без нормализации на них завелись бы два аккаунта с разными
 * балансами. Сравнение и запись всегда идут через эту функцию.
 */
export function normalizeEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) { }

  // ═══════════════════════════════════════════════════════════════
  // Регистрация / поиск
  // ═══════════════════════════════════════════════════════════════

  /**
   * Найти или создать пользователя по Telegram ID.
   * При создании с реферальным кодом:
   *  - приглашённый получает 9 🔥 в bonusTokens (стартовый бонус всем новым)
   *  - пригласивший НЕ получает спичек за регистрацию — только кэшбек
   *    с последующих покупок приглашённого (markReferralPurchase)
   *  - запись в Referral создаёт ReferralService (вызывается из AuthService).
   */
  async findOrCreateByTelegram(
    telegramUser: TelegramUser,
    referralCode?: string,
  ): Promise<UserDocument> {
    const existing = await this.userModel.findOne({
      telegramId: telegramUser.id,
    });

    if (existing) {
      // 🆕 Атомарный апдейт last-info без save()-race
      const updated = await this.userModel.findByIdAndUpdate(
        existing._id,
        {
          $set: {
            firstName: telegramUser.first_name,
            lastName: telegramUser.last_name || '',
            username: telegramUser.username || '',
            photoUrl: telegramUser.photo_url || '',
            isPremiumTelegram: telegramUser.is_premium || false,
            lastActiveAt: new Date(),
          },
        },
        { new: true },
      );
      return updated!;
    }

    // ─── Новый юзер ────────────────────────────────────────────
    const user = new this.userModel({
      authProvider: AuthProvider.TELEGRAM,
      telegramId: telegramUser.id,
      firstName: telegramUser.first_name,
      lastName: telegramUser.last_name || '',
      username: telegramUser.username || '',
      photoUrl: telegramUser.photo_url || '',
      languageCode: telegramUser.language_code || 'en',
      isPremiumTelegram: telegramUser.is_premium || false,
      referralCode: this.generateReferralCode(),
      tokenBalance: 0,
      bonusTokens: 9,
      lastActiveAt: new Date(),
    });

    // Обработка реферального кода
    if (referralCode) {
      const referrer = await this.userModel.findOne({
        referralCode: referralCode.toUpperCase(),
      });

      // Защита от self-referral
      if (referrer && referrer.telegramId !== telegramUser.id) {
        user.referredBy = referrer._id;
      }
    }

    await user.save();

    // Считаем приглашённого, но спички за регистрацию НЕ начисляем:
    // реферер зарабатывает только кэшбеком с покупок (см. referral.service).
    if (user.referredBy) {
      await this.userModel.findByIdAndUpdate(user.referredBy, {
        $inc: { referralCount: 1 },
      });
    }

    return user;
  }

  async findById(id: string): Promise<UserDocument> {
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByTelegramId(telegramId: number): Promise<UserDocument> {
    const user = await this.userModel.findOne({ telegramId });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: normalizeEmail(email) }).select('+passwordHash');
  }

  async findByGoogleId(googleId: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ googleId });
  }

  // ═══════════════════════════════════════════════════════════════
  // 🆕 РЕГИСТРАЦИЯ НЕ ЧЕРЕЗ TELEGRAM (почта, Google)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Привязывает реферала к новому пользователю. Вынесено из
   * findOrCreateByTelegram, чтобы почта и Google вели себя ровно так же —
   * иначе способ входа незаметно менял бы условия реферальной программы.
   * Спички за саму регистрацию не начисляются: реферер получает только
   * кэшбек с покупок приглашённого.
   *
   * Возвращает документ уже сохранённым.
   */
  private async applyReferral(
    user: UserDocument,
    referralCode?: string,
  ): Promise<UserDocument> {
    if (referralCode) {
      const referrer = await this.userModel.findOne({
        referralCode: referralCode.toUpperCase(),
      });

      // Защита от self-referral: у нового юзера ещё нет _id до save(),
      // поэтому сравниваем по already-known полям.
      if (referrer && referrer._id.toString() !== user._id?.toString()) {
        user.referredBy = referrer._id;
      }
    }

    await user.save();

    // Спички за регистрацию не начисляем — только счётчик приглашённых.
    if (user.referredBy) {
      await this.userModel.findByIdAndUpdate(user.referredBy, {
        $inc: { referralCount: 1 },
      });
    }

    return user;
  }

  /**
   * Создаёт пользователя с почтой и паролем.
   *
   * Уникальность email обеспечена partial-unique индексом в схеме; при
   * гонке двух одновременных регистраций Mongo вернёт E11000, и мы
   * превращаем его в понятную ошибку вместо 500.
   */
  async createWithEmail(params: {
    email: string;
    passwordHash: string;
    firstName?: string;
    referralCode?: string;
  }): Promise<UserDocument> {
    const email = normalizeEmail(params.email);

    const user = new this.userModel({
      authProvider: AuthProvider.EMAIL,
      email,
      passwordHash: params.passwordHash,
      isEmailVerified: false,
      firstName: params.firstName || '',
      username: email.split('@')[0],
      referralCode: this.generateReferralCode(),
      tokenBalance: 0,
      bonusTokens: 9,
      lastActiveAt: new Date(),
    });

    try {
      return await this.applyReferral(user, params.referralCode);
    } catch (e: any) {
      if (e?.code === 11000) {
        throw new BadRequestException('Аккаунт с такой почтой уже существует');
      }
      throw e;
    }
  }

  /**
   * Вход/регистрация через Google.
   *
   * Порядок поиска важен:
   *  1. по googleId — этот аккаунт уже связывали;
   *  2. по подтверждённой почте — тот же человек заходил другим способом
   *     (в том числе через Telegram), привязываем googleId к нему, чтобы
   *     не разводить два баланса;
   *  3. иначе — новый пользователь.
   *
   * Шаг 2 выполняем ТОЛЬКО для verified-адреса от Google: непроверенную
   * почту можно вписать в чужой профиль и увести аккаунт.
   */
  async findOrCreateByGoogle(profile: {
    googleId: string;
    email: string;
    emailVerified: boolean;
    firstName?: string;
    lastName?: string;
    photoUrl?: string;
  }, referralCode?: string): Promise<{ user: UserDocument; isNew: boolean }> {
    const email = normalizeEmail(profile.email);

    const byGoogle = await this.userModel.findOne({ googleId: profile.googleId });
    if (byGoogle) {
      await this.userModel.updateOne(
        { _id: byGoogle._id },
        { $set: { lastActiveAt: new Date() } },
      );
      return { user: byGoogle, isNew: false };
    }

    if (profile.emailVerified && email) {
      const byEmail = await this.userModel.findOne({ email });
      if (byEmail) {
        // Связываем аккаунты: один человек — один баланс.
        byEmail.googleId = profile.googleId;
        byEmail.isEmailVerified = true;
        if (!byEmail.photoUrl && profile.photoUrl) byEmail.photoUrl = profile.photoUrl;
        if (!byEmail.firstName && profile.firstName) byEmail.firstName = profile.firstName;
        byEmail.lastActiveAt = new Date();
        await byEmail.save();
        return { user: byEmail, isNew: false };
      }
    }

    const user = new this.userModel({
      authProvider: AuthProvider.GOOGLE,
      googleId: profile.googleId,
      email: email || null,
      isEmailVerified: !!profile.emailVerified,
      firstName: profile.firstName || '',
      lastName: profile.lastName || '',
      username: email ? email.split('@')[0] : '',
      photoUrl: profile.photoUrl || '',
      referralCode: this.generateReferralCode(),
      tokenBalance: 0,
      bonusTokens: 9,
      lastActiveAt: new Date(),
    });

    try {
      const saved = await this.applyReferral(user, referralCode);
      return { user: saved, isNew: true };
    } catch (e: any) {
      if (e?.code === 11000) {
        // Гонка: пока мы создавали, аккаунт уже завели. Берём существующий.
        const existing = await this.userModel.findOne({
          $or: [{ googleId: profile.googleId }, ...(email ? [{ email }] : [])],
        });
        if (existing) return { user: existing, isNew: false };
      }
      throw e;
    }
  }

  /** Установка/смена пароля. Хеш готовит AuthService. */
  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.userModel.updateOne(
      { _id: userId },
      { $set: { passwordHash } },
    );
  }

  async setLastActive(userId: string): Promise<void> {
    await this.userModel.updateOne(
      { _id: userId },
      { $set: { lastActiveAt: new Date() } },
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔥 АТОМАРНОЕ СПИСАНИЕ СПИЧЕК
  // ═══════════════════════════════════════════════════════════════
  //
  // Приоритет (от дешёвых к дорогим для юзера):
  //   1) bonusTokens (промо, не выводятся)
  //   2) cashbackBalance (можно вывести деньгами, но и тратить можно)
  //   3) tokenBalance (купленные)
  //
  // 🆕 Списание атомарно: findOneAndUpdate с условием по текущим балансам.
  // Если условие не сработало (параллельная операция) — retry до MAX_DEDUCT_RETRIES.
  // ═══════════════════════════════════════════════════════════════

  async deductTokens(
    userId: string,
    amount: number,
    _type: string,
  ): Promise<UserDocument> {
    const chargeAmount = roundTokens(amount);

    if (chargeAmount <= 0) {
      return this.findById(userId);
    }

    for (let attempt = 1; attempt <= MAX_DEDUCT_RETRIES; attempt++) {
      const user = await this.findById(userId);

      const totalAvailable = roundTokens(
        user.tokenBalance + user.bonusTokens + user.cashbackBalance,
      );

      if (totalAvailable + FLOAT_EPSILON < chargeAmount) {
        throw new BadRequestException(
          `Insufficient tokens. Required: ${chargeAmount}, Available: ${totalAvailable}`,
        );
      }

      // Распределяем списание по приоритету
      let remaining = chargeAmount;

      const fromBonus = Math.min(user.bonusTokens, remaining);
      remaining = roundTokens(remaining - fromBonus);

      const fromCashback = Math.min(user.cashbackBalance, remaining);
      remaining = roundTokens(remaining - fromCashback);

      const fromTokens = remaining;

      // 🆕 Атомарный $inc с проверкой что балансы не изменились
      const updated = await this.userModel.findOneAndUpdate(
        {
          _id: userId,
          bonusTokens: user.bonusTokens,
          cashbackBalance: user.cashbackBalance,
          tokenBalance: user.tokenBalance,
        },
        {
          $inc: {
            bonusTokens: -fromBonus,
            cashbackBalance: -fromCashback,
            tokenBalance: -fromTokens,
            totalTokensSpent: chargeAmount,
          },
        },
        { new: true },
      );

      if (updated) {
        return this.normalizeBalances(updated);
      }

      this.logger.warn(
        `deductTokens: retry ${attempt}/${MAX_DEDUCT_RETRIES} for user ${userId} (concurrent update)`,
      );
    }

    throw new BadRequestException(
      'Не удалось списать токены: слишком много параллельных операций. Повторите попытку.',
    );
  }

  /**
   * 🆕 Нормализует все балансы пользователя:
   *  - округляет до TOKEN_PRECISION
   *  - защищает от отрицательных значений из-за float-погрешности
   */
  private async normalizeBalances(user: UserDocument): Promise<UserDocument> {
    const fields = [
      'tokenBalance',
      'bonusTokens',
      'cashbackBalance',
      'totalTokensSpent',
      'totalDeposited',
      'cashbackEarnedTotal',
      'referralEarnings',
    ];

    const fixes: Record<string, number> = {};
    let needsUpdate = false;

    for (const f of fields) {
      const v = (user as any)[f];
      if (typeof v !== 'number') continue;

      let safe = roundTokens(v);
      // Зачищаем микро-отрицательность от float-погрешности
      if (safe < 0 && safe > -FLOAT_EPSILON) safe = 0;
      // Защита от настоящего отрицательного значения
      if (safe < 0) {
        this.logger.error(
          `normalizeBalances: negative ${f}=${v} for user ${user._id}, clamping to 0`,
        );
        safe = 0;
      }

      if (v !== safe) {
        fixes[f] = safe;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      const fixed = await this.userModel.findByIdAndUpdate(
        user._id,
        { $set: fixes },
        { new: true },
      );
      return fixed!;
    }

    return user;
  }

  // ═══════════════════════════════════════════════════════════════
  // НАЧИСЛЕНИЯ (атомарно через $inc)
  // ═══════════════════════════════════════════════════════════════

  async addTokens(userId: string, amount: number): Promise<UserDocument> {
    if (amount < 0) {
      throw new BadRequestException(
        `addTokens: amount must be non-negative (got ${amount})`,
      );
    }
    if (amount === 0) return this.findById(userId);

    const rounded = roundTokens(amount);
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      {
        $inc: { tokenBalance: rounded, totalDeposited: rounded },
        $set: { lastActiveAt: new Date() },
      },
      { new: true },
    );
    if (!user) throw new NotFoundException('User not found');
    return this.normalizeBalances(user);
  }

  async addBonusTokens(
    userId: string,
    amount: number,
  ): Promise<UserDocument> {
    if (amount < 0) {
      throw new BadRequestException(
        `addBonusTokens: amount must be non-negative (got ${amount})`,
      );
    }
    if (amount === 0) return this.findById(userId);

    const rounded = roundTokens(amount);
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $inc: { bonusTokens: rounded } },
      { new: true },
    );
    if (!user) throw new NotFoundException('User not found');
    return this.normalizeBalances(user);
  }

  /**
   * Начислить кэшбек.
   * @param userId — получатель
   * @param amount — сумма в спичках
   * @param fromReferral — если true, инкрементим referralEarnings.
   *                      Установи false для не-реферальных кэшбеков (промо, акции).
   */
  async addCashback(
    userId: string,
    amount: number,
    fromReferral = true,
  ): Promise<UserDocument> {
    if (amount < 0) {
      throw new BadRequestException(
        `addCashback: amount must be non-negative (got ${amount})`,
      );
    }
    if (amount === 0) return this.findById(userId);

    const rounded = roundTokens(amount);

    const inc: Record<string, number> = {
      cashbackBalance: rounded,
      cashbackEarnedTotal: rounded,
    };
    if (fromReferral) {
      inc.referralEarnings = rounded;
    }

    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $inc: inc },
      { new: true },
    );
    if (!user) throw new NotFoundException('User not found');
    return this.normalizeBalances(user);
  }

  /**
   * 🆕 АТОМАРНО зарезервировать сумму кэшбека под заявку на вывод.
   * Списывает только если на балансе хватает (условие в фильтре).
   */
  async reserveCashbackForWithdrawal(
    userId: string,
    amount: number,
  ): Promise<UserDocument> {
    if (amount <= 0) {
      throw new BadRequestException(
        `reserveCashbackForWithdrawal: amount must be positive`,
      );
    }

    const rounded = roundTokens(amount);

    // Атомарно: списываем только при достаточном балансе
    const user = await this.userModel.findOneAndUpdate(
      {
        _id: userId,
        cashbackBalance: { $gte: rounded - FLOAT_EPSILON },
      },
      { $inc: { cashbackBalance: -rounded } },
      { new: true },
    );

    if (!user) {
      // Уточняем причину: юзер не найден или баланса не хватает
      const found = await this.userModel.findById(userId);
      if (!found) throw new NotFoundException('User not found');

      throw new BadRequestException(
        `Insufficient cashback balance. Required: ${rounded}, Available: ${found.cashbackBalance}`,
      );
    }

    return this.normalizeBalances(user);
  }

  /**
   * Вернуть зарезервированный кэшбек (если админ отклонил заявку).
   */
  async refundCashback(
    userId: string,
    amount: number,
  ): Promise<UserDocument> {
    if (amount <= 0) return this.findById(userId);

    const rounded = roundTokens(amount);
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $inc: { cashbackBalance: rounded } },
      { new: true },
    );
    if (!user) throw new NotFoundException('User not found');
    return this.normalizeBalances(user);
  }

  /**
   * Возврат купленных спичек (например, при отмене генерации).
   */
  async refundTokens(userId: string, amount: number): Promise<UserDocument> {
    if (amount <= 0) return this.findById(userId);

    const rounded = roundTokens(amount);
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $inc: { tokenBalance: rounded, totalTokensSpent: -rounded } },
      { new: true },
    );
    if (!user) throw new NotFoundException('User not found');
    return this.normalizeBalances(user);
  }

  // ═══════════════════════════════════════════════════════════════
  // НАСТРОЙКИ И ЛИМИТЫ
  // ═══════════════════════════════════════════════════════════════

  async updateSettings(userId: string, settings: any): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $set: { settings } },
      { new: true },
    );
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async checkDailyLimit(userId: string, maxDaily: number): Promise<boolean> {
    const now = new Date();
    const user = await this.findById(userId);

    if (!user.dailyGenerationsResetAt || user.dailyGenerationsResetAt < now) {
      // 🆕 Атомарный сброс через $set
      const tomorrow = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      await this.userModel.findByIdAndUpdate(userId, {
        $set: {
          dailyGenerations: 0,
          dailyGenerationsResetAt: tomorrow,
        },
      });
      return 0 < maxDaily;
    }

    return user.dailyGenerations < maxDaily;
  }

  async incrementDailyGenerations(userId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      $inc: { dailyGenerations: 1 },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // СТАТИСТИКА
  // ═══════════════════════════════════════════════════════════════

  async getLeaderboard(limit = 10) {
    return this.userModel
      .find({ isActive: true })
      .sort({ referralCount: -1 })
      .limit(limit)
      .select('firstName username referralCount referralEarnings');
  }

  async getStats() {
    const [totalUsers, activeToday, premiumUsers] = await Promise.all([
      this.userModel.countDocuments(),
      this.userModel.countDocuments({
        lastActiveAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      }),
      this.userModel.countDocuments({
        subscriptionPlan: { $ne: 'free' },
      }),
    ]);
    return { totalUsers, activeToday, premiumUsers };
  }

  private generateReferralCode(): string {
    return uuidv4().substring(0, 8).toUpperCase();
  }

  /**
   * 🆕 Атомарное обновление полей подписки.
   * Используется BillingService для активации/деактивации/миграции,
   * чтобы не затереть баланс через user.save().
   */
  async updateSubscription(
    userId: string,
    plan: string,
    expiresAt: Date | null,
  ): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $set: { subscriptionPlan: plan, subscriptionExpiresAt: expiresAt } },
      { new: true },
    );
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
     * 🆕 Массовая миграция устаревшего плана подписки на новый.
     * Вызывается BillingService.onApplicationBootstrap для PRO→PLUS, UNLIMITED→ULTIMATE.
     *
     * @returns количество обновлённых пользователей
     */
  async migrateUserPlan(oldPlan: string, newPlan: string): Promise<number> {
    if (oldPlan === newPlan) return 0;

    const result = await this.userModel.updateMany(
      { subscriptionPlan: oldPlan },
      { $set: { subscriptionPlan: newPlan } },
    );

    if (result.modifiedCount > 0) {
      this.logger.warn(
        `🔁 Migrated ${result.modifiedCount} users: ${oldPlan} → ${newPlan}`,
      );
    }

    return result.modifiedCount;
  }


  /**
   * 🆕 Перевод пользователя на бесплатный тариф (после истечения подписки).
   * Сбрасывает subscriptionPlan на FREE и обнуляет subscriptionExpiresAt.
   * Балансы НЕ трогает.
   */
  async downgradeToFree(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      {
        $set: {
          subscriptionPlan: 'free',
          subscriptionExpiresAt: null,
        },
      },
      { new: true },
    );
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}