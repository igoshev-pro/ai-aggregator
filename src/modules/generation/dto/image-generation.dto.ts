import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  Min,
  Max,
  MaxLength,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ImageGenerationDto {
  @ApiProperty()
  @IsString()
  modelSlug: string;

  @ApiProperty()
  @IsString()
  prompt: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  negativePrompt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  width?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  height?: number;

  // ← НОВЫЕ ПОЛЯ для kie.ai
  @ApiPropertyOptional({ description: 'Aspect ratio: 1:1, 16:9, 9:16, etc.' })
  @IsOptional()
  @IsString()
  aspectRatio?: string;

  @ApiPropertyOptional({ description: 'Resolution: 1K, 2K, 4K' })
  @IsOptional()
  @IsString()
  resolution?: string;

  @ApiPropertyOptional({ description: 'Quality for Seedream: basic, high' })
  @IsOptional()
  @IsString()
  quality?: string;

  @ApiPropertyOptional({ description: 'Output format: png, jpg' })
  @IsOptional()
  @IsString()
  outputFormat?: string;

  @ApiPropertyOptional({ description: 'Input images for img2img (URLs)' })
  @IsOptional()
  @IsArray()
  inputUrls?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  steps?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  seed?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  numImages?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  style?: string;
}

export class VideoGenerationDto {
  @ApiProperty({ example: 'kling-1.6' })
  @IsString()
  modelSlug: string;

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  prompt: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  negativePrompt?: string;

  @ApiProperty({ required: false, description: 'Image URL for img2video' })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiProperty({ required: false, default: 5 })
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(30)
  duration?: number;

  @ApiProperty({ required: false, enum: ['16:9', '9:16', '1:1', '4:3'] })
  @IsString()
  @IsOptional()
  aspectRatio?: string;

  @ApiProperty({ required: false, enum: ['480p', '720p', '1080p'] })
  @IsString()
  @IsOptional()
  resolution?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  style?: string;
}

export class AudioGenerationDto {
  @ApiProperty({ example: 'suno-v4' })
  @IsString()
  modelSlug: string;

  @ApiProperty({ description: 'Prompt/lyrics for music or text for TTS' })
  @IsString()
  @MaxLength(5000)
  prompt: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  style?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  @Min(5)
  @Max(300)
  duration?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  instrumental?: boolean;

  @ApiProperty({ required: false, description: 'Voice ID for ElevenLabs' })
  @IsString()
  @IsOptional()
  voiceId?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  language?: string;
}