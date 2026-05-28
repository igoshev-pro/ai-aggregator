// src/modules/models/models.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AIModel, ModelDocument } from '../ai-providers/schemas/model.schema';
import { GenerationType, SubscriptionPlan } from '@/common/interfaces';

const MIN_TOKENS_ESTIMATE = 50;

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
}

@Injectable()
export class ModelsService {
  private readonly logger = new Logger(ModelsService.name);

  constructor(
    @InjectModel(AIModel.name) private modelModel: Model<ModelDocument>,
  ) { }

  async getAvailableModels(
    userPlan: SubscriptionPlan,
    type?: GenerationType,
  ): Promise<ModelDto[]> {
    const query: any = { isActive: true };
    if (type) query.type = type;

    const models = await this.modelModel
      .find(query)
      .sort({ type: 1, sortOrder: 1 })
      .exec();

    // Фильтруем по доступности для плана пользователя
    const availableModels = models.filter((model) => {
      if (!model.isPremium) return true;

      const includedPlans = model.limits?.includedInPlans || [];
      if (includedPlans.length === 0) {
        // Если не указаны планы - доступна всем премиум пользователям
        return userPlan === SubscriptionPlan.PRO || userPlan === SubscriptionPlan.UNLIMITED;
      }

      return includedPlans.includes(userPlan);
    });

    return availableModels.map((model) => this.mapToDto(model));
  }

  async getModelDetails(slug: string, userPlan: SubscriptionPlan): Promise<ModelDto | null> {
    const model = await this.modelModel.findOne({ slug, isActive: true });
    if (!model) return null;

    // Проверяем доступность для пользователя
    if (model.isPremium) {
      const includedPlans = model.limits?.includedInPlans || [];

      if (includedPlans.length > 0) {
        if (!includedPlans.includes(userPlan)) {
          return null;
        }
      } else if (userPlan !== SubscriptionPlan.PRO && userPlan !== SubscriptionPlan.UNLIMITED) {
        return null;
      }
    }

    return this.mapToDto(model);
  }

  private mapToDto(model: ModelDocument): ModelDto {
    const provider = this.getProviderName(model);

    // Рассчитываем cost для отображения в UI
    const cost = this.computeDisplayCost(model);

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
        (Array.isArray((model as any).pricingMatrix) && (model as any).pricingMatrix.length > 0),
      minCost: model.minTokenCost ?? cost,
      isActive: model.isActive,
      isPremium: model.isPremium,
      capabilities: model.capabilities || [],
      limits: model.limits ? {
        maxInputTokens: model.limits.maxInputTokens,
        maxOutputTokens: model.limits.maxOutputTokens,
        maxResolution: model.limits.maxResolution,
        maxDuration: model.limits.maxDuration,
      } : undefined,
      defaultParams: model.defaultParams ? {
        temperature: model.defaultParams.temperature,
        maxTokens: model.defaultParams.maxTokens,
        width: model.defaultParams.width,
        height: model.defaultParams.height,
      } : undefined,
    };
  }

  /**
   * Минимальная стоимость одного запроса для отображения в UI ("от X 🔥")
   * - text: цена короткого запроса ~50 токенов
   * - media: фиксированная цена за генерацию (минимум из pricingMatrix если есть)
   */
  private computeDisplayCost(model: ModelDocument): number {
    // === TEXT (LLM) ===
    if (model.type === GenerationType.TEXT) {
      const inputPrice = model.costPerMillionInputTokens ?? 0;
      const outputPrice = model.costPerMillionOutputTokens ?? 0;
      const avgPrice = (inputPrice + outputPrice) / 2;

      if (avgPrice > 0) {
        // Цена короткого запроса: (avg цена за 1M) × MIN_TOKENS / 1_000_000
        // Для GPT-5.4: 14 × 50 / 1000 = 0.7
        // (формула делит на 1000, а не 1_000_000, потому что 
        //  costPerMillionInputTokens у вас уже в спичках за 1M токенов)
        const minCost = (avgPrice * MIN_TOKENS_ESTIMATE) / 1000;
        // Округление до 2 знаков
        return Math.round(minCost * 100) / 100;
      }

      return model.minTokenCost ?? model.tokenCost ?? 1;
    }

    // === MEDIA (image/video/audio) ===
    // Если есть pricingMatrix — берём минимум
    if (Array.isArray((model as any).pricingMatrix) && (model as any).pricingMatrix.length > 0) {
      const matrix = (model as any).pricingMatrix as Array<{ costInTokens?: number }>;
      const costs = matrix
        .map(r => r.costInTokens)
        .filter((c): c is number => typeof c === 'number' && c > 0);
      if (costs.length > 0) {
        return Math.min(...costs);
      }
    }

    // Фиксированная цена за генерацию
    if (model.fixedCostPerGeneration && model.fixedCostPerGeneration > 0) {
      const tokensPerDollar = model.tokensPerDollar || 100;
      return Math.max(
        model.minTokenCost ?? 1,
        Math.ceil(model.fixedCostPerGeneration * tokensPerDollar),
      );
    }

    return model.minTokenCost ?? model.tokenCost ?? 1;
  }

  private getProviderName(model: ModelDocument): string {
    // Берём первого провайдера из маппингов
    if (model.providerMappings?.length > 0) {
      const providerSlug = model.providerMappings[0].providerSlug;
      return this.formatProviderName(providerSlug);
    }

    // Fallback - определяем по slug модели
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
    if (slug.includes('gpt') || slug.includes('dall') || slug.includes('sora')) return 'OpenAI';
    if (slug.includes('claude')) return 'Anthropic';
    if (slug.includes('gemini') || slug.includes('imagen') || slug.includes('veo')) return 'Google';
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