import {
  IsEnum,
  IsOptional,
  IsNumber,
  IsString,
  IsBoolean,
  IsDateString,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionPlan } from '@/common/interfaces';

export class SetSubscriptionDto {
  @ApiProperty({
    enum: SubscriptionPlan,
    description: 'Целевой план. "free" — снимает подписку.',
  })
  @IsEnum(SubscriptionPlan)
  plan: SubscriptionPlan;

  @ApiPropertyOptional({
    description:
      'Длительность в днях. Игнорируется для plan=free и если указан expiresAt.',
    minimum: 1,
    maximum: 3650,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(3650)
  durationDays?: number;

  @ApiPropertyOptional({
    description:
      'ISO дата окончания. Имеет приоритет над durationDays.',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({
    description:
      'Начислять ли tokensPerMonth + bonusTokens плана. По умолчанию false (для тестов).',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  grantTokens?: boolean;

  @ApiPropertyOptional({ description: 'Причина (для аудита)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}