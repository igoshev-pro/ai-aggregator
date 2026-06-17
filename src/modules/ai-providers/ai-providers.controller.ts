// src/modules/ai-providers/ai-providers.controller.ts




import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Inject,
  forwardRef,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { AiProvidersService } from './ai-providers.service';
import { BillingService } from '../billing/billing.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { GenerationType } from '@/common/interfaces';




@ApiTags('AI Models')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('models')
export class AiProvidersController {
  constructor(
    private readonly aiProvidersService: AiProvidersService,
    @Inject(forwardRef(() => BillingService))
    private readonly billingService: BillingService,
  ) { }




  // ═══════════════════════════════════════════════════════════════
  // GET /models — список всех моделей (с preview-ценой для UI)
  // ═══════════════════════════════════════════════════════════════




  @Get()
  @ApiOperation({ summary: 'Get all available AI models with preview pricing' })
  @ApiQuery({ name: 'type', enum: GenerationType, required: false })
  async getModels(@Query('type') type?: GenerationType) {
    const models = type
      ? await this.aiProvidersService.getModelsByType(type)
      : await this.aiProvidersService.getAllModels();




    // 🆕 Параллельно достаём preview-цены для всех моделей
    const data = await Promise.all(
      models.map(async (m) => {
        let preview: any = null;
        try {
          preview = await this.billingService.getModelPreviewCost(m.slug);
        } catch {
          // Если что-то пошло не так — preview = null, фронт это переварит
        }




        return {
          slug: m.slug,
          name: m.name,
          displayName: m.displayName,
          description: m.description,
          icon: m.icon,
          type: m.type,
          isPremium: m.isPremium,
          supportsVision: (m as any).supportsVision || false,
          capabilities: m.capabilities,
          inputCapabilities: m.inputCapabilities || {},
          defaultParams: m.defaultParams,
          limits: m.limits,




          // 🆕 Preview цены (avg/min/max в 🔥 спичках)
          preview,




          // 🆕 UI параметры для динамической формы (для media-моделей)
          uiParameters: m.uiParameters || [],


          // 🆕 Эти 2 строки — НОВЫЕ
          charBasedPricing: (m as any).charBasedPricing || false,
          pricePerThousandChars: (m as any).pricePerThousandChars || 0,

          // ⚠️ DEPRECATED — оставляем для обратной совместимости
          // Старый фронт может использовать tokenCost — отдаём avgCost
          tokenCost: preview?.avgCostInTokens ?? m.tokenCost ?? 0,
        };
      }),
    );




    return {
      success: true,
      data,
    };
  }




  // ═══════════════════════════════════════════════════════════════
  // GET /models/:slug — детали одной модели
  // ═══════════════════════════════════════════════════════════════




  @Get(':slug')
  @ApiOperation({ summary: 'Get model details by slug (with full pricing)' })
  async getModel(@Param('slug') slug: string) {
    const model = await this.aiProvidersService.getModelBySlug(slug);




    let preview: any = null;
    try {
      preview = await this.billingService.getModelPreviewCost(slug);
    } catch {
      // ignore
    }




    return {
      success: true,
      data: {
        slug: model.slug,
        name: model.name,
        displayName: model.displayName,
        description: model.description,
        icon: model.icon,
        type: model.type,
        isPremium: model.isPremium,
        supportsVision: (model as any).supportsVision || false,
        capabilities: model.capabilities,
        inputCapabilities: model.inputCapabilities || {},
        defaultParams: model.defaultParams,
        limits: model.limits,
        stats: model.stats,




        // 🆕 Preview цены
        preview,




        // 🆕 UI параметры для динамической формы
        uiParameters: model.uiParameters || [],




        // 🆕 Pricing matrix (для media-моделей)
        pricingMatrix: model.pricingMatrix || [],

        // 🆕 Эти 2 строки — НОВЫЕ
        charBasedPricing: (model as any).charBasedPricing || false,
        pricePerThousandChars: (model as any).pricePerThousandChars || 0,


        // ⚠️ DEPRECATED
        tokenCost: preview?.avgCostInTokens ?? model.tokenCost ?? 0,
      },
    };
  }




  // ═══════════════════════════════════════════════════════════════
  // 🆕 GET /models/:slug/pricing — полная инфа о ценах
  // Используется на странице модели / в админке
  // ═══════════════════════════════════════════════════════════════




  @Get(':slug/pricing')
  @ApiOperation({
    summary: 'Get full pricing details for a model (preview + matrix + UI params)',
  })
  async getModelPricing(@Param('slug') slug: string) {
    const pricing = await this.billingService.getModelPricing(slug);
    return {
      success: true,
      data: pricing,
    };
  }




  // ═══════════════════════════════════════════════════════════════
  // 🆕 GET /models/:slug/preview-cost — короткий ответ для бейджа в чате
  // Возвращает только avg/min/max в 🔥 — минимум данных для UI
  // ═══════════════════════════════════════════════════════════════




  @Get(':slug/preview-cost')
  @ApiOperation({
    summary: 'Get model preview cost (avg/min/max in 🔥) — for chat badge',
  })
  async getModelPreviewCost(@Param('slug') slug: string) {
    const preview = await this.billingService.getModelPreviewCost(slug);
    return {
      success: true,
      data: preview,
    };
  }




  // ═══════════════════════════════════════════════════════════════
  // 🆕 POST /models/:slug/estimate-cost — оценка стоимости с параметрами
  // ═══════════════════════════════════════════════════════════════
  // 
  // Если фронт хочет показать точную цену под конкретные параметры
  // (например, video с resolution=2K, mode=turbo), используется этот метод.
  // 
  // Принимает params в body, возвращает costInTokens с учётом pricingMatrix.
  // ═══════════════════════════════════════════════════════════════




  @Get(':slug/estimate')
  @ApiOperation({
    summary: 'Estimate cost for a model with specific parameters',
  })
  @ApiQuery({ name: 'params', required: false, type: String, description: 'JSON-encoded params object' })
  async estimateCost(
    @Param('slug') slug: string,
    @Query('params') paramsRaw?: string,
  ) {
    let params: Record<string, any> | undefined;
    if (paramsRaw) {
      try {
        params = JSON.parse(paramsRaw);
      } catch {
        params = undefined;
      }
    }




    const result = await this.billingService.estimateGenerationCost(
      slug,
      params,
    );




    return {
      success: true,
      data: result,
    };
  }
}