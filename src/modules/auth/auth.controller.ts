import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  UseGuards,
  HttpCode,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { BotAuthService } from './bot-auth.service';
import { TelegramAuthDto, TelegramWidgetAuthDto } from './dto/telegram-auth.dto';
import {
  RegisterEmailDto,
  LoginEmailDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
} from './dto/email-auth.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly botAuthService: BotAuthService,
  ) {}

  @Post('telegram')
  @ApiOperation({ summary: 'Authenticate with Telegram WebApp initData' })
  @HttpCode(200)
  async telegramAuth(@Body() dto: TelegramAuthDto) {
    const result = await this.authService.authenticateWithTelegram(dto);
    return { success: true, data: result };
  }

  @Post('telegram-widget')
  @ApiOperation({ summary: 'Authenticate with Telegram Login Widget' })
  @HttpCode(200)
  async telegramWidgetAuth(@Body() dto: TelegramWidgetAuthDto) {
    const result = await this.authService.authenticateWithTelegramWidget(dto);
    return { success: true, data: result };
  }

  // ─── Email Auth ─────────────────────────────────────────────
  //
  // Лимиты жёстче общих: подбор пароля и рассылка писем — то, ради чего
  // эти адреса и станут дёргать. Счёт идёт по IP (штатное поведение
  // ThrottlerGuard).
  //
  // Выключено до настройки SMTP через EMAIL_AUTH_ENABLED в .env.
  // Прятать форму на фронте недостаточно: эндпоинты доступны напрямую,
  // и без почты человек мог бы зарегистрироваться, забыть пароль и
  // остаться без способа восстановить доступ.

  /** Пока почта не настроена, эти маршруты отвечают 404. */
  private assertEmailAuthEnabled() {
    const enabled =
      String(process.env.EMAIL_AUTH_ENABLED || '').toLowerCase() === 'true';
    if (!enabled) {
      throw new NotFoundException('Вход по почте пока недоступен');
    }
  }

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Регистрация по почте и паролю' })
  @HttpCode(200)
  async register(@Body() dto: RegisterEmailDto) {
    this.assertEmailAuthEnabled();
    const result = await this.authService.registerWithEmail(dto);
    return { success: true, data: result };
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Вход по почте и паролю' })
  @HttpCode(200)
  async login(@Body() dto: LoginEmailDto) {
    this.assertEmailAuthEnabled();
    const result = await this.authService.loginWithEmail(dto);
    return { success: true, data: result };
  }

  @Post('password/forgot')
  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  @ApiOperation({ summary: 'Запросить письмо для восстановления пароля' })
  @HttpCode(200)
  async forgotPassword(@Body() dto: RequestPasswordResetDto) {
    this.assertEmailAuthEnabled();
    await this.authService.requestPasswordReset(dto.email);
    // Ответ одинаковый в любом случае — он не должен выдавать,
    // зарегистрирована ли почта.
    return {
      success: true,
      data: {
        message: 'Если такая почта зарегистрирована, письмо уже отправлено',
      },
    };
  }

  @Post('password/reset')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Задать новый пароль по токену из письма' })
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    this.assertEmailAuthEnabled();
    const result = await this.authService.resetPassword(dto.token, dto.password);
    return { success: true, data: result };
  }

  // ─── Bot Auth (сайт через бота) ─────────────────────────────

  @Post('bot/init')
  @ApiOperation({ summary: 'Bot Auth: create login session, returns deep link' })
  @HttpCode(200)
  async botInit(@Body() body: { referralCode?: string }) {
    const result = await this.botAuthService.createSession(body?.referralCode);
    return { success: true, data: result };
  }

  @Get('bot/poll/:code')
  @ApiOperation({ summary: 'Bot Auth: poll session status, returns JWT when confirmed' })
  async botPoll(@Param('code') code: string) {
    const result = await this.botAuthService.pollSession(code);

    if (result.status !== 'confirmed' || !result.userId) {
      return { success: true, data: { status: result.status } };
    }

    const auth = await this.authService.buildAuthResponseByUserId(result.userId);
    return { success: true, data: { status: 'confirmed', ...auth } };
  }

    @Post('dev')
  @ApiOperation({ summary: 'DEV: Test authentication (development only)' })
  @HttpCode(200)
  async devAuth(@Body() dto: { userId: number; username?: string }) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Dev auth is not available in production');
    }
    const result = await this.authService.devAuth(dto.userId, dto.username);
    return { success: true, data: result };
  }

  @Get('refresh')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Refresh JWT token' })
  async refresh(@CurrentUser('sub') userId: string) {
    const result = await this.authService.refreshToken(userId);
    return { success: true, data: result };
  }
}