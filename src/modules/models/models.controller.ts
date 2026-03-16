// src/modules/models/models.controller.ts

import {
    Controller,
    Get,
    Param,
    Query,
    UseGuards,
    NotFoundException,
  } from '@nestjs/common';
  import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
  import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
  import { CurrentUser } from '@/common/decorators/current-user.decorator';
  import { GenerationType, SubscriptionPlan } from '@/common/interfaces';
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
      @CurrentUser('role') userRole: string,
      @Query('type') type?: GenerationType,
    ) {
      // Определяем план подписки по роли
      const userPlan = this.roleToSubscriptionPlan(userRole);
      const models = await this.modelsService.getAvailableModels(userPlan, type);
      
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
      @CurrentUser('role') userRole: string,
      @Param('slug') slug: string,
    ) {
      const userPlan = this.roleToSubscriptionPlan(userRole);
      const model = await this.modelsService.getModelDetails(slug, userPlan);
      
      if (!model) {
        throw new NotFoundException('Model not found');
      }
      
      return {
        success: true,
        data: model,
      };
    }
  
    private roleToSubscriptionPlan(role: string): SubscriptionPlan {
      switch (role) {
        case 'premium':
          return SubscriptionPlan.PRO;
        case 'admin':
        case 'super_admin':
          return SubscriptionPlan.UNLIMITED;
        default:
          return SubscriptionPlan.FREE;
      }
    }
  }