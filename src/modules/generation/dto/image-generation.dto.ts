// src/modules/generation/dto/image-generation.dto.ts
// ПОЛНЫЙ ФАЙЛ — копировать целиком

import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  Min,
  Max,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

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

  // 🆕 Midjourney mode: normal | fast | turbo
  @ApiPropertyOptional({
    enum: ['normal', 'fast', 'turbo'],
    description: 'Midjourney mode: normal/fast/turbo (влияет на цену)',
  })
  @IsOptional()
  @IsString()
  mode?: string;

  // 🆕 Flux version: normal | pro
  @ApiPropertyOptional({
    enum: ['normal', 'pro'],
    description: 'Flux version: normal/pro (Pro дороже)',
  })
  @IsOptional()
  @IsString()
  version?: string;
}

// 🆕 Kling 3.0 multi-shot prompt
export class KlingShotDto {
  @ApiProperty({ description: 'Shot prompt text (max 500 chars)' })
  @IsString()
  @MaxLength(500)
  prompt: string;

  @ApiProperty({ description: 'Shot duration 1-12 sec' })
  @IsNumber()
  @Min(1)
  @Max(12)
  duration: number;
}

// 🆕 Kling 3.0 element (named reference)
export class KlingElementDto {
  @ApiProperty({ description: 'Element name (referenced via @name in prompt)' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'Element description' })
  @IsString()
  @MaxLength(500)
  description: string;

  @ApiProperty({ description: 'Element image URLs (2-4 required)' })
  @IsArray()
  elementInputUrls: string[];
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

  @ApiPropertyOptional({
    description: 'Array of image URLs (for models supporting multiple)',
  })
  @IsOptional()
  @IsArray()
  imageUrls?: string[];

  // 🆕 Video URLs для Kling motion-control
  @ApiPropertyOptional({
    description: 'Array of video URLs (for Kling motion-control)',
  })
  @IsOptional()
  @IsArray()
  videoUrls?: string[];

  // 🆕 Motion Control: ориентация персонажа (image=до 10с / video=до 30с)
  @ApiPropertyOptional({
    enum: ['image', 'video'],
    description: 'Motion Control: character orientation source',
  })
  @IsOptional()
  @IsString()
  characterOrientation?: string;

  @ApiPropertyOptional({ default: 5, description: 'Duration in seconds' })
  @IsNumber()
  @IsOptional()
  @Min(3)
  @Max(30)
  duration?: number;

  @ApiPropertyOptional({
    enum: ['16:9', '9:16', '1:1', '4:3', '3:4', 'portrait', 'landscape'],
  })
  @IsString()
  @IsOptional()
  aspectRatio?: string;

  @ApiPropertyOptional({
    enum: ['720p', '1080p', '4k', '768P', '1080P', 'std', 'pro'],
  })
  @IsString()
  @IsOptional()
  resolution?: string;

  @ApiPropertyOptional({
    enum: ['std', 'pro'],
    description: 'Kling mode: std (720p) or pro (1080p)',
  })
  @IsString()
  @IsOptional()
  mode?: string;

  @ApiPropertyOptional({
    enum: ['standard', 'high'],
    description: 'Sora Pro size quality',
  })
  @IsString()
  @IsOptional()
  quality?: string;

  @ApiPropertyOptional({ description: 'Enable sound effects (Kling)' })
  @IsOptional()
  @IsBoolean()
  sound?: boolean;

  // 🆕 Veo: генерация звука (Google Veo использует отдельный флаг)
  @ApiPropertyOptional({ description: 'Generate audio track (Veo)' })
  @IsOptional()
  @IsBoolean()
  generateAudio?: boolean;

  // 🆕 Sora stable mode (зарезервировано на будущее)
  @ApiPropertyOptional({
    description: 'Sora stable mode (reserved for future use)',
  })
  @IsOptional()
  @IsBoolean()
  stable?: boolean;

  @ApiPropertyOptional({ description: 'Remove watermark (Sora)' })
  @IsOptional()
  @IsBoolean()
  removeWatermark?: boolean;

  @ApiPropertyOptional({ description: 'Watermark text (Runway)' })
  @IsString()
  @IsOptional()
  waterMark?: string;

  @ApiPropertyOptional({
  enum: ['crop', 'pad'],
  description: 'Как вписать изображение в видео (только для img2video Sora)',
})
@IsOptional()
@IsString()
resizeMode?: string;

  @ApiPropertyOptional({ description: 'Prompt optimizer (Hailuo)' })
  @IsOptional()
  @IsBoolean()
  promptOptimizer?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  style?: string;

  // 🆕 Reference images for Veo REFERENCE_2_VIDEO (1-3 URLs)
  @ApiPropertyOptional({
    description: 'Reference image URLs for Veo reference-to-video (1-3)',
  })
  @IsOptional()
  @IsArray()
  referenceImages?: string[];

  // 🆕 Veo generation mode override
  @ApiPropertyOptional({
    enum: ['TEXT_2_VIDEO', 'FIRST_AND_LAST_FRAMES_2_VIDEO', 'REFERENCE_2_VIDEO'],
    description: 'Veo generation mode (auto-detected if omitted)',
  })
  @IsOptional()
  @IsString()
  generationType?: string;

  // 🆕 Veo watermark text
  @ApiPropertyOptional({ description: 'Watermark text (Veo)' })
  @IsOptional()
  @IsString()
  watermark?: string;

    // 🆕 Kling 3.0: multi-shots mode
  @ApiPropertyOptional({ description: 'Kling: enable multi-shot mode' })
  @IsOptional()
  @IsBoolean()
  multiShots?: boolean;

  // 🆕 Kling 3.0: shots array (up to 5)
  @ApiPropertyOptional({
    description: 'Kling: shot prompts array (up to 5)',
    type: [KlingShotDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KlingShotDto)
  multiPrompt?: KlingShotDto[];

  // 🆕 Kling 3.0: referenced elements (up to 3)
  @ApiPropertyOptional({
    description: 'Kling: referenced elements (up to 3)',
    type: [KlingElementDto],
  })
  @IsOptional()
  @IsArray()
    @ValidateNested({ each: true })
  @Type(() => KlingElementDto)
  klingElements?: KlingElementDto[];

  // 🆕 Kling 2.5 Turbo: cfg scale (креативность) 0-1
  @ApiPropertyOptional({ description: 'Kling 2.5: CFG scale 0-1 (creativity)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  cfgScale?: number;

  // 🆕 Kling 2.5 Turbo: NSFW checker
  @ApiPropertyOptional({ description: 'Kling 2.5: NSFW checker' })
  @IsOptional()
  @IsBoolean()
  nsfwChecker?: boolean;
}

export class DialogueLineDto {
  @ApiProperty({ description: 'Text of the dialogue line' })
  @IsString()
  text: string;

  @ApiProperty({ description: 'Voice name for this line' })
  @IsString()
  voice: string;
}

export class AudioGenerationDto {
  @ApiProperty({ example: 'suno-v4' })
  @IsString()
  modelSlug: string;

  @ApiProperty({ description: 'Prompt/lyrics for music or text for TTS' })
  @IsString()
  @MaxLength(5000)
  prompt: string;

  @ApiPropertyOptional({ description: 'Music style: pop, rock, jazz...' })
  @IsString()
  @IsOptional()
  style?: string;

  @ApiPropertyOptional({ description: 'Duration in seconds (Suno)' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(300)
  duration?: number;

  @ApiPropertyOptional({ description: 'Instrumental only, no vocals (Suno)' })
  @IsOptional()
  @IsBoolean()
  instrumental?: boolean;

  @ApiPropertyOptional({ description: 'Custom mode for Suno' })
  @IsOptional()
  @IsBoolean()
  customMode?: boolean;

  // 🆕 Suno operation type
  @ApiPropertyOptional({
    enum: [
      'generate',
      'extend',
      'boost',
      'cover',
      'persona',
      'stems',
      'instrumental',
      'lyrics',
      'video',
    ],
    description:
      'Suno operation type: generate/extend/boost/cover/persona/stems/instrumental/lyrics/video',
  })
  @IsOptional()
  @IsString()
  operation?: string;

  // 🆕 Suno track title
  @ApiPropertyOptional({ description: 'Track title (Suno)' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Voice ID for ElevenLabs TTS' })
  @IsString()
  @IsOptional()
  voiceId?: string;

  @ApiPropertyOptional({ description: 'Language code: ru, en, etc.' })
  @IsString()
  @IsOptional()
  language?: string;

  @ApiPropertyOptional({ description: 'Voice stability 0-1 (ElevenLabs)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  stability?: number;

  @ApiPropertyOptional({ description: 'Voice similarity 0-1 (ElevenLabs)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  similarity?: number;

  @ApiPropertyOptional({ description: 'Speech speed 0.5-2 (ElevenLabs)' })
  @IsNumber()
  @IsOptional()
  @Min(0.25)
  @Max(4)
  speed?: number;

  @ApiPropertyOptional({ description: 'Loop audio (ElevenLabs SFX)' })
  @IsOptional()
  @IsBoolean()
  loop?: boolean;

  @ApiPropertyOptional({
    description: 'Prompt influence 0-1 (ElevenLabs SFX)',
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(1)
  promptInfluence?: number;

  @ApiPropertyOptional({
    description: 'Audio URL for processing (isolation/STT)',
  })
  @IsString()
  @IsOptional()
  audioUrl?: string;

  @ApiPropertyOptional({
    description:
      'Dialogue lines array for text-to-dialogue (each with text + voice)',
    type: [DialogueLineDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DialogueLineDto)
  dialogue?: DialogueLineDto[];
}