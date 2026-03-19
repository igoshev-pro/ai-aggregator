import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AIModel, ModelDocument } from './schemas/model.schema';
import { Provider, ProviderDocument } from './schemas/provider.schema';
import { ProviderRegistryService } from './providers/provider-registry.service';
import {
  GenerationResult,
  TextGenerationRequest,
  ImageGenerationRequest,
  VideoGenerationRequest,
  AudioGenerationRequest,
  StreamChunk,
  TaskStatusResult,
} from './providers/base-provider.abstract';
import { GenerationType, SubscriptionPlan } from '@/common/interfaces';
import { ModelAccessResponseDto } from './dto/model-access.dto';

@Injectable()
export class AiProvidersService {
  private readonly logger = new Logger(AiProvidersService.name);

  constructor(
    @InjectModel(AIModel.name) private modelModel: Model<ModelDocument>,
    @InjectModel(Provider.name) private providerModel: Model<ProviderDocument>,
    private registry: ProviderRegistryService,
  ) { }

  async getModelsByType(type: GenerationType): Promise<ModelDocument[]> {
    return this.modelModel.find({ type, isActive: true }).sort({ sortOrder: 1 }).exec();
  }

  async getAllModels(): Promise<ModelDocument[]> {
    return this.modelModel.find({ isActive: true }).sort({ type: 1, sortOrder: 1 }).exec();
  }

  async getModelBySlug(slug: string): Promise<ModelDocument> {
    const model = await this.modelModel.findOne({ slug, isActive: true });
    if (!model) throw new NotFoundException(`Model ${slug} not found or disabled`);
    return model;
  }

  async getModelCost(slug: string): Promise<number> {
    const model = await this.getModelBySlug(slug);
    return model.tokenCost || model.minTokenCost;
  }

  async generateText(
    modelSlug: string,
    request: Omit<TextGenerationRequest, 'model'>,
  ): Promise<GenerationResult> {
    return this.executeWithFallback(modelSlug, 'generateText', request);
  }

  async *generateTextStream(
  modelSlug: string,
  request: Omit<TextGenerationRequest, 'model'>,
): AsyncGenerator<StreamChunk> {
  const providers = await this.registry.getProvidersForModel(modelSlug);

  if (providers.length === 0) {
    throw new BadRequestException(`No providers available for ${modelSlug}`);
  }

  let lastError: GenerationResult | null = null;

  for (const { provider, modelId } of providers) {
    try {
      this.logger.debug(`generateTextStream via ${provider.getSlug()} with model ${modelId}`);
      
      // Запускаем стриминг у провайдера
      const stream = provider.generateTextStream({
        ...request,
        model: modelId,
      });

      for await (const chunk of stream) {
        yield chunk;
      }

      // Если успешный поток, выходим из цикла
      return;
    } catch (error) {
      this.logger.error(`${provider.getSlug()} generateTextStream error: ${error.message}`);
      lastError = {
        success: false,
        error: {
          code: 'PROVIDER_ERROR',
          message: error.message,
          retryable: true,
        },
        responseTimeMs: 0,
        providerSlug: provider.getSlug(),
      };
      // Продолжаем попытку с другим провайдером
    }
  }

  // Если все провайдеры не сработали, пробрасываем ошибку
  throw new BadRequestException(lastError?.error.message || 'All providers failed to stream text');
}

  async generateImage(
    modelSlug: string,
    request: Omit<ImageGenerationRequest, 'model'>,
  ): Promise<GenerationResult> {
    return this.executeWithFallback(modelSlug, 'generateImage', request);
  }

  async generateVideo(
    modelSlug: string,
    request: Omit<VideoGenerationRequest, 'model'>,
  ): Promise<GenerationResult> {
    return this.executeWithFallback(modelSlug, 'generateVideo', request);
  }

  async generateAudio(
    modelSlug: string,
    request: Omit<AudioGenerationRequest, 'model'>,
  ): Promise<GenerationResult> {
    return this.executeWithFallback(modelSlug, 'generateAudio', request);
  }

  async checkTaskStatus(
    providerSlug: string,
    taskId: string,
  ): Promise<TaskStatusResult> {
    const provider = this.registry.getProvider(providerSlug);
    if (!provider) return { status: 'failed', error: `Provider ${providerSlug} not found` };
    return provider.checkTaskStatus(taskId);
  }

  async getAllProviders(): Promise<ProviderDocument[]> {
    return this.providerModel.find().sort({ priority: 1 }).exec();
  }

  async updateProvider(slug: string, updates: Partial<Provider>): Promise<ProviderDocument> {
    const provider = await this.providerModel.findOneAndUpdate(
      { slug },
      { $set: updates },
      { new: true },
    );
    if (!provider) throw new NotFoundException(`Provider ${slug} not found`);
    return provider;
  }

  async updateModel(slug: string, updates: Partial<AIModel>): Promise<ModelDocument> {
    const model = await this.modelModel.findOneAndUpdate(
      { slug },
      { $set: updates },
      { new: true },
    );
    if (!model) throw new NotFoundException(`Model ${slug} not found`);
    return model;
  }

  private async executeWithFallback(
    modelSlug: string,
    method: 'generateImage' | 'generateVideo' | 'generateAudio' | 'generateText' | 'generateLyrics',
    request: any,
  ): Promise<GenerationResult> {
    const providers = await this.registry.getProvidersForModel(modelSlug);

    if (providers.length === 0) {
      throw new BadRequestException(`No providers available for ${modelSlug}`);
    }

    let lastError: GenerationResult | null = null;

    for (const { provider, modelId } of providers) {
      try {
        this.logger.debug(
          `${method} via ${provider.getSlug()} with model ${modelId}`,
        );

        const result = await provider[method]({
          ...request,
          model: modelId,
        });

        await this.registry.updateProviderStats(
          provider.getSlug(),
          result.responseTimeMs,
          result.success,
        );

        if (result.success) {
          await this.updateModelStats(modelSlug, result.responseTimeMs, true);
          return result;
        }

        if (result.error?.retryable) {
          lastError = result;
          continue;
        }

        return result;
      } catch (error) {
        this.logger.error(
          `${method} error from ${provider.getSlug()}: ${error.message}`,
        );
        lastError = {
          success: false,
          error: {
            code: 'PROVIDER_ERROR',
            message: error.message,
            retryable: true,
          },
          responseTimeMs: 0,
          providerSlug: provider.getSlug(),
        };
      }
    }

    await this.updateModelStats(modelSlug, 0, false);
    return lastError || {
      success: false,
      error: {
        code: 'ALL_PROVIDERS_FAILED',
        message: `All providers failed for ${modelSlug}`,
        retryable: false,
      },
      responseTimeMs: 0,
      providerSlug: 'none',
    };
  }

  private async updateModelStats(
    modelSlug: string,
    responseTimeMs: number,
    success: boolean,
  ) {
    const model = await this.modelModel.findOne({ slug: modelSlug });
    if (!model) return;

    const stats = model.stats || { totalRequests: 0, avgResponseTime: 0, successRate: 100 };
    const total = stats.totalRequests + 1;
    const successCount = Math.round((stats.successRate / 100) * stats.totalRequests);

    await this.modelModel.findOneAndUpdate(
      { slug: modelSlug },
      {
        $set: {
          'stats.totalRequests': total,
          'stats.avgResponseTime':
            (stats.avgResponseTime * stats.totalRequests + responseTimeMs) / total,
          'stats.successRate':
            ((successCount + (success ? 1 : 0)) / total) * 100,
        },
      },
    );
  }

  // Добавить в ai-providers.service.ts

  async checkModelAccess(
    modelSlug: string,
    userPlan: SubscriptionPlan,
  ): Promise<ModelAccessResponseDto> {
    const model = await this.getModelBySlug(modelSlug);

    // Если модель не премиум - доступна всем
    if (!model.isPremium) {
      return { hasAccess: true };
    }

    // Проверяем includedInPlans
    const includedPlans = model.limits?.includedInPlans || [];

    if (includedPlans.length === 0) {
      // Если не указаны планы - доступна всем премиум пользователям
      if (userPlan === SubscriptionPlan.PRO || userPlan === SubscriptionPlan.UNLIMITED) {
        return { hasAccess: true };
      }
    } else {
      // Проверяем конкретные планы
      if (includedPlans.includes(userPlan)) {
        return { hasAccess: true };
      }
    }

    // Определяем минимально необходимый план
    let requiredPlan = SubscriptionPlan.PRO;
    if (includedPlans.includes(SubscriptionPlan.UNLIMITED) && !includedPlans.includes(SubscriptionPlan.PRO)) {
      requiredPlan = SubscriptionPlan.UNLIMITED;
    }

    return {
      hasAccess: false,
      reason: `This model requires ${requiredPlan} subscription`,
      requiredPlan,
    };
  }

  // Добавить фильтрацию моделей по подписке
  async getAvailableModelsForUser(
    userPlan: SubscriptionPlan,
    type?: GenerationType,
  ): Promise<ModelDocument[]> {
    const query: any = { isActive: true };
    if (type) query.type = type;

    const models = await this.modelModel
      .find(query)
      .sort({ type: 1, sortOrder: 1 })
      .exec();

    // Фильтруем по доступности
    const availableModels: ModelDocument[] = [];
    for (const model of models) {
      const access = await this.checkModelAccess(model.slug, userPlan);
      if (access.hasAccess) {
        availableModels.push(model);
      }
    }

    return availableModels;
  }
}