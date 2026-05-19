// src/modules/generation/dto/calculate-price.dto.ts
import { IsString, IsObject, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CalculatePriceDto {
  @ApiProperty({
    example: 'midjourney',
    description: 'Slug модели для расчёта цены',
  })
  @IsString()
  modelSlug: string;

  @ApiPropertyOptional({
    example: {
      mode: 'turbo',
      aspectRatio: '16:9',
      hasInputImage: false,
    },
    description:
      'Параметры, влияющие на цену (mode, version, resolution, duration, quality, sound, hasInputImage, и т.д.)',
  })
  @IsOptional()
  @IsObject()
  params?: Record<string, any>;
}