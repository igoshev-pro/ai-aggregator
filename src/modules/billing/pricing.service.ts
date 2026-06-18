// src/modules/billing/pricing.service.ts
import { forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AIModel,
  ModelDocument,
  PricingRule,
} from '../ai-providers/schemas/model.schema';
import { BillingService } from './billing.service';

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
    @Inject(forwardRef(() => BillingService))
    private billingService: BillingService,
  ) {}

  /**
   * Главный метод расчёта цены.
   *
   * @param modelSlug - slug модели
   * @param params    - параметры генерации
   * @param userId    - 🆕 опционально: если передан, проверяется free-доступ
   *                    по подписке юзера и возвращается costInTokens=0
   *                    при попадании в план.
   */
  async calculatePrice(
    modelSlug: string,
    params: Record<string, any> = {},
    userId?: string,
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

    // 🆕 ПРОВЕРКА FREE-ДОСТУПА (если передан userId)
    // Если модель бесплатна для подписки юзера и параметры подходят,
    // возвращаем 0 спичек. Лимиты часовые/дневные тут НЕ проверяем —
    // фронт показывает "бесплатно", а реальную проверку лимита делает
    // GenerationService.resolveFreeAccess при отправке генерации.
    if (userId) {
      try {
        const freeMap =
          await this.billingService.getFreeModelsForUser(userId);
        const freeEntry = freeMap.get(modelSlug);

        if (freeEntry) {
          const matchParams = this.matchRequiredParams(
            freeEntry.requiredParams,
            params,
          );
          if (matchParams) {
            const breakdown = {
              modelSlug: model.slug,
              modelName: model.name,
              type: model.type,
              rule: 'free-by-subscription',
              params,
              costInTokens: 0,
              costInDollars: 0,
              fallback: false,
            };
            return {
              costInTokens: 0,
              costInDollars: 0,
              fallback: false,
              breakdown,
            };
          }
        }
      } catch (err) {
        // Не валим расчёт цены если billing недоступен —
        // просто продолжаем с обычной (платной) ценой.
        this.logger.warn(
          `Free-access check failed for user ${userId}, model ${modelSlug}: ${(err as any).message}`,
        );
      }
    }

    // ─── 🆕 ПОСИМВОЛЬНАЯ

        // ─── 🆕 ПОСИМВОЛЬНАЯ ТАРИФИКАЦИЯ (charBasedPricing) ───
    // Используется для ElevenLabs TTS / Dialogue.
    // Фронт передаёт params.textLength (число символов в prompt).
    // Если textLength не пришёл — fallback к среднему 500 символов.
    if ((model as any).charBasedPricing && (model as any).pricePerThousandChars > 0) {
      const minCost = model.minTokenCost || 0.5;
      const pricePerK = Number((model as any).pricePerThousandChars);

      const textLength = Math.max(0, Number(params.textLength) || 0);

      // Если фронт не прислал textLength — показываем preview за 500 символов.
      // Реальное списание произойдёт уже с фактической длиной.
      const effectiveLength = textLength > 0 ? textLength : 500;

      const raw = (effectiveLength / 1000) * pricePerK;
      const rounded = Math.round(raw * 100) / 100;
      const finalCost = rounded < minCost ? minCost : rounded;

      const breakdown = {
        modelSlug: model.slug,
        modelName: model.name,
        type: model.type,
        rule: textLength > 0
          ? `${textLength} chars × ${pricePerK}🔥/1k`
          : `preview: 500 chars × ${pricePerK}🔥/1k (передайте textLength)`,
        params,
        costInTokens: finalCost,
        costInDollars: 0,
        fallback: textLength === 0,
      };

      return {
        costInTokens: finalCost,
        costInDollars: 0,
        fallback: textLength === 0,
        breakdown,
      };
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

    /**
   * 🆕 Нестрогое сравнение requiredParams с params (для free-доступа).
   * Дублирует логику из BillingService.matchRequiredParams, чтобы
   * избежать утечки приватных методов наружу.
   *
   * Если requiredParams пустой/undefined → совпадает всегда.
   * Иначе — каждый ключ из required должен совпасть с params (== для number/string/bool).
   */
  private matchRequiredParams(
    required: Record<string, any> | undefined | null,
    actual?: Record<string, any>,
  ): boolean {
    if (!required || Object.keys(required).length === 0) {
      return true;
    }
    if (!actual) return false;

    for (const key of Object.keys(required)) {
      const expected = required[key];
      const got = actual[key];
      // eslint-disable-next-line eqeqeq
      if (expected != got) return false;
    }
    return true;
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