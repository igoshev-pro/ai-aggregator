// src/modules/admin/dto/model.dto.ts
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { GenerationType } from '@/common/interfaces';

export class ModelsFilterDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsEnum(GenerationType) type?: GenerationType;
  @IsOptional() isActive?: string;   // 'true' | 'false' | undefined
  @IsOptional() isPremium?: string;
}

export class UpdateModelDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsEnum(GenerationType) type?: GenerationType;

  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isPremium?: boolean;
  @IsOptional() @IsBoolean() supportsVision?: boolean;

  @IsOptional() @IsInt() sortOrder?: number;

  @IsOptional() @IsNumber() @Min(0) costPerMillionInputTokens?: number;
  @IsOptional() @IsNumber() @Min(0) costPerMillionOutputTokens?: number;
  @IsOptional() @IsNumber() @Min(0) fixedCostPerGeneration?: number;
  @IsOptional() @IsNumber() @Min(0) tokensPerDollar?: number;
  @IsOptional() @IsInt() @Min(0) minTokenCost?: number;
  @IsOptional() @IsNumber() @Min(0) tokenCost?: number;

  @IsOptional() @IsArray() @IsString({ each: true }) capabilities?: string[];

  @IsOptional()
  @IsArray()
  uiParameters?: any[]

  @IsOptional()
  @IsArray()
  pricingMatrix?: any[]

  @IsOptional()
  @IsObject()
  inputCapabilities?: Record<string, any>

  @IsOptional()
  @IsObject()
  defaultParams?: Record<string, any>
}

export class CreateModelDto extends UpdateModelDto {
  @IsString() slug: string;
  @IsString() name: string;
  @IsString() displayName: string;
  @IsEnum(GenerationType) type: GenerationType;
}