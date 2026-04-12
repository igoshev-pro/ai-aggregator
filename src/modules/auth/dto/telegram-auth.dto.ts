import { IsString, IsOptional, IsNumber } from 'class-validator';
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

export class TelegramWidgetAuthDto {
  @ApiProperty({ description: 'Telegram user ID' })
  @IsNumber()
  id: number;

  @ApiProperty({ description: 'First name' })
  @IsString()
  first_name: string;

  @ApiProperty({ required: false, description: 'Last name' })
  @IsString()
  @IsOptional()
  last_name?: string;

  @ApiProperty({ required: false, description: 'Username' })
  @IsString()
  @IsOptional()
  username?: string;

  @ApiProperty({ required: false, description: 'Photo URL' })
  @IsString()
  @IsOptional()
  photo_url?: string;

  @ApiProperty({ description: 'Auth date (unix timestamp)' })
  @IsNumber()
  auth_date: number;

  @ApiProperty({ description: 'Verification hash' })
  @IsString()
  hash: string;

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