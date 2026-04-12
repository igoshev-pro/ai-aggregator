import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '@/modules/users/users.service';
import { TelegramUser, JwtPayload, AuthProvider } from '@/common/interfaces';
import { TelegramAuthDto, TelegramWidgetAuthDto, AuthResponseDto } from './dto/telegram-auth.dto';
import { UserDocument } from '@/modules/users/schemas/user.schema';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly isDev: boolean;

  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    private configService: ConfigService,
  ) {
    this.isDev = this.configService.get('NODE_ENV') !== 'production';
  }

  // ─── Mini App Auth (initData) ─────────────────────────────────

  async authenticateWithTelegram(dto: TelegramAuthDto): Promise<AuthResponseDto> {
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

    const user = await this.usersService.findOrCreateByTelegram(
      telegramUser,
      dto.referralCode,
    );

    if (user.isBanned) {
      throw new UnauthorizedException('Account is banned: ' + (user.banReason || 'No reason'));
    }

    return this.buildAuthResponse(user);
  }

  // ─── Telegram Login Widget Auth ───────────────────────────────

  async authenticateWithTelegramWidget(dto: TelegramWidgetAuthDto): Promise<AuthResponseDto> {
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
      const user = await this.usersService.findOrCreateByTelegram(telegramUser, dto.referralCode);
      return this.buildAuthResponse(user);
    }

    // Validate widget data
    const isValid = this.validateWidgetData(dto);

    if (!isValid) {
      throw new UnauthorizedException('Invalid Telegram Login Widget data');
    }

    // Check auth_date freshness (24 hours)
    const now = Math.floor(Date.now() / 1000);
    const maxAge = this.isDev ? 86400 * 30 : 86400; // 30 days in dev, 24h in prod
    if (now - dto.auth_date > maxAge) {
      throw new UnauthorizedException('Telegram login data has expired');
    }

    // Convert to TelegramUser format
    const telegramUser: TelegramUser = {
      id: dto.id,
      first_name: dto.first_name,
      last_name: dto.last_name,
      username: dto.username,
      photo_url: dto.photo_url,
    };

    const user = await this.usersService.findOrCreateByTelegram(
      telegramUser,
      dto.referralCode,
    );

    if (user.isBanned) {
      throw new UnauthorizedException('Account is banned: ' + (user.banReason || 'No reason'));
    }

    this.logger.log(`✅ Telegram Widget auth successful for user ${dto.id} (@${dto.username || 'no-username'})`);

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

      // Build data_check_string from all fields except hash and referralCode
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

      // Login Widget uses SHA256(BOT_TOKEN) as secret (NOT HMAC!)
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