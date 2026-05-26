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

class CreateWithdrawalDto {
  @ApiProperty({ example: 100, minimum: 100, maximum: 100000 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(100)
  @Max(100_000)
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