// src/modules/auth/auth.service.ts - исправленная версия
import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '@/modules/users/users.service';
import { TelegramUser, JwtPayload } from '@/common/interfaces';
import { TelegramAuthDto, AuthResponseDto } from './dto/telegram-auth.dto';
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
      // Проверяем, есть ли в initData тестовые данные
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

    const payload: JwtPayload = {
      sub: user._id.toString(),
      telegramId: user.telegramId,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: user._id.toString(),
        telegramId: user.telegramId,
        firstName: user.firstName,
        username: user.username,
        tokenBalance: user.tokenBalance,
        bonusTokens: user.bonusTokens,
        role: user.role,
        subscriptionPlan: user.subscriptionPlan,
      },
    };
  }

  // ─── DEV Methods ─────────────────────────────────────────────
  
  /**
   * DEV: Direct authentication for testing
   */
  async devAuth(userId: number, username?: string, role?: string): Promise<AuthResponseDto> {
    if (!this.isDev) {
      throw new UnauthorizedException('Dev auth is only available in development mode');
    }

    this.logger.log(`🔧 DEV Auth for user ${userId} (${username})`);

    // Создаем тестового пользователя
    const telegramUser: TelegramUser = {
      id: userId,
      first_name: 'Test',
      last_name: 'User',
      username: username || `testuser_${userId}`,
      language_code: 'en',
      // Убрали is_bot - его нет в интерфейсе
    };

    // Передаем undefined вместо null для опционального параметра
    const user = await this.usersService.findOrCreateByTelegram(
      telegramUser, 
      undefined  // ← исправлено с null на undefined
    );

    // В DEV режиме можем установить роль
    if (role && (role === 'admin' || role === 'moderator')) {
      user.role = role as any;
      await user.save();
    }

    // Даем бонусные токены для тестирования
    if (user.tokenBalance === 0) {
      user.tokenBalance = 10000; // 10k токенов для тестов
      user.bonusTokens = 5000;   // 5k бонусных
      await user.save();
      this.logger.log(`🎁 DEV: Added test tokens to user ${userId}`);
    }

    const payload: JwtPayload = {
      sub: user._id.toString(),
      telegramId: user.telegramId,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: user._id.toString(),
        telegramId: user.telegramId,
        firstName: user.firstName,
        username: user.username,
        tokenBalance: user.tokenBalance,
        bonusTokens: user.bonusTokens,
        role: user.role,
        subscriptionPlan: user.subscriptionPlan,
      },
    };
  }

  /**
   * DEV: Handle test Telegram auth data
   */
  private async handleDevTelegramAuth(
    initData: string,
    referralCode?: string,
  ): Promise<AuthResponseDto> {
    try {
      // Пытаемся распарсить тестовые данные
      const params = new URLSearchParams(initData);
      const userStr = params.get('user');

      let userId = 123456789;
      let username = 'testuser';

      if (userStr) {
        try {
          const userData = JSON.parse(decodeURIComponent(userStr));
          userId = userData.id || userId;
          username = userData.username || username;
        } catch (e) {
          this.logger.warn('Failed to parse test user data, using defaults');
        }
      }

      return this.devAuth(userId, username);
    } catch (error) {
      this.logger.error('Error in handleDevTelegramAuth:', error);
      // Fallback на дефолтного пользователя
      return this.devAuth(123456789, 'testuser');
    }
  }

  /**
   * DEV: Create test JWT token without auth
   */
  async devCreateToken(
    userId: string,
    telegramId: number,
    role: string = 'user',
  ): Promise<string> {
    if (!this.isDev) {
      throw new UnauthorizedException('Dev methods are only available in development mode');
    }

    const payload: JwtPayload = {
      sub: userId,
      telegramId,
      role: role as any,
    };

    return this.jwtService.sign(payload);
  }

  /**
   * DEV: Validate any token (for debugging)
   */
  async devValidateToken(token: string): Promise<any> {
    if (!this.isDev) {
      throw new UnauthorizedException('Dev methods are only available in development mode');
    }

    try {
      const decoded = this.jwtService.verify(token);
      return {
        valid: true,
        decoded,
        expiresAt: new Date((decoded as any).exp * 1000),
      };
    } catch (error: any) {
      return {
        valid: false,
        error: error.message,
      };
    }
  }

  // ─── Original Methods ────────────────────────────────────────

  private validateAndParseInitData(initData: string): TelegramUser | null {
    try {
      const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
      
      // В DEV режиме, если нет токена - логируем предупреждение
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
      
      // В DEV режиме увеличиваем время валидности до 30 дней
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

  async refreshToken(userId: string): Promise<{ accessToken: string }> {
    const user = await this.usersService.findById(userId);
    const payload: JwtPayload = {
      sub: user._id.toString(),
      telegramId: user.telegramId,
      role: user.role,
    };
    return { accessToken: this.jwtService.sign(payload) };
  }
}