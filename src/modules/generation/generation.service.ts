// src/modules/generation/generation.service.ts
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bull';
import { Model, Types } from 'mongoose';
import { Queue } from 'bull';
import { Generation, GenerationDocument } from './schemas/generation.schema';
import { AIModel, ModelDocument } from '../ai-providers/schemas/model.schema';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { UsersService } from '../users/users.service';
import { BillingService } from '../billing/billing.service';
import { PricingService } from '../billing/pricing.service';
import {
  GenerationType,
  GenerationStatus,
  SubscriptionPlan,
} from '@/common/interfaces';
import {
  ImageGenerationDto,
  VideoGenerationDto,
  AudioGenerationDto,
} from './dto/image-generation.dto';


// ─── Иерархия планов (для подсказок upgrade) ─────────────────────
const PLAN_ORDER: SubscriptionPlan[] = [
  SubscriptionPlan.FREE,
  SubscriptionPlan.BASIC,
  SubscriptionPlan.PLUS,
  SubscriptionPlan.MAX,
  SubscriptionPlan.ULTIMATE,
];

const TOP_PLAN = SubscriptionPlan.ULTIMATE;

function isTopPlan(plan: string): boolean {
  return String(plan).toLowerCase() === String(TOP_PLAN).toLowerCase();
}

function nextPlanAfter(plan: string): SubscriptionPlan | null {
  const idx = PLAN_ORDER.findIndex(
    (p) => String(p).toLowerCase() === String(plan).toLowerCase(),
  );
  if (idx < 0) return SubscriptionPlan.PLUS;
  if (idx >= PLAN_ORDER.length - 1) return null;
  return PLAN_ORDER[idx + 1];
}

function buildResetHints(now: Date) {
  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1, 0, 0, 0);

  const nextDay = new Date(now);
  nextDay.setDate(now.getDate() + 1);
  nextDay.setHours(0, 0, 0, 0);

  const minutesToHour = Math.max(
    1,
    Math.ceil((nextHour.getTime() - now.getTime()) / 60_000),
  );
  const minutesToDay = Math.max(
    1,
    Math.ceil((nextDay.getTime() - now.getTime()) / 60_000),
  );

  return {
    hourlyResetAt: nextHour.toISOString(),
    dailyResetAt: nextDay.toISOString(),
    minutesToHourlyReset: minutesToHour,
    minutesToDailyReset: minutesToDay,
  };
}


@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    @InjectModel(Generation.name)
    private generationModel: Model<GenerationDocument>,
    @InjectModel(AIModel.name)
    private modelModel: Model<ModelDocument>,
    @InjectQueue('generation') private generationQueue: Queue,
    @Inject(forwardRef(() => AiProvidersService))
    private aiProvidersService: AiProvidersService,
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
    @Inject(forwardRef(() => BillingService))
    private billingService: BillingService,
    private pricingService: PricingService,
  ) {}


  // ═══════════════════════════════════════════════════════════════
  // 🆕 FREE ACCESS GATE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Решает, бесплатна ли генерация по подписке.
   *
   * 🆕 Принимает params — нужны для моделей с requiredParams в плане
   * (например, midjourney → бесплатен только в режиме `mode: 'draft'`).
   *
   * Возвращает:
   *   { isFree: true }                          → списываем 0 токенов
   *   { isFree: false, fallthroughToPaid: true} → идём в обычный платный путь
   *
   * Бросает 400, если:
   *   - модель в freeModels плана, лимит исчерпан, и план НЕ топовый
   *
   * Для топового плана (Ultimate) при исчерпании лимита — НЕ бросаем,
   * а отдаём fallthroughToPaid=true (пользователь сам выбирает).
   */
  private async resolveFreeAccess(
    userId: string,
    modelSlug: string,
    params?: Record<string, any>, // 🆕 учитываем requiredParams
  ): Promise<{ isFree: boolean; fallthroughToPaid: boolean }> {
    const access = await this.billingService.checkFreeModelAccess(
      userId,
      modelSlug,
      params, // 🆕 пробрасываем
    );

    // Бесплатно — лимит ОК
    if (access.isFree) {
      return { isFree: true, fallthroughToPaid: false };
    }

    // Не бесплатно, и не "лимит исчерпан":
    //   - модель не входит в free-список плана, ИЛИ
    //   - входит, но params не подходят (напр. midjourney mode!=draft)
    if (!access.reason || access.reason === 'not_in_plan') {
      return { isFree: false, fallthroughToPaid: true };
    }

    // Лимит исчерпан → решаем по плану пользователя
    const user = await this.usersService.findById(userId);
    const userPlan = String(user.subscriptionPlan || 'free').toLowerCase();

    if (isTopPlan(userPlan)) {
      this.logger.log(
        `[FreeAccess] user=${userId} model=${modelSlug} → top plan, fallthrough to paid`,
      );
      return { isFree: false, fallthroughToPaid: true };
    }

    // Не топовый → блокируем с подсказкой апгрейда
    const hints = buildResetHints(new Date());
    const next = nextPlanAfter(userPlan);

    const message =
      `${access.reason}. ` +
      (next
        ? `Перейдите на тариф ${String(next).toUpperCase()} для увеличения лимитов, `
        : '') +
      `или дождитесь обнуления лимита через ~${hints.minutesToHourlyReset} мин (часовой) / ~${hints.minutesToDailyReset} мин (дневной).`;

    throw new BadRequestException({
      code: 'FREE_LIMIT_EXCEEDED_UPGRADE',
      message,
      modelSlug,
      currentPlan: userPlan,
      suggestedPlan: next,
      hourlyResetAt: hints.hourlyResetAt,
      dailyResetAt: hints.dailyResetAt,
      minutesToHourlyReset: hints.minutesToHourlyReset,
      minutesToDailyReset: hints.minutesToDailyReset,
    });
  }


  // ─── IMAGE ──────────────────────────────────────────────────────

  async generateImage(userId: string, dto: ImageGenerationDto) {
    const model = await this.aiProvidersService.getModelBySlug(dto.modelSlug);

    // 🆕 Собираем priceParams ДО free-gate, чтобы передать их в обе функции.
    //     Это критично для midjourney (mode='draft' → free, иначе → paid).
    const priceParams = {
      mode: dto.mode,
      version: dto.version,
      aspectRatio: dto.aspectRatio,
      resolution: dto.resolution,
      quality: dto.quality,
      hasInputImage: !!(dto.inputUrls && dto.inputUrls.length > 0),
      numImages: dto.numImages || 1,
    };

    // 🆕 1. Free-gate теперь учитывает params (mode, version и т.д.)
    const { isFree } = await this.resolveFreeAccess(
      userId,
      dto.modelSlug,
      priceParams,
    );

    // 2. Цена считается всегда (для аудита pricingBreakdown)
    const priceCalc = await this.pricingService.calculatePrice(
      dto.modelSlug,
      priceParams,
    );

    const costInTokens = isFree ? 0 : priceCalc.costInTokens;
    const costInDollars = isFree ? 0 : priceCalc.costInDollars;

    // 3. Баланс проверяем только для платных
    if (!isFree) {
      await this.validateBalance(userId, costInTokens);
    }

    const generation = new this.generationModel({
      userId: new Types.ObjectId(userId),
      type: GenerationType.IMAGE,
      modelSlug: dto.modelSlug,
      status: GenerationStatus.PENDING,
      prompt: dto.prompt,
      negativePrompt: dto.negativePrompt,
      params: {
        width: dto.width || model.defaultParams?.width || 1024,
        height: dto.height || model.defaultParams?.height || 1024,
        aspectRatio: dto.aspectRatio,
        resolution: dto.resolution,
        quality: dto.quality,
        outputFormat: dto.outputFormat,
        steps: dto.steps || model.defaultParams?.steps,
        seed: dto.seed,
        numImages: dto.numImages || 1,
        style: dto.style,
        inputUrls: dto.inputUrls,
        mode: dto.mode,
        version: dto.version,
      },
      tokensCost: costInTokens,
      costInDollars,
      pricingBreakdown: priceCalc.breakdown,
      metadata: { freeAccess: isFree },
    });
    await generation.save();

    // 4. Списание — только для платных
    if (!isFree) {
      await this.usersService.deductTokens(
        userId,
        costInTokens,
        'generation_reserve',
      );
    }

    const p = generation.params as any;

    await this.generationQueue.add(
      'process-generation',
      {
        generationId: generation._id.toString(),
        userId,
        type: GenerationType.IMAGE,
        modelSlug: dto.modelSlug,
        request: {
          prompt: dto.prompt,
          negativePrompt: dto.negativePrompt,
          width: p.width,
          height: p.height,
          aspectRatio: p.aspectRatio,
          resolution: p.resolution,
          quality: p.quality,
          outputFormat: p.outputFormat,
          steps: p.steps,
          seed: p.seed,
          numImages: p.numImages,
          style: p.style,
          resizeMode: p.resizeMode,
          inputUrls: p.inputUrls,
          mode: p.mode,
          version: p.version,
        },
      },
      {
        priority: 2,
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
        timeout: 300000,
      },
    );

    return {
      generationId: generation._id.toString(),
      status: generation.status,
      tokensCost: costInTokens,
      costInDollars,
      pricingBreakdown: priceCalc.breakdown,
      freeAccess: isFree,
    };
  }


  // ─── VIDEO ──────────────────────────────────────────────────────

  async generateVideo(userId: string, dto: VideoGenerationDto) {
    const model = await this.aiProvidersService.getModelBySlug(dto.modelSlug);

    const priceParams = {
      mode: dto.mode,
      duration: dto.duration,
      resolution: dto.resolution,
      aspectRatio: dto.aspectRatio,
      quality: dto.quality,
      sound: dto.sound,
      generateAudio: dto.generateAudio,
      stable: dto.stable,
      videoRef: !!(dto.videoUrls && dto.videoUrls.length > 0),
      hasInputImage:
        !!dto.imageUrl ||
        !!(dto.imageUrls && dto.imageUrls.length > 0) ||
        !!(dto.referenceImages && dto.referenceImages.length > 0),
    };

    // 🆕 Free-gate с params
    const { isFree } = await this.resolveFreeAccess(
      userId,
      dto.modelSlug,
      priceParams,
    );

    const priceCalc = await this.pricingService.calculatePrice(
      dto.modelSlug,
      priceParams,
    );

    const costInTokens = isFree ? 0 : priceCalc.costInTokens;
    const costInDollars = isFree ? 0 : priceCalc.costInDollars;

    if (!isFree) {
      await this.validateBalance(userId, costInTokens);
    }

    const generation = new this.generationModel({
      userId: new Types.ObjectId(userId),
      type: GenerationType.VIDEO,
      modelSlug: dto.modelSlug,
      status: GenerationStatus.PENDING,
      prompt: dto.prompt,
      negativePrompt: dto.negativePrompt,
      params: {
        imageUrl: dto.imageUrl,
        imageUrls: dto.imageUrls,
        referenceImages: dto.referenceImages,
        videoUrls: dto.videoUrls,
        characterOrientation: dto.characterOrientation,
        generationType: dto.generationType,
        duration: dto.duration || (model.defaultParams as any)?.duration || 5,
        aspectRatio:
          dto.aspectRatio ||
          (model.defaultParams as any)?.aspectRatio ||
          '16:9',
        resolution:
          dto.resolution ||
          (model.defaultParams as any)?.resolution ||
          '720p',
        mode: dto.mode,
        quality: dto.quality,
        sound: dto.sound,
        generateAudio: dto.generateAudio,
        stable: dto.stable,
        removeWatermark: dto.removeWatermark,
        promptOptimizer: dto.promptOptimizer,
        waterMark: dto.waterMark,
        watermark: dto.watermark,
        style: dto.style,
        resizeMode: dto.resizeMode,
        multiShots: dto.multiShots,
        multiPrompt: dto.multiPrompt,
        klingElements: dto.klingElements,
        cfgScale: dto.cfgScale,
        nsfwChecker: dto.nsfwChecker,
        fixedLens: dto.fixedLens,
        webSearch: dto.webSearch,
        audioUrls: dto.audioUrls,
      },
      tokensCost: costInTokens,
      costInDollars,
      pricingBreakdown: priceCalc.breakdown,
      metadata: { freeAccess: isFree },
    });
    await generation.save();

    if (!isFree) {
      await this.usersService.deductTokens(
        userId,
        costInTokens,
        'generation_reserve',
      );
    }

    const p = generation.params as any;

    await this.generationQueue.add(
      'process-generation',
      {
        generationId: generation._id.toString(),
        userId,
        type: GenerationType.VIDEO,
        modelSlug: dto.modelSlug,
        request: {
          prompt: dto.prompt,
          negativePrompt: dto.negativePrompt,
          imageUrl: p.imageUrl,
          imageUrls: p.imageUrls,
          referenceImages: p.referenceImages,
          videoUrls: p.videoUrls,
          characterOrientation: p.characterOrientation,
          generationType: p.generationType,
          duration: p.duration,
          aspectRatio: p.aspectRatio,
          resolution: p.resolution,
          mode: p.mode,
          quality: p.quality,
          sound: p.sound,
          generateAudio: p.generateAudio,
          stable: p.stable,
          removeWatermark: p.removeWatermark,
          promptOptimizer: p.promptOptimizer,
          waterMark: p.waterMark,
          watermark: p.watermark,
          style: p.style,
          resizeMode: p.resizeMode,
          multiShots: p.multiShots,
          multiPrompt: p.multiPrompt,
          klingElements: p.klingElements,
          cfgScale: p.cfgScale,
          nsfwChecker: p.nsfwChecker,
          fixedLens: p.fixedLens,
          webSearch: p.webSearch,
          audioUrls: p.audioUrls,
        },
      },
      {
        priority: 3,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        timeout: 600000,
      },
    );

    return {
      generationId: generation._id.toString(),
      status: generation.status,
      tokensCost: costInTokens,
      costInDollars,
      pricingBreakdown: priceCalc.breakdown,
      freeAccess: isFree,
    };
  }


  // ─── AUDIO ──────────────────────────────────────────────────────

  async generateAudio(userId: string, dto: AudioGenerationDto) {
    const model = await this.aiProvidersService.getModelBySlug(dto.modelSlug);

    // 🆕 textLength для посимвольной тарификации ElevenLabs.
    // Приоритет: явное значение от фронта → длина prompt → 0.
    const textLength =
      typeof dto.textLength === 'number' && dto.textLength > 0
        ? dto.textLength
        : (dto.prompt?.length || 0);

    const priceParams = {
      operation: dto.operation,
      duration: dto.duration,
      instrumental: dto.instrumental,
      customMode: dto.customMode,
      language: dto.language,
      hasAudioInput: !!dto.audioUrl,
      hasDialogue: !!(dto.dialogue && dto.dialogue.length > 0),
      // 🆕 длина текста для charBasedPricing моделей
      textLength,
    };

    // 🆕 Free-gate с params
    const { isFree } = await this.resolveFreeAccess(
      userId,
      dto.modelSlug,
      priceParams,
    );

    const priceCalc = await this.pricingService.calculatePrice(
      dto.modelSlug,
      priceParams,
    );

    const costInTokens = isFree ? 0 : priceCalc.costInTokens;
    const costInDollars = isFree ? 0 : priceCalc.costInDollars;

    if (!isFree) {
      await this.validateBalance(userId, costInTokens);
    }

    const generation = new this.generationModel({
      userId: new Types.ObjectId(userId),
      type: GenerationType.AUDIO,
      modelSlug: dto.modelSlug,
      status: GenerationStatus.PENDING,
      prompt: dto.prompt,
      params: {
        style: dto.style,
        duration: dto.duration,
        instrumental: dto.instrumental,
        customMode: dto.customMode,
        operation: dto.operation,
        title: dto.title,
        audioId: dto.audioId,
        continueAt: dto.continueAt,
        negativeTags: dto.negativeTags,
        vocalGender: dto.vocalGender,
        styleWeight: dto.styleWeight,
        weirdnessConstraint: dto.weirdnessConstraint,
        audioWeight: dto.audioWeight,
        voiceId: dto.voiceId,
        language: dto.language,
        stability: dto.stability,
        similarity: dto.similarity,
        speed: dto.speed,
        loop: dto.loop,
        promptInfluence: dto.promptInfluence,
        audioUrl: dto.audioUrl,
        dialogue: dto.dialogue,
      },
      tokensCost: costInTokens,
      costInDollars,
      pricingBreakdown: priceCalc.breakdown,
      metadata: { freeAccess: isFree },
    });
    await generation.save();

    if (!isFree) {
      await this.usersService.deductTokens(
        userId,
        costInTokens,
        'generation_reserve',
      );
    }

    const p = generation.params as any;

    const requestPayload: any = {
      prompt: dto.prompt,
      text: dto.prompt,
      style: p.style,
      duration: p.duration,
      instrumental: p.instrumental,
      customMode: dto.customMode,
      operation: p.operation,
      title: p.title,
      audioId: p.audioId,
      continueAt: p.continueAt,
      negativeTags: p.negativeTags,
      vocalGender: p.vocalGender,
      styleWeight: p.styleWeight,
      weirdnessConstraint: p.weirdnessConstraint,
      audioWeight: p.audioWeight,
      voiceId: p.voiceId,
      voice: p.voiceId,
      language: p.language,
      language_code: p.language,
      stability: p.stability,
      similarity_boost: p.similarity,
      similarity: p.similarity,
      speed: p.speed,
      loop: p.loop,
      prompt_influence: p.promptInfluence,
      promptInfluence: p.promptInfluence,
      audio_url: p.audioUrl,
      audioUrl: p.audioUrl,
      dialogue: p.dialogue,
    };

    await this.generationQueue.add(
      'process-generation',
      {
        generationId: generation._id.toString(),
        userId,
        type: GenerationType.AUDIO,
        modelSlug: dto.modelSlug,
        request: requestPayload,
      },
      {
        priority: 2,
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
        timeout: 600000,
      },
    );

    return {
      generationId: generation._id.toString(),
      status: generation.status,
      tokensCost: costInTokens,
      costInDollars,
      pricingBreakdown: priceCalc.breakdown,
      freeAccess: isFree,
    };
  }


      // ─── РАСЧЁТ ЦЕНЫ (для preview на фронте) ────────────────────

  /**
   * 🆕 Принимает userId — чтобы PricingService мог вернуть 0 спичек,
   * если модель бесплатна по подписке пользователя.
   */
  async calculatePrice(
    modelSlug: string,
    params: Record<string, any>,
    userId?: string,
  ) {
    return this.pricingService.calculatePrice(modelSlug, params, userId);
  }


  // ─── UI-КОНФИГ МОДЕЛИ ──────────────────────────────────────

  async getModelUIConfig(slug: string) {
    const model = await this.modelModel
      .findOne({ slug, isActive: true })
      .lean();

    if (!model) {
      throw new NotFoundException(`Model "${slug}" not found`);
    }

    return {
      slug: model.slug,
      name: model.name,
      displayName: model.displayName,
      description: model.description,
      icon: model.icon,
      type: model.type,
      isPremium: model.isPremium,
      capabilities: model.capabilities || [],
      uiParameters: model.uiParameters || [],
      inputCapabilities: model.inputCapabilities || {},
      pricingMatrix: (model.pricingMatrix || []).map((rule) => ({
        conditions: rule.conditions,
        costInTokens: rule.costInTokens,
        costInDollars: rule.costInDollars,
        label: rule.label,
      })),
      minTokenCost: model.minTokenCost,
      defaultParams: model.defaultParams || {},
      limits: model.limits || {},
    };
  }


  // ─── СТАТУС / ИСТОРИЯ ───────────────────────────────────────────

  async getGenerationStatus(userId: string, generationId: string) {
    const generation = await this.generationModel.findById(generationId);
    if (!generation) throw new NotFoundException('Generation not found');
    if (generation.userId.toString() !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return {
      id: generation._id,
      type: generation.type,
      modelSlug: generation.modelSlug,
      status: generation.status,
      progress: generation.progress,
      eta: generation.eta,
      resultUrls: generation.resultUrls,
      resultContent: generation.resultContent,
      tokensCost: generation.tokensCost,
      costInDollars: generation.costInDollars,
      pricingBreakdown: generation.pricingBreakdown,
      errorMessage: generation.errorMessage,
      prompt: generation.prompt,
      params: generation.params,
      metadata: generation.metadata,
      // 🆕 удобный флаг для фронта
      freeAccess: !!(generation.metadata as any)?.freeAccess,
      createdAt: generation['createdAt'],
      completedAt: generation.completedAt,
      responseTimeMs: generation.responseTimeMs,
    };
  }


  async getUserGenerations(
    userId: string,
    type?: GenerationType,
    page = 1,
    limit = 20,
  ) {
    const filter: any = { userId: new Types.ObjectId(userId) };
    if (type) filter.type = type;

    const skip = (page - 1) * limit;

    const [generations, total] = await Promise.all([
      this.generationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.generationModel.countDocuments(filter),
    ]);

    return {
      generations: generations.map((g) => ({
        id: g._id,
        type: g.type,
        modelSlug: g.modelSlug,
        status: g.status,
        prompt: g.prompt,
        resultUrls: g.resultUrls,
        metadata: g.metadata,
        // 🆕
        freeAccess: !!(g.metadata as any)?.freeAccess,
        tokensCost: g.tokensCost,
        costInDollars: g.costInDollars,
        isFavorite: g.isFavorite,
        createdAt: g['createdAt'],
        completedAt: g.completedAt,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }


  async updateGeneration(
    generationId: string,
    updates: Partial<Generation>,
  ): Promise<GenerationDocument | null> {
    return this.generationModel.findByIdAndUpdate(
      generationId,
      { $set: updates },
      { new: true },
    );
  }


  // ═══════════════════════════════════════════════════════════════
  // REFUND — возврат токенов за неудачную генерацию
  // ═══════════════════════════════════════════════════════════════

  /**
   * Возврат токенов за неудачную генерацию.
   *
   * Идемпотентность: повторный вызов с тем же generationId не сделает
   * двойной возврат (защита через флаг isRefunded).
   *
   * Flow:
   *   1) usersService.refundTokens — реально возвращает токены на баланс
   *   2) billingService.recordRefund — пишет транзакцию (БЕЗ повторного начисления)
   *   3) generation.isRefunded = true
   *
   * 🆕 Бесплатные генерации (tokensCost=0 / freeAccess=true) проходят
   * раннее short-circuit и в billing/wallet не лезут.
   */
  async refundGeneration(generationId: string) {
    // Атомарный захват: возврат только если он ещё не сделан И генерация
    // НЕ была успешно оплачена (billingRecorded). Это исключает возврат
    // за генерацию, которая по факту завершилась успешно.
    const generation = await this.generationModel.findOneAndUpdate(
      {
        _id: generationId,
        isRefunded: { $ne: true },
        billingRecorded: { $ne: true },
      },
      { $set: { isRefunded: true } },
      { new: true },
    );

    // null → нет генерации / уже возвращено / генерация успешна (billed)
    if (!generation) return;

    // 🆕 Бесплатные — нечего возвращать
    if (!generation.tokensCost || generation.tokensCost <= 0) {
      return;
    }

    try {
      await this.usersService.refundTokens(
        generation.userId.toString(),
        generation.tokensCost,
      );

      await this.billingService.recordRefund(
        generation.userId.toString(),
        generation.tokensCost,
        `Refund for failed ${generation.type} generation`,
        generationId,
      );

      this.logger.log(
        `↩️ Refunded ${generation.tokensCost}🔥 for generation ${generationId}`,
      );
    } catch (err: any) {
      await this.generationModel.updateOne(
        { _id: generationId },
        { $set: { isRefunded: false } },
      );
      this.logger.error(
        `❌ Refund failed for generation ${generationId}, rolled back: ${err.message}`,
        err.stack,
      );
      throw err;
    }
  }


  // ═══════════════════════════════════════════════════════════════
  // RECORD SUCCESSFUL MEDIA GENERATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Фиксирует успешную media-генерацию в billing.
   * Вызывается из GenerationConsumer после получения результата от провайдера.
   *
   * Идемпотентность: повторный вызов не создаст дубль транзакции
   * (защита через флаг billingRecorded в Generation).
   *
   * ВАЖНО:
   *  - Для платных: токены уже списаны на стадии generateImage/Video/Audio.
   *    Здесь только запись транзакции.
   *  - 🆕 Для бесплатных (freeAccess=true / tokensCost=0): токены НЕ списывались,
   *    но billing всё равно вызывается чтобы записать транзакцию с
   *    metadata.freeAccess=true — она нужна для подсчёта часовых/дневных
   *    лимитов в checkFreeModelAccess.
   */
  async recordSuccessfulGeneration(generationId: string) {
    const generation = await this.generationModel.findById(generationId);
    if (!generation) {
      this.logger.warn(
        `recordSuccessfulGeneration: generation ${generationId} not found`,
      );
      return;
    }

    // Идемпотентность — не дублируем транзакцию
    if ((generation as any).billingRecorded) {
      this.logger.debug(
        `Generation ${generationId} already billed, skipping`,
      );
      return;
    }

    const isFree =
      !!(generation.metadata as any)?.freeAccess ||
      !generation.tokensCost ||
      generation.tokensCost <= 0;

    try {
      await this.billingService.recordMediaGeneration(
        generation.userId.toString(),
        {
          modelSlug: generation.modelSlug,
          generationType: generation.type as 'image' | 'video' | 'audio',
          generationId,
          costInTokens: generation.tokensCost || 0,
          costInDollars: (generation as any).costInDollars || 0,
          matchedTier:
            (generation as any).pricingBreakdown?.rule || undefined,
          generationParams: generation.params as any,
          providerSlug: (generation as any).providerSlug,
          freeAccess: isFree, // 🆕 явный флаг для billing
        },
      );

      // Помечаем чтобы не записать дважды (на случай retry в очереди)
      await this.generationModel.updateOne(
        { _id: generation._id },
        { $set: { billingRecorded: true } },
      );

      this.logger.log(
        `💰 Billing recorded: ${generation.modelSlug} | ${generation.tokensCost || 0}🔥${
          isFree ? ' (free)' : ''
        } | gen=${generationId}`,
      );
    } catch (err: any) {
      // Не валим всю генерацию из-за ошибки billing — но логируем громко
      this.logger.error(
        `❌ Failed to record billing for generation ${generationId}: ${err.message}`,
        err.stack,
      );
    }
  }


  // ─── FAVORITES ──────────────────────────────────────────────────

  async toggleFavorite(userId: string, generationId: string) {
    const generation = await this.generationModel.findById(generationId);
    if (!generation) throw new NotFoundException('Generation not found');
    if (generation.userId.toString() !== userId) {
      throw new ForbiddenException('Access denied');
    }

    generation.isFavorite = !generation.isFavorite;
    await generation.save();
    return { isFavorite: generation.isFavorite };
  }


  async getFavorites(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const filter = {
      userId: new Types.ObjectId(userId),
      isFavorite: true,
      status: GenerationStatus.COMPLETED,
    };

    const [generations, total] = await Promise.all([
      this.generationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.generationModel.countDocuments(filter),
    ]);

    return {
      generations,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }


  // ─── PRIVATE HELPERS ────────────────────────────────────────────

  private async validateBalance(userId: string, cost: number) {
    const user = await this.usersService.findById(userId);
    const totalBalance =
      user.tokenBalance + user.bonusTokens + (user.cashbackBalance || 0);
    if (totalBalance < cost) {
      throw new BadRequestException(
        `Insufficient tokens. Need ${cost}, have ${totalBalance}`,
      );
    }
  }


  /** Сырой документ генерации без проверки доступа — для внутренних нужд (consumer). */
  async getRawGeneration(
    generationId: string,
  ): Promise<GenerationDocument | null> {
    return this.generationModel.findById(generationId);
  }
}