// src/modules/billing/pricing.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AIModel,
  ModelDocument,
  PricingRule,
} from '../ai-providers/schemas/model.schema';

export interface PriceCalculation {
  costInTokens: number;
  costInDollars: number;
  matchedRule?: PricingRule;
  fallback: boolean;
  breakdown: {
    modelSlug: string;
    modelName: string;
    type: string;
    rule?: string;
    params: Record<string, any>;
    costInTokens: number;
    costInDollars: number;
    fallback: boolean;
  };
}

/**
 * PricingService — централизованный расчёт стоимости генерации.
 *
 * Логика:
 * 1. Для текстовых моделей → возвращает preview-цену по средней длине запроса
 *    (0.3·input + 0.7·output на 1M токенов). Если меньше minTokenCost → minTokenCost.
 *    Реальная цена считается в BillingService.calculateGenerationCost ПОСЛЕ стрима,
 *    когда уже известны inputTokens/outputTokens.
 *
 * 2. Для media-моделей → ищет matching rule в `model.pricingMatrix`:
 *    - Сортирует правила по специфичности (больше conditions → выше приоритет)
 *    - Ищет первое правило, где ВСЕ conditions совпадают с params
 *    - Если найдено → возвращает цену из правила
 *    - Если НЕ найдено → fallback к `fixedCostPerGeneration × tokensPerDollar`
 *
 * 3. Минимум всегда `minTokenCost` (защита от 0₽).
 *
 * Используется:
 * - GenerationController.calculatePrice() — preview цены для фронта
 * - GenerationService.generateImage/Video/Audio — расчёт при создании задачи
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    @InjectModel(AIModel.name) private modelModel: Model<ModelDocument>,
  ) {}

  /**
   * Главный метод расчёта цены.
   *
   * @param modelSlug - slug модели (например, 'midjourney')
   * @param params    - параметры генерации, влияющие на цену
   *                    (mode, resolution, duration, hasInputImage, etc.)
   */
  async calculatePrice(
    modelSlug: string,
    params: Record<string, any> = {},
  ): Promise<PriceCalculation> {
    const model = await this.modelModel.findOne({
      slug: modelSlug,
      isActive: true,
    });

    if (!model) {
      throw new NotFoundException(
        `Model "${modelSlug}" not found or inactive`,
      );
    }

    // ─── ТЕКСТ ─── preview цена (реальная считается после стрима)
    if (model.type === 'text') {
      const minCost = model.minTokenCost || 1;

      // 🆕 Приоритет новых полей цен, fallback на legacy
      const inputPrice =
        Number((model as any).pricePerMillionInputTokens) ||
        Number((model as any).costPerMillionInputTokens) || 0;
      const outputPrice =
        Number((model as any).pricePerMillionOutputTokens) ||
        Number((model as any).costPerMillionOutputTokens) || 0;
      const avgTokens = Number((model as any).avgTokensPerRequest) || 1500;

      let previewCost = minCost;

      if (inputPrice > 0 || outputPrice > 0) {
        // Та же формула, что в BillingService.buildPreviewFromModel
        const raw =
          (avgTokens * 0.3 * inputPrice) / 1_000_000 +
          (avgTokens * 0.7 * outputPrice) / 1_000_000;

        const rounded = Math.round(raw * 100) / 100;

        // Если получилось меньше минимума — берём minTokenCost
        previewCost = rounded < minCost ? minCost : rounded;
      }

      const breakdown = {
        modelSlug: model.slug,
        modelName: model.name,
        type: 'text',
        rule: 'text-preview (real cost calculated after streaming)',
        params,
        costInTokens: previewCost,
        costInDollars: 0,
        fallback: true,
      };

      return {
        costInTokens: previewCost,
        costInDollars: 0,
        fallback: true,
        breakdown,
      };
    }

    // ─── MEDIA ─── ищем правило в pricingMatrix
    const matched = this.findMatchingRule(model.pricingMatrix, params);

    if (matched) {
      this.logger.debug(
        `[${modelSlug}] matched rule: ${JSON.stringify(
          matched.conditions,
        )} → ${matched.costInTokens}🔥`,
      );

      const costInTokens = Math.max(
        matched.costInTokens,
        model.minTokenCost || 1,
      );

      const breakdown = {
        modelSlug: model.slug,
        modelName: model.name,
        type: model.type,
        rule:
          matched.label ||
          this.formatConditions(matched.conditions),
        params,
        costInTokens,
        costInDollars: matched.costInDollars,
        fallback: false,
      };

      return {
        costInTokens,
        costInDollars: matched.costInDollars,
        matchedRule: matched,
        fallback: false,
        breakdown,
      };
    }

   // ─── FALLBACK ─── fixedCostPerGeneration × tokensPerDollar
    // 🔧 Math.round до 2 знаков (вместо Math.ceil) + дефолт 90 спичек/$
    //    чтобы совпадало с минимумом pricingMatrix в списке моделей
    //    (0.0178$ × 90 = 1.602 → 1.6, а не 2).
    //    🆕 Если есть pricingMatrix — берём её минимум как fallback,
    //    чтобы цена в селекте = цене в списке.
    let fallbackBase: number;
    if (
      Array.isArray((model as any).pricingMatrix) &&
      (model as any).pricingMatrix.length > 0
    ) {
      const costs = (model as any).pricingMatrix
        .map((r: any) => Number(r.costInTokens))
        .filter((n: number) => Number.isFinite(n) && n > 0);
      fallbackBase =
        costs.length > 0
          ? Math.min(...costs)
          : Math.round(
              (model.fixedCostPerGeneration || 0) *
                (model.tokensPerDollar || 90) *
                100,
            ) / 100;
    } else {
      fallbackBase =
        Math.round(
          (model.fixedCostPerGeneration || 0) *
            (model.tokensPerDollar || 90) *
            100,
        ) / 100;
    }

    const fallbackTokens = Math.max(model.minTokenCost || 1, fallbackBase);

    this.logger.debug(
      `[${modelSlug}] no rule matched, fallback to fixedCost: ${fallbackTokens}🔥`,
    );

    const breakdown = {
      modelSlug: model.slug,
      modelName: model.name,
      type: model.type,
      rule: 'fixed-price fallback (no matching rule)',
      params,
      costInTokens: fallbackTokens,
      costInDollars: model.fixedCostPerGeneration || 0,
      fallback: true,
    };

    return {
      costInTokens: fallbackTokens,
      costInDollars: model.fixedCostPerGeneration || 0,
      fallback: true,
      breakdown,
    };
  }

  // ─── Private helpers ────────────────────────────────────────────

  /**
   * Найти правило, где ВСЕ conditions совпадают с params.
   *
   * Сортирует правила по специфичности:
   * правила с большим количеством conditions проверяются раньше,
   * т.к. они более специфичны.
   *
   * Пример:
   *   rules = [
   *     { mode: 'turbo' }                    → менее специфичное
   *     { mode: 'turbo', resolution: '2K' }  → более специфичное
   *   ]
   *
   * params = { mode: 'turbo', resolution: '2K' }
   *   → выберется второе правило
   */
  private findMatchingRule(
    matrix: PricingRule[],
    params: Record<string, any>,
  ): PricingRule | null {
    if (!matrix || matrix.length === 0) return null;

    const sorted = [...matrix].sort(
      (a, b) =>
        Object.keys(b.conditions || {}).length -
        Object.keys(a.conditions || {}).length,
    );

    // 🆕 Нормализация для устойчивого сравнения (число "5" === 5, "true" === true)
    const norm = (v: any): any => {
      if (typeof v === 'boolean') return v;
      if (v === 'true') return true;
      if (v === 'false') return false;
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) {
        return Number(v);
      }
      return v;
    };

    for (const rule of sorted) {
      if (!rule.conditions) continue;

      const allMatch = Object.entries(rule.conditions).every(
        ([key, expected]) => {
          const actual = params[key];

          if (Array.isArray(expected)) {
            return expected.some((e) => norm(e) === norm(actual));
          }

          return norm(expected) === norm(actual);
        },
      );

      if (allMatch) return rule;
    }

    return null;
  }

  /**
   * Форматирует conditions в читаемую строку для логов/breakdown.
   * { mode: 'turbo', resolution: '2K' } → "mode=turbo, resolution=2K"
   */
  private formatConditions(
    conditions: Record<string, any>,
  ): string {
    return Object.entries(conditions || {})
      .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.join('|')}]` : v}`)
      .join(', ');
  }
}