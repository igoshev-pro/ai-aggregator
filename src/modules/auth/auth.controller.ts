import { Controller, Post, Body, Get, UseGuards, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('telegram')
  @ApiOperation({ summary: 'Authenticate with Telegram WebApp initData' })
  @HttpCode(200)
  async telegramAuth(@Body() dto: TelegramAuthDto) {
    const result = await this.authService.authenticateWithTelegram(dto);
    return { success: true, data: result };
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