// src/modules/auth/password-reset.service.ts
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'crypto';
import Redis from 'ioredis';

const TTL_SECONDS = 30 * 60; // 30 минут на смену пароля
const KEY = (hash: string) => `pwdreset:${hash}`;

/**
 * Одноразовые токены восстановления пароля.
 *
 * Живут в Redis, а не в Mongo: у них короткий срок жизни и не нужна
 * история — TTL сам подчищает просроченные. Схема повторяет bot-auth.
 *
 * В Redis кладётся не сам токен, а его SHA-256: дамп базы тогда не даёт
 * возможности сменить кому-то пароль. Пользователю уходит оригинал.
 */
@Injectable()
export class PasswordResetService implements OnModuleDestroy {
  private readonly logger = new Logger(PasswordResetService.name);
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

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Создаёт токен и возвращает его открытую часть — она уходит в письмо. */
  async issue(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.redis.set(KEY(this.hash(token)), userId, 'EX', TTL_SECONDS);
    return token;
  }

  /**
   * Погашает токен и возвращает userId.
   *
   * GETDEL атомарен: одновременные запросы с одним токеном не смогут
   * сменить пароль дважды.
   */
  async consume(token: string): Promise<string | null> {
    if (!token) return null;
    try {
      const key = KEY(this.hash(token));
      const userId = await this.redis.getdel(key);
      return userId || null;
    } catch (e: any) {
      this.logger.error(`Не удалось погасить токен: ${e.message}`);
      return null;
    }
  }
}
