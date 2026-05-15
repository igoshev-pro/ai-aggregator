import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { TochkaAcquiringWebhookPayload } from './tochka.types';

/**
 * Верификация JWT-вебхуков от Точки.
 *
 * Точка присылает вебхук как Content-Type: text/plain,
 * тело = JWT-строка, подписанная их приватным RSA-ключом (RS256).
 * Мы проверяем подпись их публичным ключом и распарсиваем payload.
 *
 * Режимы работы:
 *  - TOCHKA_VERIFY_SIGNATURE !== 'false' (по умолчанию) → полная проверка RS256-подписи.
 *  - TOCHKA_VERIFY_SIGNATURE === 'false' → подпись НЕ проверяется,
 *    JWT только декодируется. Это режим разработки / временный режим,
 *    пока поддержка Точки не выдала публичный ключ.
 *    В проде ОБЯЗАТЕЛЬНО должен быть TOCHKA_VERIFY_SIGNATURE=true и валидный ключ.
 */
@Injectable()
export class TochkaWebhookVerifier {
  private readonly logger = new Logger(TochkaWebhookVerifier.name);
  private readonly publicKey: string;
  private readonly verifySignature: boolean;

  constructor(private readonly configService: ConfigService) {
    const raw = this.configService.get<string>('TOCHKA_PUBLIC_KEY') || '';
    // В .env переносы строк обычно экранированы как \n — раскодируем
    this.publicKey = raw.replace(/\\n/g, '\n').trim();

    // По умолчанию проверка включена. Выключается только явным 'false'.
    const flag = (
      this.configService.get<string>('TOCHKA_VERIFY_SIGNATURE') ?? 'true'
    )
      .toString()
      .toLowerCase()
      .trim();
    this.verifySignature = flag !== 'false';

    // Логируем стартовое состояние, чтобы было видно в логах при поднятии приложения
    if (!this.verifySignature) {
      this.logger.warn(
        '⚠️  TOCHKA_VERIFY_SIGNATURE=false — webhook signature is NOT verified! ' +
          'OK for development, but MUST be "true" in production.',
      );
    } else if (!this.publicKey) {
      this.logger.error(
        '⚠️  TOCHKA_PUBLIC_KEY is empty AND verification is ON — webhooks WILL FAIL. ' +
          'Either set TOCHKA_PUBLIC_KEY or temporarily set TOCHKA_VERIFY_SIGNATURE=false.',
      );
    } else {
      this.logger.log('[Tochka] webhook signature verification: ENABLED (RS256)');
    }
  }

  /**
   * Проверяет подпись (если включена) и возвращает распарсенный payload.
   * Бросает UnauthorizedException при невалидной подписи или пустом теле.
   */
  verify(rawJwt: string): TochkaAcquiringWebhookPayload {
    if (!rawJwt || typeof rawJwt !== 'string') {
      throw new UnauthorizedException('Empty webhook body');
    }

    const token = rawJwt.trim();

    // Минимальная sanity-проверка: JWT должен иметь 3 части через точку
    if (token.split('.').length !== 3) {
      throw new UnauthorizedException('Malformed JWT token');
    }

    // ─── Режим без проверки подписи (только декодирование) ──────────
    if (!this.verifySignature) {
      try {
        const decoded = jwt.decode(token);
        if (!decoded || typeof decoded === 'string') {
          throw new UnauthorizedException('Invalid JWT payload format');
        }
        this.logger.debug('[Tochka] signature verification SKIPPED (dev mode)');
        return decoded as unknown as TochkaAcquiringWebhookPayload;
      } catch (err: any) {
        this.logger.warn(`[Tochka] JWT decode failed: ${err.message}`);
        throw new UnauthorizedException(`JWT decode failed: ${err.message}`);
      }
    }

    // ─── Боевой режим — полная проверка RS256-подписи ───────────────
    if (!this.publicKey) {
      throw new UnauthorizedException('Tochka public key not configured');
    }

    try {
      const decoded = jwt.verify(token, this.publicKey, {
        algorithms: ['RS256'],
      });

      if (typeof decoded === 'string' || !decoded) {
        throw new UnauthorizedException('Invalid JWT payload format');
      }

      return decoded as unknown as TochkaAcquiringWebhookPayload;
    } catch (err: any) {
      this.logger.warn(
        `[Tochka] webhook signature verification failed: ${err.message}`,
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }
}