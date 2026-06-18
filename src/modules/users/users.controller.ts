import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  HttpCode,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { BillingService } from '@/modules/billing/billing.service';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => BillingService))
    private readonly billingService: BillingService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  async getProfile(@CurrentUser('sub') userId: string) {
    const user = await this.usersService.findById(userId);

    const now = new Date();
    const subscriptionActive =
      user.subscriptionPlan !== 'free' &&
      user.subscriptionExpiresAt !== null &&
      user.subscriptionExpiresAt > now;

    // 🆕 Достаём display name плана из конфига (для UI: "Plus", "Max", "Ultimate")
    let planName: string | null = null;
    let planConfig: any = null;
    try {
      planConfig = await this.billingService.getPlanConfigPublic(
        user.subscriptionPlan,
      );
      if (planConfig) {
        planName = planConfig.name;
      }
    } catch (e) {
      // Не валим запрос если конфиг не найден
      planName = null;
    }

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
        cashbackBalance: user.cashbackBalance || 0,
        totalBalance:
          user.tokenBalance + user.bonusTokens + (user.cashbackBalance || 0),
        totalTokensSpent: user.totalTokensSpent,
        subscription: {
          plan: user.subscriptionPlan,
          // 🆕 человекочитаемое имя плана для UI
          planName: planName || (user.subscriptionPlan === 'free' ? 'Free' : null),
          expiresAt: user.subscriptionExpiresAt
            ? user.subscriptionExpiresAt.toISOString()
            : null,
          isActive: subscriptionActive,
          // 🆕 краткая инфа о плане для отображения в профиле
          tokensPerMonth: planConfig?.tokensPerMonth || 0,
          freeModelsCount: planConfig?.freeModels?.length || 0,
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