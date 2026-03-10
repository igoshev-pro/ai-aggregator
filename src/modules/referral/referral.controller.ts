import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ReferralService } from './referral.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Referral')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('referral')
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get referral stats and link' })
  async getStats(@CurrentUser('sub') userId: string) {
    const data = await this.referralService.getReferralStats(userId);
    return { success: true, data };
  }
}