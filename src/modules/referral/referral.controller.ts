// src/modules/referral/referral.controller.ts
import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsString,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ReferralService } from './referral.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { WithdrawalMethod } from './schemas/withdrawal.schema';

// 1000 ₽ / 3 = 334 спички (минимум), 100 000 ₽ / 3 = 33334 спички (максимум)
const MIN_WITHDRAWAL_TOKENS = 334;
const MAX_WITHDRAWAL_TOKENS = 33334;

class CreateWithdrawalDto {
  @ApiProperty({
    example: 334,
    minimum: MIN_WITHDRAWAL_TOKENS,
    maximum: MAX_WITHDRAWAL_TOKENS,
    description: 'Сумма в спичках (1 спичка = 3 ₽)',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(MIN_WITHDRAWAL_TOKENS)
  @Max(MAX_WITHDRAWAL_TOKENS)
  amount: number;

  @ApiProperty({ enum: WithdrawalMethod })
  @IsEnum(WithdrawalMethod)
  method: WithdrawalMethod;

  @ApiProperty({ example: '+79991234567' })
  @IsString()
  @MinLength(4)
  @MaxLength(200)
  requisites: string;
}

@ApiTags('Referral')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('referral')
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get referral stats (legacy)' })
  async getStats(@CurrentUser('sub') userId: string) {
    const data = await this.referralService.getReferralStats(userId);
    return { success: true, data };
  }

  @Get('info')
  @ApiOperation({ summary: 'Get referral info (ReferralPage)' })
  async getInfo(@CurrentUser('sub') userId: string) {
    const data = await this.referralService.getReferralInfo(userId);
    return { success: true, data };
  }

  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create withdrawal request' })
  async createWithdrawal(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateWithdrawalDto,
  ) {
    const data = await this.referralService.createWithdrawal(
      userId,
      dto.amount,
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