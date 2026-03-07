// src/common/guards/telegram-auth.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class TelegramAuthGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const initData = request.headers['x-telegram-init-data'];

    if (!initData) {
      throw new UnauthorizedException('Telegram init data is required');
    }

    const isValid = this.validateTelegramData(initData);
    if (!isValid) {
      throw new UnauthorizedException('Invalid Telegram init data');
    }

    // Parse user from init data
    const params = new URLSearchParams(initData);
    const userStr = params.get('user');
    if (userStr) {
      request.telegramUser = JSON.parse(decodeURIComponent(userStr));
    }

    return true;
  }

  private validateTelegramData(initData: string): boolean {
    const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      throw new UnauthorizedException('Bot token not configured');
    }

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;

    params.delete('hash');

    // Sort params
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    // Проверяем hash и время (не старше 1 часа)
    if (calculatedHash !== hash) return false;

    const authDate = parseInt(params.get('auth_date') || '0', 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 3600) return false;

    return true;
  }
}