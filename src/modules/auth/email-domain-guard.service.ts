// src/modules/auth/email-domain-guard.service.ts
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as dns } from 'dns';
import Redis from 'ioredis';
import { DISPOSABLE_DOMAINS } from './disposable-domains';

/**
 * Защита регистрации по почте от фарма стартовых спичек.
 *
 * Люди заводили аккаунты на временные ящики и забирали бонус раз за разом.
 * Подтверждения почты нет (решение заказчика), поэтому три дешёвых слоя:
 *
 *  1. Домен из открытого списка одноразовых (≈10 тыс.) — отказ.
 *     Сверяем и поддомены: abc.tempmail.com ловится по tempmail.com.
 *  2. У домена нет MX — отказ: туда письма не доходят, адрес выдуман.
 *     Заодно смотрим, куда указывает MX: свежий домен временной почты,
 *     которого ещё нет в списке, обычно смотрит на MX-сервер известного
 *     сервиса (mx.temp-mail.org и т.п.) — его тоже режем.
 *  3. Не больше N регистраций с одного IP за сутки (Redis).
 *
 * Сбои инфраструктуры (DNS не ответил, Redis лежит) пропускают
 * регистрацию: из-за таймаута резолвера нельзя терять честных людей.
 */

/**
 * Временная почта, которой нет в открытом списке. Сюда — домены,
 * замеченные в фарме у нас. Через env BLOCKED_EMAIL_DOMAINS (через запятую)
 * можно добавить без пересборки.
 */
const EXTRA_DISPOSABLE_DOMAINS = [
  'temp-mail.io',
  'tempmail.ninja',
  'mohmal.com',
  'tempmailo.com',
  'tempmail.dev',
  'emailondeck.com',
  'mail.tm',
  'mail.gw',
];

const MX_TIMEOUT_MS = 3000;
const MX_CACHE_TTL_MS = 60 * 60 * 1000;
const IP_WINDOW_SECONDS = 24 * 60 * 60;
const IP_KEY = (ip: string) => `regip:${ip}`;

type MxVerdict = 'ok' | 'no-mx' | 'disposable-mx' | 'unknown';

@Injectable()
export class EmailDomainGuardService implements OnModuleDestroy {
  private readonly logger = new Logger(EmailDomainGuardService.name);
  private readonly blocked: Set<string>;
  private readonly resolver = new dns.Resolver({ timeout: MX_TIMEOUT_MS, tries: 2 });
  private readonly mxCache = new Map<string, { verdict: MxVerdict; at: number }>();
  private readonly perIpLimit: number;
  private redis: Redis;

  constructor(private readonly config: ConfigService) {
    const fromEnv = String(this.config.get('BLOCKED_EMAIL_DOMAINS') || '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);

    this.blocked = new Set([
      ...DISPOSABLE_DOMAINS,
      ...EXTRA_DISPOSABLE_DOMAINS,
      ...fromEnv,
    ]);

    // 0 — лимит выключен.
    const limit = Number(this.config.get('REGISTRATIONS_PER_IP_PER_DAY'));
    this.perIpLimit = Number.isFinite(limit) && limit >= 0 ? limit : 3;

    this.redis = new Redis({
      host: this.config.get<string>('REDIS_HOST') || 'localhost',
      port: Number(this.config.get('REDIS_PORT')) || 6379,
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
      maxRetriesPerRequest: 2,
    });
    this.redis.on('error', (err) =>
      this.logger.error(`Redis error: ${err.message}`),
    );

    this.logger.log(
      `Одноразовых доменов в списке: ${this.blocked.size}; ` +
        `регистраций с IP в сутки: ${this.perIpLimit || 'без лимита'}`,
    );
  }

  onModuleDestroy() {
    this.redis?.disconnect();
  }

  /** Домен или любой его родитель есть в списке. */
  isDisposableDomain(domain: string): boolean {
    const parts = domain.toLowerCase().replace(/\.$/, '').split('.');
    // a.b.example.com → проверяем a.b.example.com, b.example.com, example.com
    for (let i = 0; i <= parts.length - 2; i++) {
      if (this.blocked.has(parts.slice(i).join('.'))) return true;
    }
    return false;
  }

  /** Слои 1 и 2. Бросает 400 с понятным текстом. */
  async assertEmailAllowed(email: string): Promise<void> {
    const domain = email.split('@').pop()?.toLowerCase().trim() || '';

    if (!domain || this.isDisposableDomain(domain)) {
      this.logger.warn(`Регистрация отклонена (временная почта): ${email}`);
      throw new BadRequestException(
        'Временные почтовые ящики не поддерживаются — укажите постоянную почту',
      );
    }

    const verdict = await this.checkMx(domain);
    if (verdict === 'no-mx') {
      this.logger.warn(`Регистрация отклонена (нет MX): ${email}`);
      throw new BadRequestException(
        'На этот адрес не доставляется почта — проверьте, нет ли опечатки в домене',
      );
    }
    if (verdict === 'disposable-mx') {
      this.logger.warn(`Регистрация отклонена (MX временной почты): ${email}`);
      throw new BadRequestException(
        'Временные почтовые ящики не поддерживаются — укажите постоянную почту',
      );
    }
  }

  private async checkMx(domain: string): Promise<MxVerdict> {
    const cached = this.mxCache.get(domain);
    if (cached && Date.now() - cached.at < MX_CACHE_TTL_MS) return cached.verdict;

    let verdict: MxVerdict;
    try {
      const records = await this.resolver.resolveMx(domain);
      // RFC 7505 «null MX» (exchange = ".") — домен явно не принимает почту.
      const hosts = records
        .map((r) => r.exchange.toLowerCase().replace(/\.$/, ''))
        .filter(Boolean);

      if (hosts.length === 0) verdict = 'no-mx';
      else if (hosts.some((h) => this.isDisposableDomain(h))) verdict = 'disposable-mx';
      else verdict = 'ok';
    } catch (e: any) {
      // ENOTFOUND — домена нет, ENODATA — домен есть, MX нет.
      // Остальное (ETIMEOUT, ESERVFAIL, ECONNREFUSED) — проблема резолвера,
      // не человека: пропускаем и не кешируем.
      if (e?.code === 'ENOTFOUND' || e?.code === 'ENODATA') {
        verdict = 'no-mx';
      } else {
        this.logger.warn(`MX ${domain}: ${e?.code || e?.message} — пропускаю`);
        return 'unknown';
      }
    }

    // Кеш не разрастается бесконечно: при переполнении сбрасываем целиком.
    if (this.mxCache.size > 5000) this.mxCache.clear();
    this.mxCache.set(domain, { verdict, at: Date.now() });
    return verdict;
  }

  /** Слой 3: проверка до регистрации. */
  async assertIpQuota(ip: string | undefined): Promise<void> {
    if (!this.perIpLimit || !ip) return;
    try {
      const used = Number(await this.redis.get(IP_KEY(ip))) || 0;
      if (used >= this.perIpLimit) {
        this.logger.warn(`Регистрация отклонена (лимит IP ${used}/${this.perIpLimit}): ${ip}`);
        throw new HttpException(
          'Слишком много регистраций с этого устройства. Попробуйте завтра ' +
            'или войдите в уже созданный аккаунт',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (e) {
      if (e instanceof HttpException) throw e;
      this.logger.error(`Лимит по IP не проверен: ${(e as Error).message}`);
    }
  }

  /** Слой 3: учёт после успешной регистрации. Окно — сутки с первой. */
  async recordRegistration(ip: string | undefined): Promise<void> {
    if (!this.perIpLimit || !ip) return;
    try {
      const key = IP_KEY(ip);
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, IP_WINDOW_SECONDS);
    } catch (e: any) {
      this.logger.error(`Регистрацию по IP не учёл: ${e.message}`);
    }
  }
}
