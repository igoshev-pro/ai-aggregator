// src/modules/models/models.service.ts

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AIModel, ModelDocument } from '../ai-providers/schemas/model.schema';
import { GenerationType, SubscriptionPlan } from '@/common/interfaces';
import { UsersService } from '../users/users.service';
import { BillingService } from '../billing/billing.service';

export interface ModelDto {
  slug: string;
  name: string;
  displayName: string;
  type: GenerationType;
  provider: string;
  description: string;
  cost: number;
  minCost: number;
  isActive: boolean;
  isPremium: boolean;
  capabilities: string[];
  limits?: {
    maxInputTokens?: number;
    maxOutputTokens?: number;
    maxResolution?: string;
    maxDuration?: number;
  };
  defaultParams?: {
    temperature?: number;
    maxTokens?: number;
    width?: number;
    height?: number;
  };
  hasVariants: boolean;

  // 🆕 Информация о бесплатном доступе по подписке
  isFreeInPlan: boolean;
  freeLimit?: {
    hourlyLimit: number | null;
    dailyLimit: number | null;
    requiredParams?: Record<string, any> | null;
  } | null;
}

@Injectable()
export class ModelsService {
  private readonly logger = new Logger(ModelsService.name);

  constructor(
    @InjectModel(AIModel.name) private modelModel: Model<ModelDocument>,
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
    @Inject(forwardRef(() => BillingService))
    private billingService: BillingService,
  ) {}

  /**
   * Список моделей доступных пользователю с учётом его плана.
   *
   * 🆕 userId вместо userPlan-by-role: план берём из user.subscriptionPlan,
   *    а не из user.role (роль не отражает подписку).
   */
  async getAvailableModels(
    userId: string,
    type?: GenerationType,
  ): Promise<ModelDto[]> {
    const query: any = { isActive: true };
    if (type) query.type = type;

    const models = await this.modelModel
      .find(query)
      .sort({ type: 1, sortOrder: 1 })
      .lean<any[]>()
      .exec();

    // Достаём план юзера и его free-модели
    const user = await this.usersService.findById(userId);
    const userPlan = (user.subscriptionPlan ||
      SubscriptionPlan.FREE) as SubscriptionPlan;

    const freeModelsMap = await this.billingService
      .getFreeModelsForUser(userId)
      .catch((err) => {
        this.logger.warn(
          `Failed to load free models for user ${userId}: ${err.message}`,
        );
        return new Map();
      });

    // Фильтрация по доступности для плана пользователя (premium)
    const availableModels = models.filter((model) => {
      if (!model.isPremium) return true;

      const includedPlans = model.limits?.includedInPlans || [];
      if (includedPlans.length === 0) {
        // Если планы не указаны — premium доступен от PLUS и выше
        return [
          SubscriptionPlan.PLUS,
          SubscriptionPlan.MAX,
          SubscriptionPlan.ULTIMATE,
          // legacy
          SubscriptionPlan.PRO,
          SubscriptionPlan.UNLIMITED,
        ].includes(userPlan);
      }

      return includedPlans.includes(userPlan);
    });

    return availableModels.map((model) =>
      this.mapToDto(model, freeModelsMap),
    );
  }

  async getModelDetails(
    slug: string,
    userId: string,
  ): Promise<ModelDto | null> {
    const model = await this.modelModel
      .findOne({ slug, isActive: true })
      .lean<any>();
    if (!model) return null;

    const user = await this.usersService.findById(userId);
    const userPlan = (user.subscriptionPlan ||
      SubscriptionPlan.FREE) as SubscriptionPlan;

    // Проверяем доступность premium-моделей
    if (model.isPremium) {
      const includedPlans = model.limits?.includedInPlans || [];

      if (includedPlans.length > 0) {
        if (!includedPlans.includes(userPlan)) {
          return null;
        }
      } else if (
        ![
          SubscriptionPlan.PLUS,
          SubscriptionPlan.MAX,
          SubscriptionPlan.ULTIMATE,
          SubscriptionPlan.PRO,
          SubscriptionPlan.UNLIMITED,
        ].includes(userPlan)
      ) {
        return null;
      }
    }

    const freeModelsMap = await this.billingService
      .getFreeModelsForUser(userId)
      .catch(() => new Map());

    return this.mapToDto(model, freeModelsMap);
  }

  private mapToDto(model: any, freeModelsMap: Map<string, any>): ModelDto {
    const provider = this.getProviderName(model);
    const cost = this.computeDisplayCost(model);

    // 🆕 Free-доступ по подписке
    const freeEntry = freeModelsMap.get(model.slug);
    const isFreeInPlan = !!freeEntry;
    const freeLimit = freeEntry
      ? {
          hourlyLimit: freeEntry.hourlyLimit ?? null,
          dailyLimit: freeEntry.dailyLimit ?? null,
          requiredParams: freeEntry.requiredParams ?? null,
        }
      : null;

    return {
      slug: model.slug,
      name: model.displayName || model.name,
      displayName: model.displayName,
      type: model.type,
      provider,
      description: model.description || '',
      cost,
      hasVariants:
        model.type === GenerationType.TEXT ||
        (Array.isArray(model.pricingMatrix) &&
          model.pricingMatrix.length > 0),
      minCost: model.minTokenCost ?? cost,
      isActive: model.isActive,
      isPremium: model.isPremium,
      capabilities: model.capabilities || [],
      limits: model.limits
        ? {
            maxInputTokens: model.limits.maxInputTokens,
            maxOutputTokens: model.limits.maxOutputTokens,
            maxResolution: model.limits.maxResolution,
            maxDuration: model.limits.maxDuration,
          }
        : undefined,
      defaultParams: model.defaultParams
        ? {
            temperature: model.defaultParams.temperature,
            maxTokens: model.defaultParams.maxTokens,
            width: model.defaultParams.width,
            height: model.defaultParams.height,
          }
        : undefined,
      isFreeInPlan,
      freeLimit,
    };
  }

  /**
   * Минимальная стоимость одного запроса для отображения в UI ("от X 🔥").
   * Логика без изменений — синхронизировано с BillingService.buildPreviewFromModel.
   */
  private computeDisplayCost(model: any): number {
    // === TEXT (LLM) ===
    if (model.type === GenerationType.TEXT) {
      const inputPrice =
        Number((model as any).pricePerMillionInputTokens) ||
        Number(model.costPerMillionInputTokens) ||
        0;
      const outputPrice =
        Number((model as any).pricePerMillionOutputTokens) ||
        Number(model.costPerMillionOutputTokens) ||
        0;
      const avgTokens = Number((model as any).avgTokensPerRequest) || 1500;

      const minCost = model.minTokenCost ?? model.tokenCost ?? 1;

      if (inputPrice > 0 || outputPrice > 0) {
        const preview =
          (avgTokens * 0.3 * inputPrice) / 1_000_000 +
          (avgTokens * 0.7 * outputPrice) / 1_000_000;

        const rounded = Math.round(preview * 100) / 100;
        return rounded < minCost ? minCost : rounded;
      }

      return minCost;
    }

    // === MEDIA (image/video/audio) ===
    if (
      Array.isArray((model as any).pricingMatrix) &&
      (model as any).pricingMatrix.length > 0
    ) {
      const matrix = (model as any).pricingMatrix as Array<{
        costInTokens?: number;
      }>;
      const costs = matrix
        .map((r) => r.costInTokens)
        .filter((c): c is number => typeof c === 'number' && c > 0);
      if (costs.length > 0) {
        return Math.min(...costs);
      }
    }

    if (model.fixedCostPerGeneration && model.fixedCostPerGeneration > 0) {
      const tokensPerDollar = model.tokensPerDollar || 90;
      const computed =
        Math.round(
          model.fixedCostPerGeneration * tokensPerDollar * 100,
        ) / 100;
      return Math.max(model.minTokenCost ?? 1, computed);
    }

    return model.minTokenCost ?? model.tokenCost ?? 1;
  }

  private getProviderName(model: any): string {
    if (model.providerMappings?.length > 0) {
      const providerSlug = model.providerMappings[0].providerSlug;
      return this.formatProviderName(providerSlug);
    }
    return this.guessProviderBySlug(model.slug);
  }

  private formatProviderName(providerSlug: string): string {
    const mapping: Record<string, string> = {
      openrouter: 'OpenRouter',
      evolink: 'Evolink',
      kie: 'KIE',
      replicate: 'Replicate',
    };
    return mapping[providerSlug] || this.guessProviderBySlug(providerSlug);
  }

  private guessProviderBySlug(slug: string): string {
    if (slug.includes('gpt') || slug.includes('dall') || slug.includes('sora'))
      return 'OpenAI';
    if (slug.includes('claude')) return 'Anthropic';
    if (slug.includes('gemini') || slug.includes('imagen') || slug.includes('veo'))
      return 'Google';
    if (slug.includes('deepseek')) return 'DeepSeek';
    if (slug.includes('grok')) return 'xAI';
    if (slug.includes('perplexity')) return 'Perplexity';
    if (slug.includes('qwen')) return 'Alibaba';
    if (slug.includes('midjourney')) return 'Midjourney';
    if (slug.includes('flux')) return 'Black Forest';
    if (slug.includes('stable')) return 'Stability';
    if (slug.includes('seedream')) return 'ByteDance';
    if (slug.includes('nano')) return 'Community';
    if (slug.includes('kling')) return 'Kuaishou';
    if (slug.includes('runway')) return 'Runway';
    if (slug.includes('hailuo')) return 'MiniMax';
    if (slug.includes('luma')) return 'Luma AI';
    if (slug.includes('pika')) return 'Pika';
    if (slug.includes('suno')) return 'Suno';
    if (slug.includes('eleven')) return 'ElevenLabs';
    return 'AI';
  }
}