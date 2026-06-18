// src/modules/generation/generation.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { GenerationService } from './generation.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import {
  ImageGenerationDto,
  VideoGenerationDto,
  AudioGenerationDto,
} from './dto/image-generation.dto';
import { CalculatePriceDto } from './dto/calculate-price.dto'; // 🆕
import { GenerationType } from '@/common/interfaces';
import { Throttle } from '@nestjs/throttler';

@ApiTags('Generation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('generation')
export class GenerationController {
  constructor(private readonly generationService: GenerationService) { }

  @Post('image')
  @ApiOperation({ summary: 'Generate image' })
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(202)
  async generateImage(
    @CurrentUser('sub') userId: string,
    @Body() dto: ImageGenerationDto,
  ) {
    const result = await this.generationService.generateImage(userId, dto);
    return { success: true, data: result };
  }

  @Post('video')
  @ApiOperation({ summary: 'Generate video' })
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @HttpCode(202)
  async generateVideo(
    @CurrentUser('sub') userId: string,
    @Body() dto: VideoGenerationDto,
  ) {
    const result = await this.generationService.generateVideo(userId, dto);
    return { success: true, data: result };
  }

  @Post('audio')
  @ApiOperation({ summary: 'Generate audio' })
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(202)
  async generateAudio(
    @CurrentUser('sub') userId: string,
    @Body() dto: AudioGenerationDto,
  ) {
    const result = await this.generationService.generateAudio(userId, dto);
    return { success: true, data: result };
  }

  // 🆕 ─── РАСЧЁТ ЦЕНЫ ───────────────────────────────────────────
  @Post('calculate-price')
  @ApiOperation({
    summary: 'Calculate generation price for given params',
    description:
      'Возвращает стоимость генерации в спичках и долларах. Используется фронтом для отображения цены перед нажатием "Сгенерировать". ' +
      'Если модель бесплатна по подписке пользователя и параметры подходят — вернёт costInTokens=0.',
  })
  @HttpCode(200)
  async calculatePrice(
    @CurrentUser('sub') userId: string,
    @Body() dto: CalculatePriceDto,
  ) {
    const result = await this.generationService.calculatePrice(
      dto.modelSlug,
      dto.params || {},
      userId, // 🆕 для проверки free-доступа
    );
    return { success: true, data: result };
  }

  // 🆕 ─── UI-КОНФИГ МОДЕЛИ ──────────────────────────────────────
  @Get('models/:slug/ui-config')
  @ApiOperation({
    summary: 'Get UI configuration for a model',
    description:
      'Возвращает uiParameters, pricingMatrix и inputCapabilities модели. Фронт использует это чтобы динамически нарисовать форму генерации и показать матрицу цен.',
  })
  async getModelUIConfig(@Param('slug') slug: string) {
    const result = await this.generationService.getModelUIConfig(slug);
    return { success: true, data: result };
  }

  @Get('status/:id')
  @ApiOperation({ summary: 'Get generation status' })
  async getStatus(
    @CurrentUser('sub') userId: string,
    @Param('id') generationId: string,
  ) {
    const result = await this.generationService.getGenerationStatus(
      userId,
      generationId,
    );
    return { success: true, data: result };
  }

  @Get('history')
  @ApiOperation({ summary: 'Get generation history' })
  @ApiQuery({ name: 'type', enum: GenerationType, required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getHistory(
    @CurrentUser('sub') userId: string,
    @Query('type') type?: GenerationType,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const result = await this.generationService.getUserGenerations(
      userId,
      type,
      page,
      limit,
    );
    return { success: true, data: result };
  }

  @Get('favorites')
  @ApiOperation({ summary: 'Get favorite generations' })
  async getFavorites(
    @CurrentUser('sub') userId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const result = await this.generationService.getFavorites(userId, page, limit);
    return { success: true, data: result };
  }

  @Put(':id/favorite')
  @ApiOperation({ summary: 'Toggle favorite' })
  async toggleFavorite(
    @CurrentUser('sub') userId: string,
    @Param('id') generationId: string,
  ) {
    const result = await this.generationService.toggleFavorite(userId, generationId);
    return { success: true, data: result };
  }
}