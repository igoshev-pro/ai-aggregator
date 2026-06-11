import { Controller, Post, Body, Get, Param, UseGuards, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { BotAuthService } from './bot-auth.service';
import { TelegramAuthDto, TelegramWidgetAuthDto } from './dto/telegram-auth.dto';
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