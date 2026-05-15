import { Module, forwardRef } from '@nestjs/common';
import { TelegrafModule } from 'nestjs-telegraf';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegramBotUpdate } from './telegram-bot.update';
import { UsersModule } from '../users/users.module';
import { ReferralModule } from '../referral/referral.module';

@Module({
  imports: [
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const token =
          config.get<string>('TELEGRAM_BOT_TOKEN') ||
          process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
          throw new Error('TELEGRAM_BOT_TOKEN is not set in .env');
        }
        return { token };
      },
    }),
    forwardRef(() => UsersModule),
    forwardRef(() => ReferralModule),
  ],
  providers: [TelegramBotUpdate],
})
export class TelegramBotModule {}