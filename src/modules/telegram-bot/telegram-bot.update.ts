import { Update, Start, Help, Command, Ctx } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { Context, Markup } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { ReferralService } from '../referral/referral.service';
import { BotAuthService } from '../auth/bot-auth.service';
import { TelegramUser } from '@/common/interfaces';

@Update()
export class TelegramBotUpdate {
  private readonly logger = new Logger(TelegramBotUpdate.name);

  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    private readonly referralService: ReferralService,
    private readonly botAuthService: BotAuthService,
  ) {}

  // ─── Helpers ─────────────────────────────────────────────
  /** Юзернейм поддержки без @ (из .env, fallback на macheezzz) */
  private getSupportUsername(): string {
    const raw =
      this.config.get<string>('SUPPORT_USERNAME') ||
      process.env.SUPPORT_USERNAME ||
      'macheezzz';
    return raw.replace(/^@/, '').trim();
  }

  /** Полный URL поддержки для inline-кнопки */
  private getSupportUrl(): string {
    return `https://t.me/${this.getSupportUsername()}`;
  }

  /** Юзернейм с @ для подстановки в текст */
  private getSupportHandle(): string {
    return `@${this.getSupportUsername()}`;
  }

  @Start()
  async onStart(@Ctx() ctx: Context) {
    const from = ctx.from;
    if (!from) return;

    // @ts-ignore — у telegraf message это union тип
    const text: string = ctx.message?.text || '';
    const payload = text.split(' ').slice(1).join(' ').trim(); // всё после /start

    this.logger.log(
      `📩 /start tg=${from.id} (@${from.username || '—'}) payload="${payload}"`,
    );

    // Разбираем тип payload
    let authCode: string | undefined;
    let referralCode: string | undefined;

    if (payload.startsWith('auth_')) {
      authCode = payload.replace(/^auth_/, '').trim();
    } else if (payload.startsWith('ref_')) {
      referralCode = payload.replace(/^ref_/, '').trim().toUpperCase();
    }

    // Маппинг TG → TelegramUser
    const tgUser: TelegramUser = {
      id: from.id,
      first_name: from.first_name,
      last_name: from.last_name,
      username: from.username,
      language_code: from.language_code,
      is_premium: (from as any).is_premium,
      photo_url: undefined,
    } as TelegramUser;

    let user;
    let wasNew = false;
    try {
      const existingBefore = await this.usersService
        .findByTelegramId(from.id)
        .catch(() => null);
      wasNew = !existingBefore;

      user = await this.usersService.findOrCreateByTelegram(tgUser, referralCode);
    } catch (e: any) {
      this.logger.error(`findOrCreateByTelegram failed: ${e?.message}`);
      await ctx.reply('Ой, что-то пошло не так. Попробуй ещё раз через минуту.');
      return;
    }

    // Bot Auth: подтверждаем сессию входа на сайте
    if (authCode) {
      let ok = false;
      try {
        ok = await this.botAuthService.confirmSession(
          authCode,
          user._id.toString(),
        );
      } catch (e: any) {
        this.logger.warn(`confirmSession failed: ${e?.message}`);
      }

      await ctx.reply(
        ok
          ? '✅ Вход на сайте подтверждён!\n\nМожешь вернуться в браузер — там уже всё готово.'
          : '⚠️ Ссылка для входа устарела или уже использована.\n\nПопробуй войти заново на сайте.',
        { parse_mode: 'Markdown' },
      );
      return; // не показываем стандартное приветствие
    }

    // Реферал: запись для новых юзеров
    if (wasNew && referralCode && user.referredBy) {
      try {
        await this.referralService.recordReferral(
          user.referredBy.toString(),
          user._id.toString(),
        );
      } catch (e: any) {
        this.logger.warn(`recordReferral failed: ${e?.message}`);
      }
    }

    // Mini App URL
    const miniAppUrl =
      this.config.get<string>('MINI_APP_URL') ||
      this.config.get<string>('FRONTEND_URL') ||
      process.env.MINI_APP_URL ||
      process.env.FRONTEND_URL ||
      '';

    const greeting = wasNew
      ? `👋 Привет, ${from.first_name || 'друг'}!\n\n` +
        `🔥 *SPICHKI AI* — все нейросети в одном месте.\n\n` +
        `🎁 Тебе начислено *9 спичек* на старт${
          referralCode && user.referredBy ? ' + бонус за приглашение' : ''
        }!\n\n` +
        `Жми кнопку ниже, чтобы начать 👇`
      : `👋 С возвращением, ${from.first_name || 'друг'}!\n\n` +
        `🔥 Все нейросети ждут тебя. Жми кнопку 👇`;

    const buttons: any[] = [];
    if (miniAppUrl) {
      buttons.push([Markup.button.webApp('🚀 Открыть SPICHKI AI', miniAppUrl)]);
    }
    buttons.push([
      Markup.button.url('💬 Поддержка', this.getSupportUrl()), // 🆕 из .env
    ]);

    await ctx.reply(greeting, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  }

  @Help()
  async onHelp(@Ctx() ctx: Context) {
    const support = this.getSupportHandle(); // 🆕

    await ctx.reply(
      '*SPICHKI AI* — все нейросети в Telegram\n\n' +
        '/start — открыть приложение\n' +
        '/balance — баланс спичек\n' +
        '/ref — реферальная ссылка\n' +
        '/help — справка\n\n' +
        `💬 Поддержка: ${support}`,
      { parse_mode: 'Markdown' },
    );
  }

  @Command('balance')
  async onBalance(@Ctx() ctx: Context) {
    const from = ctx.from;
    if (!from) return;
    try {
      const user = await this.usersService.findByTelegramId(from.id);

      // 1 спичка кэшбека = 3 ₽
      const cashback = user.cashbackBalance ?? 0;
      const cashbackRub = Math.round(cashback * 3 * 100) / 100;

      await ctx.reply(
        `💰 *Твой баланс*\n\n` +
          `🪙 Куплено: *${user.tokenBalance ?? 0}* 🔥\n` +
          `🎁 Бонусных: *${user.bonusTokens ?? 0}* 🔥\n` +
          `💸 Кэшбек: *${cashback}* 🔥 (≈ ${cashbackRub} ₽)`,
        { parse_mode: 'Markdown' },
      );
    } catch (e: any) {
      this.logger.warn(`/balance failed for tg=${from.id}: ${e?.message}`);
      await ctx.reply('Сначала нажми /start');
    }
  }

  @Command('ref')
  async onRef(@Ctx() ctx: Context) {
    const from = ctx.from;
    if (!from) return;
    try {
      const user = await this.usersService.findByTelegramId(from.id);
      const info = await this.referralService.getReferralInfo(
        user._id.toString(),
      );

      // Кэшбек в рублях из бэка (rubPerToken = 3)
      const earnedRub =
        (info as any).cashbackEarnedTotalRub ??
        Math.round((info.totalEarned || 0) * 3 * 100) / 100;
      const availableRub =
        (info as any).cashbackBalanceRub ??
        Math.round((info.cashbackBalance || 0) * 3 * 100) / 100;

      const support = this.getSupportHandle(); // 🆕

      await ctx.reply(
        `🤝 *Твоя реферальная программа*\n\n` +
          `🔗 Ссылка:\n\`${info.referralLink}\`\n\n` +
          `👥 Приглашено: *${info.referralCount}*\n` +
          `💎 С покупками: *${info.activeReferrals}*\n` +
          `💸 Заработано: *${info.totalEarned}* 🔥 (≈ ${earnedRub} ₽)\n` +
          `💰 Доступно к выводу: *${info.cashbackBalance}* 🔥 (≈ ${availableRub} ₽)\n\n` +
          `Делись ссылкой — получай +10 🔥 за каждого друга и 10% кэшбека с их покупок!\n\n` +
          `💡 Вывод средств — через нашу поддержку: ${support}`,
        { parse_mode: 'Markdown' },
      );
    } catch (e: any) {
      this.logger.warn(`/ref failed for tg=${from.id}: ${e?.message}`);
      await ctx.reply('Сначала нажми /start');
    }
  }
}