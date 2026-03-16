// src/modules/ai-providers/dto/model-access.dto.ts

import { IsString, IsEnum } from 'class-validator';
import { SubscriptionPlan } from '@/common/interfaces';

export class CheckModelAccessDto {
  @IsString()
  modelSlug: string;

  @IsEnum(SubscriptionPlan)
  userPlan: SubscriptionPlan;
}

export class ModelAccessResponseDto {
  hasAccess: boolean;
  reason?: string;
  requiredPlan?: SubscriptionPlan;
}