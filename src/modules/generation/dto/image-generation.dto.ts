import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ImageGenerationDto {
  @ApiProperty({ description: 'Model slug', example: 'midjourney' })
  @IsString()
  modelSlug: string;

  @ApiProperty({ description: 'Prompt for image generation' })
  @IsString()
  @MaxLength(2000)
  prompt: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  negativePrompt?: string;

  @ApiProperty({ required: false, default: 1024 })
  @IsNumber()
  @IsOptional()
  @Min(256)
  @Max(2048)
  width?: number;

  @ApiProperty({ required: false, default: 1024 })
  @IsNumber()
  @IsOptional()
  @Min(256)
  @Max(2048)
  height?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(100)
  steps?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  seed?: number;

  @ApiProperty({ required: false, default: 1 })
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(4)
  numImages?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
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