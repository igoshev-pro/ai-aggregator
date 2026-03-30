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

  let lastError: string | null = null;

  for (const { provider, modelId } of providers) {
    try {
      this.logger.debug(`generateTextStream via ${provider.getSlug()} with model ${modelId}`);

      const stream = provider.generateTextStream({
        ...request,
        model: modelId,
      });

      let hasContent = false;
      let streamError: string | null = null;

      for await (const chunk of stream) {
        // Проверяем наличие ошибки в чанке
        if ((chunk as any).error) {
          streamError = (chunk as any).error;
          this.logger.warn(
            `Stream chunk error from ${provider.getSlug()}: ${streamError}`,
          );
          break;
        }

        if (chunk.content && !chunk.content.startsWith('Error:')) {
          hasContent = true;
        }

        if (chunk.done && !hasContent && chunk.content?.startsWith('Error:')) {
          streamError = chunk.content;
          this.logger.warn(
            `Stream error from ${provider.getSlug()}: ${streamError}`,
          );
          break;
        }

        yield chunk;

        if (chunk.done) {
          return;
        }
      }

      if (streamError) {
        lastError = streamError;
        this.logger.warn(
          `Provider ${provider.getSlug()} failed for ${modelSlug}, trying next...`,
        );
        continue;
      }

      return;

    } catch (error) {
      // ═══ SAFE ERROR EXTRACTION — no circular JSON ═══
      let errorMsg: string;
      try {
        // Пробуем получить сообщение из response body
        if (error?.response?.status) {
          const status = error.response.status;
          let body = '';
          
          try {
            // Если data — стрим, читаем его
            if (error.response.data && typeof error.response.data.pipe === 'function') {
              const chunks: Buffer[] = [];
              for await (const chunk of error.response.data) {
                chunks.push(Buffer.from(chunk));
                if (chunks.length > 5) break;
              }
              body = Buffer.concat(chunks).toString('utf8').substring(0, 500);
            } 
            // Если data — строка
            else if (typeof error.response.data === 'string') {
              body = error.response.data.substring(0, 500);
            }
            // Если data — объект с error.message
            else if (error.response.data?.error?.message) {
              body = error.response.data.error.message;
            }
          } catch {
            body = '';
          }

          // Пробуем распарсить JSON из body
          if (body) {
            try {
              const parsed = JSON.parse(body);
              errorMsg = parsed?.error?.message 
                || parsed?.error?.metadata?.raw?.substring(0, 200) 
                || parsed?.message 
                || parsed?.msg 
                || body;
            } catch {
              // Может быть HTML — ищем <p> тег
              const match = body.match(/<p>(.*?)<\/p>/);
              errorMsg = match ? `${status}: ${match[1]}` : `${status}: ${body.substring(0, 200)}`;
            }
          } else {
            errorMsg = `HTTP ${status}: ${error.message}`;
          }
        } else {
          errorMsg = error?.message || 'Unknown error';
        }
      } catch {
        errorMsg = 'Unknown provider error';
      }

      this.logger.error(`${provider.getSlug()} generateTextStream error: ${errorMsg}`);
      lastError = errorMsg;
      continue;
    }
  }

  this.logger.error(`All providers failed for ${modelSlug}: ${lastError}`);
  yield {
    content: '',
    done: true,
    error: lastError || 'All providers failed',
  } as any;
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