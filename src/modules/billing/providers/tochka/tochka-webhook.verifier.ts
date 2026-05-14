import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { TochkaAcquiringWebhookPayload } from './tochka.types';

/**
 * Верификация JWT-вебхуков от Точки.
 *
 * Точка присылает вебхук как Content-Type: text/plain,
 * тело = JWT строка, подписанная их приватным RSA-ключом (RS256).
 * Мы проверяем подпись их публичным ключом и распарсиваем payload.
 */
@Injectable()
export class TochkaWebhookVerifier {
  private readonly logger = new Logger(TochkaWebhookVerifier.name);
  private readonly publicKey: string;

  constructor(private readonly configService: ConfigService) {
    const raw = this.configService.get<string>('TOCHKA_PUBLIC_KEY') || '';
    // В .env переносы строк обычно экранированы как \n — раскодируем
    this.publicKey = raw.replace(/\\n/g, '\n').trim();

    if (!this.publicKey) {
      this.logger.error(
        '⚠️ TOCHKA_PUBLIC_KEY is empty — webhook verification will FAIL',
      );
    }
  }

  /**
   * Проверяет подпись и возвращает распарсенный payload.
   * Бросает UnauthorizedException при невалидной подписи.
   */
  verify(rawJwt: string): TochkaAcquiringWebhookPayload {
    if (!this.publicKey) {
      throw new UnauthorizedException('Tochka public key not configured');
    }

    if (!rawJwt || typeof rawJwt !== 'string') {
      throw new UnauthorizedException('Empty webhook body');
    }

    const token = rawJwt.trim();

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