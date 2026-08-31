// src/modules/auth/auth.service.ts
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '@/modules/users/users.service';
import { TelegramUser, JwtPayload, AuthProvider } from '@/common/interfaces';
import { TelegramAuthDto, TelegramWidgetAuthDto, AuthResponseDto } from './dto/telegram-auth.dto';
import { RegisterEmailDto, LoginEmailDto } from './dto/email-auth.dto';
import { UserDocument } from '@/modules/users/schemas/user.schema';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { ReferralService } from '@/modules/referral/referral.service';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { MailService } from './mail.service';
import { PasswordResetService } from './password-reset.service';

/** Стоимость bcrypt. 12 — разумный баланс: ~250мс на вход. */
const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly isDev: boolean;

  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    private configService: ConfigService,
    private referralService: ReferralService,
    private adminBootstrap: AdminBootstrapService,
    private mailService: MailService,
    private passwordReset: PasswordResetService,
  ) {
    this.isDev = this.configService.get('NODE_ENV') !== 'production';
  }

  // ─── Mini App Auth (initData) ─────────────────────────────────

  async authenticateWithTelegram(dto: TelegramAuthDto): Promise<AuthResponseDto> {
    if (dto.referralCode) {
      this.logger.log(`🎟️ Telegram auth with referralCode: "${dto.referralCode}"`);
    }

    // DEV Mode Bypass
    if (this.isDev) {
      if (dto.initData.includes('test') || dto.initData.includes('dev')) {
        this.logger.log('🔧 DEV mode: bypassing Telegram validation');
        return this.handleDevTelegramAuth(dto.initData, dto.referralCode);
      }
    }

    // Production Auth
    const telegramUser = this.validateAndParseInitData(dto.initData);

    if (!telegramUser) {
      throw new UnauthorizedException('Invalid Telegram authentication data');
    }

    const existedBefore = await this.usersService
      .findByTelegramId(telegramUser.id)
      .catch(() => null);
    const isNewUser = !existedBefore;

    const user = await this.usersService.findOrCreateByTelegram(
      telegramUser,
      dto.referralCode,
    );

    await this.adminBootstrap.syncRoleFromEnv(user);

    if (user.isBanned) {
      throw new UnauthorizedException(
        'Account is banned: ' + (user.banReason || 'No reason'),
      );
    }

    if (isNewUser && user.referredBy) {
      try {
        await this.referralService.recordReferral(
          user.referredBy.toString(),
          user._id.toString(),
        );
      } catch (err: any) {
        this.logger.warn(`Failed to record referral: ${err.message}`);
      }
    }

    return this.buildAuthResponse(user);
  }

  // ─── Telegram Login Widget Auth ───────────────────────────────

  async authenticateWithTelegramWidget(
    dto: TelegramWidgetAuthDto,
  ): Promise<AuthResponseDto> {
    if (dto.referralCode) {
      this.logger.log(`🎟️ Widget auth with referralCode: "${dto.referralCode}"`);
    }

    // DEV Mode Bypass
    if (this.isDev && dto.hash === 'dev_bypass') {
      this.logger.log('🔧 DEV mode: bypassing Widget validation');
      const telegramUser: TelegramUser = {
        id: dto.id,
        first_name: dto.first_name,
        last_name: dto.last_name,
        username: dto.username,
        photo_url: dto.photo_url,
      };

      const existedBefore = await this.usersService
        .findByTelegramId(dto.id)
        .catch(() => null);
      const isNewUser = !existedBefore;

      const user = await this.usersService.findOrCreateByTelegram(
        telegramUser,
        dto.referralCode,
      );

      await this.adminBootstrap.syncRoleFromEnv(user);

      if (isNewUser && user.referredBy) {
        await this.referralService
          .recordReferral(user.referredBy.toString(), user._id.toString())
          .catch((err) =>
            this.logger.warn(`Failed to record referral: ${err.message}`),
          );
      }

      return this.buildAuthResponse(user);
    }

    // Validate widget data
    const isValid = this.validateWidgetData(dto);

    if (!isValid) {
      throw new UnauthorizedException('Invalid Telegram Login Widget data');
    }

    // Check auth_date freshness
    const now = Math.floor(Date.now() / 1000);
    const maxAge = this.isDev ? 86400 * 30 : 86400;
    if (now - dto.auth_date > maxAge) {
      throw new UnauthorizedException('Telegram login data has expired');
    }

    const telegramUser: TelegramUser = {
      id: dto.id,
      first_name: dto.first_name,
      last_name: dto.last_name,
      username: dto.username,
      photo_url: dto.photo_url,
    };

    const existedBefore = await this.usersService
      .findByTelegramId(dto.id)
      .catch(() => null);
    const isNewUser = !existedBefore;

    const user = await this.usersService.findOrCreateByTelegram(
      telegramUser,
      dto.referralCode,
    );

    await this.adminBootstrap.syncRoleFromEnv(user);

    if (user.isBanned) {
      throw new UnauthorizedException(
        'Account is banned: ' + (user.banReason || 'No reason'),
      );
    }

    if (isNewUser && user.referredBy) {
      try {
        await this.referralService.recordReferral(
          user.referredBy.toString(),
          user._id.toString(),
        );
      } catch (err: any) {
        this.logger.warn(`Failed to record referral: ${err.message}`);
      }
    }

    this.logger.log(
      `✅ Telegram Widget auth successful for user ${dto.id} (@${dto.username || 'no-username'})`,
    );

    return this.buildAuthResponse(user);
  }

  // ─── Email Auth ───────────────────────────────────────────────

  /**
   * Регистрация по почте.
   *
   * Если аккаунт с такой почтой уже есть — не создаём второй. Возможны два
   * случая: у человека уже был пароль (пусть входит) либо аккаунт заводился
   * через Telegram/Google и пароля не имеет. Во втором случае предлагаем
   * восстановление: так пароль привяжется к существующему балансу, а не
   * появится дубль с нулевым.
   */
  async registerWithEmail(dto: RegisterEmailDto): Promise<AuthResponseDto> {
    const existing = await this.usersService.findByEmail(dto.email);

    if (existing) {
      if (existing.passwordHash) {
        throw new BadRequestException(
          'Аккаунт с такой почтой уже существует — войдите или восстановите пароль',
        );
      }
      throw new BadRequestException(
        'Эта почта уже привязана к аккаунту. Задайте пароль через «Забыли пароль?» — ' +
          'баланс и история сохранятся',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.usersService.createWithEmail({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName,
      referralCode: dto.referralCode,
    });

    if (user.referredBy) {
      try {
        await this.referralService.recordReferral(
          user.referredBy.toString(),
          user._id.toString(),
        );
      } catch (e: any) {
        this.logger.warn(`Не записал реферала: ${e.message}`);
      }
    }

    await this.adminBootstrap.syncRoleFromEnv(user);

    this.logger.log(`Регистрация по почте: ${dto.email}`);
    return this.buildAuthResponse(user);
  }

  /**
   * Вход по почте и паролю.
   *
   * Сообщение об ошибке одинаковое и для неизвестной почты, и для неверного
   * пароля — иначе форма превращается в инструмент проверки, кто
   * зарегистрирован в сервисе.
   */
  async loginWithEmail(dto: LoginEmailDto): Promise<AuthResponseDto> {
    const invalid = () =>
      new UnauthorizedException('Неверная почта или пароль');

    const user = await this.usersService.findByEmail(dto.email);

    // Сравниваем даже без пользователя: без этого по времени ответа
    // видно, существует ли аккаунт.
    const hash =
      user?.passwordHash ||
      '$2a$12$0000000000000000000000000000000000000000000000000000u';

    const ok = await bcrypt.compare(dto.password, hash);

    if (!user || !user.passwordHash || !ok) throw invalid();

    if (!user.isActive || user.isBanned) {
      throw new UnauthorizedException(
        'Аккаунт недоступен: ' + (user.banReason || 'заблокирован'),
      );
    }

    // Роль из ADMIN_EMAILS / SUPER_ADMIN_EMAILS — как и для Telegram-входа.
    await this.adminBootstrap.syncRoleFromEnv(user);

    await this.usersService.setLastActive(user._id.toString());
    return this.buildAuthResponse(user);
  }

  /**
   * Запрос восстановления пароля.
   *
   * Всегда отвечает одинаково, даже если почты нет в базе — ответ не должен
   * подсказывать, кто у нас зарегистрирован. Письмо уходит только реальному
   * пользователю.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      this.logger.log(`Сброс пароля запрошен для неизвестной почты: ${email}`);
      return;
    }
    if (!user.isActive || user.isBanned) return;

    const token = await this.passwordReset.issue(user._id.toString());
    await this.mailService.sendPasswordReset(email, token);
  }

  /** Смена пароля по токену из письма. Токен одноразовый. */
  async resetPassword(token: string, password: string): Promise<AuthResponseDto> {
    const userId = await this.passwordReset.consume(token);
    if (!userId) {
      throw new BadRequestException(
        'Ссылка недействительна или устарела — запросите восстановление заново',
      );
    }

    const user = await this.usersService.findById(userId);
    if (!user) throw new BadRequestException('Пользователь не найден');

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await this.usersService.setPasswordHash(userId, passwordHash);

    // Сразу пускаем внутрь: человек только что подтвердил владение почтой.
    user.passwordHash = passwordHash;
    this.logger.log(`Пароль изменён: ${user.email}`);

    return this.buildAuthResponse(user);
  }

  // ─── Bot Auth (сайт через бота) ───────────────────────────────

  /**
   * 🆕 Выдаёт JWT по userId — используется bot-auth flow и любым другим
   * сценарием, где пользователь уже идентифицирован.
   */
  async buildAuthResponseByUserId(userId: string): Promise<AuthResponseDto> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (!user.isActive || user.isBanned) {
      throw new UnauthorizedException(
        'Account is not available: ' + (user.banReason || 'inactive/banned'),
      );
    }
    return this.buildAuthResponse(user);
  }

  // ─── Widget Data Validation ───────────────────────────────────

  private validateWidgetData(dto: TelegramWidgetAuthDto): boolean {
    try {
      const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');

      if (!botToken) {
        this.logger.error('TELEGRAM_BOT_TOKEN is not configured');
        return false;
      }

      const checkData: Record<string, string> = {};

      if (dto.id !== undefined) checkData['id'] = String(dto.id);
      if (dto.first_name !== undefined) checkData['first_name'] = dto.first_name;
      if (dto.last_name !== undefined) checkData['last_name'] = dto.last_name;
      if (dto.username !== undefined) checkData['username'] = dto.username;
      if (dto.photo_url !== undefined) checkData['photo_url'] = dto.photo_url;
      if (dto.auth_date !== undefined) checkData['auth_date'] = String(dto.auth_date);

      const dataCheckString = Object.keys(checkData)
        .sort()
        .map((key) => `${key}=${checkData[key]}`)
        .join('\n');

      const secretKey = crypto
        .createHash('sha256')
        .update(botToken)
        .digest();

      const calculatedHash = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

      if (calculatedHash !== dto.hash) {
        if (this.isDev) {
          this.logger.warn(`❌ Widget hash mismatch: expected ${calculatedHash}, got ${dto.hash}`);
          this.logger.warn(`   data_check_string: ${JSON.stringify(dataCheckString)}`);
        }
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error('Error validating widget data:', error);
      return false;
    }
  }

  // ─── Build unified auth response ─────────────────────────────

  private buildAuthResponse(user: UserDocument): AuthResponseDto {
    const payload: JwtPayload = {
      sub: user._id.toString(),
      telegramId: user.telegramId || undefined,
      email: user.email || undefined,
      authProvider: user.authProvider || AuthProvider.TELEGRAM,
      role: user.role,
    };

    const token = this.jwtService.sign(payload);

    const now = new Date();
    const subscriptionActive =
      user.subscriptionPlan !== 'free' &&
      user.subscriptionExpiresAt !== null &&
      user.subscriptionExpiresAt > now;

    return {
      token,
      user: {
        id: user._id.toString(),
        telegramId: user.telegramId || null,
        authProvider: user.authProvider || AuthProvider.TELEGRAM,
        email: user.email || null,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        username: user.username || '',
        photoUrl: user.photoUrl || '',
        role: user.role,
        tokenBalance: user.tokenBalance,
        bonusTokens: user.bonusTokens,
        totalBalance: user.tokenBalance + user.bonusTokens,
        subscription: {
          plan: user.subscriptionPlan,
          expiresAt: user.subscriptionExpiresAt
            ? user.subscriptionExpiresAt.toISOString()
            : null,
          isActive: subscriptionActive,
        },
        referralCode: user.referralCode,
        createdAt: user.createdAt ? user.createdAt.toISOString() : null,
      },
    };
  }

  // ─── DEV Methods ─────────────────────────────────────────────

  async devAuth(userId: number, username?: string, role?: string): Promise<AuthResponseDto> {
    if (!this.isDev) {
      throw new UnauthorizedException('Dev auth is only available in development mode');
    }

    this.logger.log(`🔧 DEV Auth for user ${userId} (${username})`);

    const telegramUser: TelegramUser = {
      id: userId,
      first_name: 'Test',
      last_name: 'User',
      username: username || `testuser_${userId}`,
      language_code: 'en',
    };

    const user = await this.usersService.findOrCreateByTelegram(telegramUser, undefined);

    await this.adminBootstrap.syncRoleFromEnv(user);

    if (role && (role === 'admin' || role === 'moderator')) {
      user.role = role as any;
      await user.save();
    }

    if (user.tokenBalance === 0 && user.bonusTokens <= 50) {
      user.tokenBalance = 10000;
      user.bonusTokens = 5000;
      await user.save();
      this.logger.log(`🎁 DEV: Added test tokens to user ${userId}`);
    }

    return this.buildAuthResponse(user);
  }

  private async handleDevTelegramAuth(
    initData: string,
    _referralCode?: string,
  ): Promise<AuthResponseDto> {
    try {
      const params = new URLSearchParams(initData);
      const userStr = params.get('user');

      let userId = 123456789;
      let username = 'testuser';

      if (userStr) {
        try {
          const userData = JSON.parse(decodeURIComponent(userStr));
          userId = userData.id || userId;
          username = userData.username || username;
        } catch {
          this.logger.warn('Failed to parse test user data, using defaults');
        }
      }

      return this.devAuth(userId, username);
    } catch (error) {
      this.logger.error('Error in handleDevTelegramAuth:', error);
      return this.devAuth(123456789, 'testuser');
    }
  }

  // ─── Mini App Telegram Validation ────────────────────────────

  private validateAndParseInitData(initData: string): TelegramUser | null {
    try {
      const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');

      if (!botToken) {
        if (this.isDev) {
          this.logger.warn('⚠️ TELEGRAM_BOT_TOKEN not set, validation will fail');
        }
        return null;
      }

      const params = new URLSearchParams(initData);
      const hash = params.get('hash');

      if (!hash) return null;

      params.delete('hash');

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

      if (calculatedHash !== hash) {
        if (this.isDev) {
          this.logger.warn(`❌ Hash mismatch: expected ${calculatedHash}, got ${hash}`);
        }
        return null;
      }

      const authDate = parseInt(params.get('auth_date') || '0', 10);
      const now = Math.floor(Date.now() / 1000);

      const maxAge = this.isDev ? 86400 * 30 : 86400;
      if (now - authDate > maxAge) {
        if (this.isDev) {
          this.logger.warn(`⏰ Auth data expired: ${now - authDate} seconds old`);
        }
        return null;
      }

      const userStr = params.get('user');
      if (!userStr) return null;

      return JSON.parse(decodeURIComponent(userStr));
    } catch (error) {
      if (this.isDev) {
        this.logger.error('Error validating init data:', error);
      }
      return null;
    }
  }

  async refreshToken(userId: string): Promise<{ token: string }> {
    const user = await this.usersService.findById(userId);
    const payload: JwtPayload = {
      sub: user._id.toString(),
      telegramId: user.telegramId || undefined,
      email: user.email || undefined,
      authProvider: user.authProvider || AuthProvider.TELEGRAM,
      role: user.role,
    };
    return { token: this.jwtService.sign(payload) };
  }
}