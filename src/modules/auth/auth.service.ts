import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '@/modules/users/users.service';
import { TelegramUser, JwtPayload, AuthProvider } from '@/common/interfaces';
import { TelegramAuthDto, AuthResponseDto } from './dto/telegram-auth.dto';
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

  async authenticateWithTelegram(dto: TelegramAuthDto): Promise<AuthResponseDto> {
    // ─── DEV Mode Bypass ─────────────────────────────────────────
    if (this.isDev) {
      if (dto.initData.includes('test') || dto.initData.includes('dev')) {
        this.logger.log('🔧 DEV mode: bypassing Telegram validation');
        return this.handleDevTelegramAuth(dto.initData, dto.referralCode);
      }
    }

    // ─── Production Auth ─────────────────────────────────────────
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

  // ─── Telegram Validation ─────────────────────────────────────

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