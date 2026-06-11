// src/modules/auth/bot-auth.service.ts
import { Injectable, Logger, BadRequestException, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import Redis from 'ioredis';

export type BotAuthStatus = 'pending' | 'confirmed' | 'expired';

interface BotAuthSession {
  code: string;
  status: BotAuthStatus;
  userId?: string;
  referralCode?: string;
  createdAt: number;
}

const TTL_SECONDS = 300; // 5 минут на подтверждение
const KEY = (code: string) => `botauth:${code}`;

@Injectable()
export class BotAuthService implements OnModuleDestroy {
  private readonly logger = new Logger(BotAuthService.name);
  private redis: Redis;

  constructor(private config: ConfigService) {
    this.redis = new Redis({
      host: this.config.get<string>('REDIS_HOST') || 'localhost',
      port: Number(this.config.get('REDIS_PORT')) || 6379,
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });

    this.redis.on('error', (err) => {
      this.logger.error(`Redis error: ${err.message}`);
    });
  }

  onModuleDestroy() {
    this.redis?.disconnect();
  }

  /** Шаг 1: сайт создаёт сессию */
  async createSession(referralCode?: string): Promise<{
    code: string;
    deepLink: string;
    ttl: number;
  }> {
    const code = randomBytes(16).toString('hex'); // 32 hex символа
    const session: BotAuthSession = {
      code,
      status: 'pending',
      referralCode: referralCode ? referralCode.toUpperCase() : undefined,
      createdAt: Date.now(),
    };

    await this.redis.set(KEY(code), JSON.stringify(session), 'EX', TTL_SECONDS);

    const botUsername =
      this.config.get<string>('TELEGRAM_BOT_USERNAME') ||
      this.config.get<string>('TG_BOT_USERNAME') ||
      this.config.get<string>('BOT_USERNAME') ||
      process.env.TELEGRAM_BOT_USERNAME ||
      process.env.TG_BOT_USERNAME ||
      process.env.BOT_USERNAME;

    if (!botUsername) {
      this.logger.error('Bot username not configured (TELEGRAM_BOT_USERNAME)');
      throw new BadRequestException('Bot username not configured');
    }

    const clean = botUsername.replace(/^@/, '');

    return {
      code,
      deepLink: `https://t.me/${clean}?start=auth_${code}`,
      ttl: TTL_SECONDS,
    };
  }

  /** Шаг 2: бот подтверждает сессию после /start auth_<code> */
  async confirmSession(code: string, userId: string): Promise<boolean> {
    const raw = await this.redis.get(KEY(code));
    if (!raw) {
      this.logger.warn(`confirmSession: code not found/expired: ${code}`);
      return false;
    }

    const session: BotAuthSession = JSON.parse(raw);
    if (session.status !== 'pending') {
      this.logger.warn(`confirmSession: already ${session.status}: ${code}`);
      return false;
    }

    session.status = 'confirmed';
    session.userId = userId;

    // короткий TTL — сайт должен успеть забрать
    await this.redis.set(KEY(code), JSON.stringify(session), 'EX', 60);
    return true;
  }

  /** Шаг 3: сайт поллит. При confirmed — отдаём userId и удаляем сессию (одноразовость) */
  async pollSession(code: string): Promise<{
    status: BotAuthStatus;
    userId?: string;
    referralCode?: string;
  }> {
    const raw = await this.redis.get(KEY(code));
    if (!raw) {
      return { status: 'expired' };
    }

    const session: BotAuthSession = JSON.parse(raw);

    if (session.status === 'confirmed') {
      await this.redis.del(KEY(code)); // одноразовое использование
      return {
        status: 'confirmed',
        userId: session.userId,
        referralCode: session.referralCode,
      };
    }

    return { status: session.status };
  }
}