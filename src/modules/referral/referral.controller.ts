import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ReferralService } from './referral.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { WithdrawalMethod } from './schemas/withdrawal.schema';

class CreateWithdrawalDto {
  amount: number;
  method: WithdrawalMethod;
  requisites: string;
}

@ApiTags('Referral')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('referral')
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  // ─── Старый эндпоинт (обратная совместимость) ──────────────

  @Get('stats')
  @ApiOperation({ summary: 'Get referral stats (legacy)' })
  async getStats(@CurrentUser('sub') userId: string) {
    const data = await this.referralService.getReferralStats(userId);
    return { success: true, data };
  }

  // ─── Новый эндпоинт для фронта ─────────────────────────────

  @Get('info')
  @ApiOperation({ summary: 'Get referral info (used by frontend ReferralPage)' })
  async getInfo(@CurrentUser('sub') userId: string) {
    const data = await this.referralService.getReferralInfo(userId);
    return { success: true, data };
  }

  // ─── Вывод средств ──────────────────────────────────────────

  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create withdrawal request' })
  async createWithdrawal(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateWithdrawalDto,
  ) {
    const data = await this.referralService.createWithdrawal(
      userId,
      Number(dto.amount),
      dto.method,
      dto.requisites,
    );
    return { success: true, data };
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'Get user withdrawal history' })
  async getWithdrawals(@CurrentUser('sub') userId: string) {
    const data = await this.referralService.getWithdrawals(userId);
    return { success: true, data };
  }
}