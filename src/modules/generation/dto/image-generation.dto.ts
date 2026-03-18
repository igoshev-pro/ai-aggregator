import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  Min,
  Max,
  MaxLength,
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
  @ApiProperty({ example: 'sora-2-txt2vid' })
  @IsString()
  modelSlug: string;

  @ApiProperty()
  @IsString()
  @MaxLength(10000)
  prompt: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  negativePrompt?: string;

  @ApiPropertyOptional({ description: 'Image URL for img2video (single image)' })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'Array of image URLs (for models supporting multiple)' })
  @IsOptional()
  @IsArray()
  imageUrls?: string[];

  @ApiPropertyOptional({ default: 5, description: 'Duration in seconds' })
  @IsNumber()
  @IsOptional()
  @Min(3)
  @Max(15)
  duration?: number;

  @ApiPropertyOptional({ enum: ['16:9', '9:16', '1:1', '4:3', '3:4', 'portrait', 'landscape'] })
  @IsString()
  @IsOptional()
  aspectRatio?: string;

  @ApiPropertyOptional({ enum: ['720p', '1080p', '768P', '1080P', 'std', 'pro'] })
  @IsString()
  @IsOptional()
  resolution?: string;

  @ApiPropertyOptional({ enum: ['std', 'pro'], description: 'Kling mode: std (720p) or pro (1080p)' })
  @IsString()
  @IsOptional()
  mode?: string;

  @ApiPropertyOptional({ enum: ['standard', 'high'], description: 'Sora Pro size quality' })
  @IsString()
  @IsOptional()
  quality?: string;

  @ApiPropertyOptional({ description: 'Enable sound effects (Kling)' })
  @IsOptional()
  @IsBoolean()
  sound?: boolean;

  @ApiPropertyOptional({ description: 'Remove watermark (Sora)' })
  @IsOptional()
  @IsBoolean()
  removeWatermark?: boolean;

  @ApiPropertyOptional({ description: 'Watermark text (Runway)' })
  @IsString()
  @IsOptional()
  waterMark?: string;

  @ApiPropertyOptional({ description: 'Prompt optimizer (Hailuo)' })
  @IsOptional()
  @IsBoolean()
  promptOptimizer?: boolean;

  @ApiPropertyOptional()
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

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  style?: string;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  @Min(5)
  @Max(300)
  duration?: number;

  @ApiPropertyOptional()
  @IsOptional()
  instrumental?: boolean;

  @ApiPropertyOptional({ description: 'Voice ID for ElevenLabs' })
  @IsString()
  @IsOptional()
  voiceId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  language?: string;
}