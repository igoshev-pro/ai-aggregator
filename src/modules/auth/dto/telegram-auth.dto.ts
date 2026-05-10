import { IsString, IsOptional, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TelegramAuthDto {
  @ApiProperty({ description: 'Telegram WebApp initData string' })
  @IsString()
  initData: string | undefined;

  @ApiProperty({ required: false, description: 'Referral code' })
  @IsString()
  @IsOptional()
  referralCode?: string;
}

export class TelegramWidgetAuthDto {
  @ApiProperty({ description: 'Telegram user ID' })
  @IsNumber()
  id: number | undefined;

  @ApiProperty({ description: 'First name' })
  @IsString()
  first_name: string | undefined;

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
  auth_date: number | undefined;

  @ApiProperty({ description: 'Verification hash' })
  @IsString()
  hash: string | undefined;

  @ApiProperty({ required: false, description: 'Referral code' })
  @IsString()
  @IsOptional()
  referralCode?: string;
}

export class AuthResponseDto {
  token: string | undefined;
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
  } | undefined;
}