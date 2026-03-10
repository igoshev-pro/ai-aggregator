import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AiProvidersService } from './ai-providers.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { GenerationType } from '@/common/interfaces';

@ApiTags('AI Models')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('models')
export class AiProvidersController {
  constructor(private readonly aiProvidersService: AiProvidersService) {}

  @Get()
  @ApiOperation({ summary: 'Get all available AI models' })
  @ApiQuery({ name: 'type', enum: GenerationType, required: false })
  async getModels(@Query('type') type?: GenerationType) {
    const models = type
      ? await this.aiProvidersService.getModelsByType(type)
      : await this.aiProvidersService.getAllModels();

    return {
      success: true,
      data: models.map((m) => ({
        slug: m.slug,
        name: m.name,
        displayName: m.displayName,
        description: m.description,
        icon: m.icon,
        type: m.type,
        tokenCost: m.tokenCost,
        isPremium: m.isPremium,
        capabilities: m.capabilities,
        defaultParams: m.defaultParams,
        limits: m.limits,
      })),
    };
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get model details by slug' })
  async getModel(@Param('slug') slug: string) {
    const model = await this.aiProvidersService.getModelBySlug(slug);
    return {
      success: true,
      data: {
        slug: model.slug,
        name: model.name,
        displayName: model.displayName,
        description: model.description,
        icon: model.icon,
        type: model.type,
        tokenCost: model.tokenCost,
        isPremium: model.isPremium,
        capabilities: model.capabilities,
        defaultParams: model.defaultParams,
        limits: model.limits,
        stats: model.stats,
      },
    };
  }
}