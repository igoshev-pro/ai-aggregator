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
  token: string;
  user: {
    id: string;
    telegramId: number | null;
    authProvider: string;
    email: string | null;
    firstName: string;
    lastName: string;
    username: string;
    photoUrl: string;
    role: string;
    tokenBalance: number;
    bonusTokens: number;
    totalBalance: number;
    subscription: {
      plan: string;
      expiresAt: string | null;
      isActive: boolean;
    };
    referralCode: string;
    createdAt: string | null;
  };
}