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
    return {
      success: true,
      data: {
        id: user._id,
        telegramId: user.telegramId,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        photoUrl: user.photoUrl,
        tokenBalance: user.tokenBalance,
        bonusTokens: user.bonusTokens,
        totalAvailable: user.tokenBalance + user.bonusTokens,
        totalTokensSpent: user.totalTokensSpent,
        subscriptionPlan: user.subscriptionPlan,
        subscriptionExpiresAt: user.subscriptionExpiresAt,
        referralCode: user.referralCode,
        referralCount: user.referralCount,
        referralEarnings: user.referralEarnings,
        settings: user.settings,
        role: user.role,
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