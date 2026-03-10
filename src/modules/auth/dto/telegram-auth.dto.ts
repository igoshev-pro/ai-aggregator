import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TelegramAuthDto {
  @ApiProperty({ description: 'Telegram WebApp initData string' })
  @IsString()
  initData: string;

  @ApiProperty({ required: false, description: 'Referral code' })
  @IsString()
  @IsOptional()
  referralCode?: string;
}

export class AuthResponseDto {
  accessToken: string;
  user: {
    id: string;
    telegramId: number;
    firstName: string;
    username: string;
    tokenBalance: number;
    bonusTokens: number;
    role: string;
    subscriptionPlan: string;
  };
}