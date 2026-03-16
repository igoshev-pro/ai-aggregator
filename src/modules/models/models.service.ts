// src/modules/models/models.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AIModel, ModelDocument } from '../ai-providers/schemas/model.schema';
import { GenerationType, SubscriptionPlan } from '@/common/interfaces';

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
}

@Injectable()
export class ModelsService {
  private readonly logger = new Logger(ModelsService.name);

  constructor(
    @InjectModel(AIModel.name) private modelModel: Model<ModelDocument>,
  ) {}

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
    // Определяем провайдера из маппингов или по имени
    const provider = this.getProviderName(model);
    
    // Рассчитываем cost для фронтенда
    let cost = model.minTokenCost;
    
    if (model.type === GenerationType.TEXT) {
      // Для текстовых моделей показываем среднюю стоимость за ~1000 токенов
      const avgCostPerMillion = (model.costPerMillionInputTokens + model.costPerMillionOutputTokens) / 2;
      cost = Math.max(model.minTokenCost, Math.ceil(avgCostPerMillion));
    } else {
      // Для медиа моделей конвертируем фиксированную стоимость
      cost = Math.max(model.minTokenCost, Math.ceil(model.fixedCostPerGeneration * model.tokensPerDollar));
    }

    return {
      slug: model.slug,
      name: model.displayName || model.name,
      displayName: model.displayName,
      type: model.type,
      provider,
      description: model.description || '',
      cost: cost || model.tokenCost || 1,
      minCost: model.minTokenCost,
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