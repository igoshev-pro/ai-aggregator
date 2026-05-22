import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class PurchasePackDto {
  @ApiProperty() @IsNumber() @Min(1) tokens: number;
  @ApiProperty() @IsNumber() @Min(0) priceRub: number;
  @ApiProperty() @IsNumber() @Min(0) bonusTokens: number;
  @ApiPropertyOptional() @IsOptional() @IsString() label?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() highlight?: boolean;
}

export class UpdateTokenomicsDto {
  @ApiProperty() @IsNumber() @Min(0) tokenToDollarRate: number;
  @ApiProperty() @IsNumber() @Min(0) freeTokensOnSignup: number;
  @ApiProperty() @IsNumber() @Min(1) minPurchaseTokens: number;
  @ApiProperty() @IsBoolean() refundOnError: boolean;

  @ApiProperty({ type: [PurchasePackDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchasePackDto)
  purchasePacks: PurchasePackDto[];
}