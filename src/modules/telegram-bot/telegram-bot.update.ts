import { Update, Start, Help, Command, Ctx } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { Context, Markup } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { ReferralService } from '../referral/referral.service';
import { TelegramUser } from '@/common/interfaces';

@Update()
export class TelegramBotUpdate {
  private readonly logger = new Logger(TelegramBotUpdate.name);

  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    private readonly referralService: ReferralService,
  ) {}

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

    // Реферальный код из payload "ref_XXXXXXXX"
    let referralCode: string | undefined;
    if (payload.startsWith('ref_')) {
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
      photo_url: undefined, // у /start не приходит, фронт обновит
    } as TelegramUser;

    // Создаём/обновляем юзера. Если код есть и юзер новый — UsersService сам:
    //  - привяжет referredBy
    //  - начислит инвайтеру +10 bonusTokens
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

    // Если юзер новый и реферал привязался — пишем запись в Referral
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
      Markup.button.url('💬 Поддержка', 'https://t.me/spichki_support'),
    ]);

    await ctx.reply(greeting, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  }

  @Help()
  async onHelp(@Ctx() ctx: Context) {
    await ctx.reply(
      '*SPICHKI AI* — все нейросети в Telegram\n\n' +
        '/start — открыть приложение\n' +
        '/balance — баланс спичек\n' +
        '/ref — реферальная ссылка\n' +
        '/help — справка',
      { parse_mode: 'Markdown' },
    );
  }

  @Command('balance')
  async onBalance(@Ctx() ctx: Context) {
    const from = ctx.from;
    if (!from) return;
    try {
      const user = await this.usersService.findByTelegramId(from.id);
      await ctx.reply(
        `💰 *Твой баланс*\n\n` +
          `🪙 Куплено: *${user.tokenBalance ?? 0}* 🔥\n` +
          `🎁 Бонусных: *${user.bonusTokens ?? 0}* 🔥\n` +
          `💸 Кэшбек: *${user.cashbackBalance ?? 0}* 🔥`,
        { parse_mode: 'Markdown' },
      );
    } catch {
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
      await ctx.reply(
        `🤝 *Твоя реферальная программа*\n\n` +
          `🔗 Ссылка:\n\`${info.referralLink}\`\n\n` +
          `👥 Приглашено: *${info.referralCount}*\n` +
          `💸 Заработано: *${info.totalEarned}* 🔥\n\n` +
          `Делись ссылкой — получай +10 🔥 за каждого друга и 10% кэшбека с их покупок!`,
        { parse_mode: 'Markdown' },
      );
    } catch {
      await ctx.reply('Сначала нажми /start');
    }
  }
}