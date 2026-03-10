import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  async getProfile(@CurrentUser('sub') userId: string) {
    const user = await this.usersService.findById(userId);

    const now = new Date();
    const subscriptionActive =
      user.subscriptionPlan !== 'free' &&
      user.subscriptionExpiresAt !== null &&
      user.subscriptionExpiresAt > now;

    return {
      success: true,
      data: {
        id: user._id.toString(),
        telegramId: user.telegramId,
        authProvider: user.authProvider,
        email: user.email || null,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        photoUrl: user.photoUrl,
        role: user.role,
        tokenBalance: user.tokenBalance,
        bonusTokens: user.bonusTokens,
        totalBalance: user.tokenBalance + user.bonusTokens,
        totalTokensSpent: user.totalTokensSpent,
        subscription: {
          plan: user.subscriptionPlan,
          expiresAt: user.subscriptionExpiresAt
            ? user.subscriptionExpiresAt.toISOString()
            : null,
          isActive: subscriptionActive,
        },
        referralCode: user.referralCode,
        referralCount: user.referralCount,
        referralEarnings: user.referralEarnings,
        settings: user.settings,
        createdAt: user.createdAt ? user.createdAt.toISOString() : null,
      },
    };
  }

  @Put('me/settings')
  @ApiOperation({ summary: 'Update user settings' })
  @HttpCode(200)
  async updateSettings(
    @CurrentUser('sub') userId: string,
    @Body() settings: any,
  ) {
    const user = await this.usersService.updateSettings(userId, settings);
    return { success: true, data: user.settings };
  }
}