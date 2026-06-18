// src/modules/models/models.controller.ts

import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { GenerationType } from '@/common/interfaces';
import { ModelsService } from './models.service';

@ApiTags('Models')
@Controller('models')
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all available AI models' })
  @ApiQuery({ name: 'type', required: false, enum: GenerationType })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async getModels(
    @CurrentUser('sub') userId: string,
    @Query('type') type?: GenerationType,
  ) {
    // 🆕 Передаём userId — сервис сам достанет план юзера из БД
    // и пометит free-модели + лимиты
    const models = await this.modelsService.getAvailableModels(userId, type);

    return {
      success: true,
      data: models,
    };
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get model details by slug' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async getModelBySlug(
    @CurrentUser('sub') userId: string,
    @Param('slug') slug: string,
  ) {
    const model = await this.modelsService.getModelDetails(slug, userId);

    if (!model) {
      throw new NotFoundException('Model not found');
    }

    return {
      success: true,
      data: model,
    };
  }
}