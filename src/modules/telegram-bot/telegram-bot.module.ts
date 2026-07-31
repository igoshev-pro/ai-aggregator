import { Module, forwardRef } from '@nestjs/common';
import { TelegrafModule } from 'nestjs-telegraf';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TelegramBotUpdate } from './telegram-bot.update';
import { UsersModule } from '../users/users.module';
import { ReferralModule } from '../referral/referral.module';
import { AuthModule } from '../auth/auth.module';
import { AIModel, AIModelSchema } from '../ai-providers/schemas/model.schema';

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
    // 🆕 Доступ к каталогу моделей напрямую из MongoDB (read-only для бота)
    MongooseModule.forFeature([{ name: AIModel.name, schema: AIModelSchema }]),
    forwardRef(() => UsersModule),
    forwardRef(() => ReferralModule),
    forwardRef(() => AuthModule),
  ],
  providers: [TelegramBotUpdate],
})
export class TelegramBotModule {}