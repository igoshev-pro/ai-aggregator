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
import { AIModel, ModelDocument } from '../ai-providers/schemas/model.schema'; // 🆕
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { UsersService } from '../users/users.service';
import { BillingService } from '../billing/billing.service';
import { PricingService } from '../billing/pricing.service'; // 🆕
import { GenerationType, GenerationStatus } from '@/common/interfaces';
import {
  ImageGenerationDto,
  VideoGenerationDto,
  AudioGenerationDto,
} from './dto/image-generation.dto';

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    @InjectModel(Generation.name)
    private generationModel: Model<GenerationDocument>,
    @InjectModel(AIModel.name) // 🆕
    private modelModel: Model<ModelDocument>,
    @InjectQueue('generation') private generationQueue: Queue,
    @Inject(forwardRef(() => AiProvidersService))
    private aiProvidersService: AiProvidersService,
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
    @Inject(forwardRef(() => BillingService))
    private billingService: BillingService,
    private pricingService: PricingService, // 🆕
  ) { }

  // ─── IMAGE ──────────────────────────────────────────────────────

  async generateImage(userId: string, dto: ImageGenerationDto) {
    const model = await this.aiProvidersService.getModelBySlug(dto.modelSlug);

    // 🆕 Расчёт через PricingService с params (mode, version, и т.д.)
    const priceParams = {
      mode: dto.mode,
      version: dto.version,
      aspectRatio: dto.aspectRatio,
      resolution: dto.resolution,
      quality: dto.quality,
      hasInputImage: !!(dto.inputUrls && dto.inputUrls.length > 0),
      numImages: dto.numImages || 1,
    };

    const priceCalc = await this.pricingService.calculatePrice(
      dto.modelSlug,
      priceParams,
    );

    const costInTokens = priceCalc.costInTokens;
    await this.validateBalance(userId, costInTokens);

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
        mode: dto.mode,         // 🆕
        version: dto.version,   // 🆕
      },
      tokensCost: costInTokens,
      costInDollars: priceCalc.costInDollars,
      pricingBreakdown: priceCalc.breakdown, // 🆕
    });
    await generation.save();

    await this.usersService.deductTokens(
      userId,
      costInTokens,
      'generation_reserve',
    );

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
          mode: p.mode,         // 🆕
          version: p.version,   // 🆕
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
      costInDollars: priceCalc.costInDollars,    // 🆕
      pricingBreakdown: priceCalc.breakdown,     // 🆕
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
      hasInputImage:
        !!dto.imageUrl ||
        !!(dto.imageUrls && dto.imageUrls.length > 0) ||
        !!(dto.referenceImages && dto.referenceImages.length > 0), // 🆕
    };

    const priceCalc = await this.pricingService.calculatePrice(
      dto.modelSlug,
      priceParams,
    );

    const costInTokens = priceCalc.costInTokens;
    await this.validateBalance(userId, costInTokens);

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
        referenceImages: dto.referenceImages,    // 🆕 Veo reference
        videoUrls: dto.videoUrls,
        generationType: dto.generationType,      // 🆕 Veo mode override
        duration: dto.duration || (model.defaultParams as any)?.duration || 5,
        aspectRatio: dto.aspectRatio || (model.defaultParams as any)?.aspectRatio || '16:9',
        resolution: dto.resolution || (model.defaultParams as any)?.resolution || '720p',
        mode: dto.mode,
        quality: dto.quality,
        sound: dto.sound,
        generateAudio: dto.generateAudio,
        stable: dto.stable,
        removeWatermark: dto.removeWatermark,
        promptOptimizer: dto.promptOptimizer,
        waterMark: dto.waterMark,
        watermark: dto.watermark,                // 🆕 Veo watermark
        style: dto.style,
        resizeMode: dto.resizeMode,  // ← ДОБАВИТЬ
      },
      tokensCost: costInTokens,
      costInDollars: priceCalc.costInDollars,
      pricingBreakdown: priceCalc.breakdown,
    });
    await generation.save();

    await this.usersService.deductTokens(
      userId,
      costInTokens,
      'generation_reserve',
    );

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
          referenceImages: p.referenceImages,    // 🆕
          videoUrls: p.videoUrls,
          generationType: p.generationType,       // 🆕
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
          watermark: p.watermark,                  // 🆕
          style: p.style,
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
      costInDollars: priceCalc.costInDollars,
      pricingBreakdown: priceCalc.breakdown,
    };
  }

  // ─── AUDIO ──────────────────────────────────────────────────────

  async generateAudio(userId: string, dto: AudioGenerationDto) {
    const model = await this.aiProvidersService.getModelBySlug(dto.modelSlug);

    // 🆕 Расчёт через PricingService
    const priceParams = {
      operation: dto.operation,
      duration: dto.duration,
      instrumental: dto.instrumental,
      customMode: dto.customMode,
      language: dto.language,
      hasAudioInput: !!dto.audioUrl,
      hasDialogue: !!(dto.dialogue && dto.dialogue.length > 0),
    };

    const priceCalc = await this.pricingService.calculatePrice(
      dto.modelSlug,
      priceParams,
    );

    const costInTokens = priceCalc.costInTokens;
    await this.validateBalance(userId, costInTokens);

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
        customMode: dto.customMode,        // 🆕
        operation: dto.operation,          // 🆕
        title: dto.title,                  // 🆕
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
      costInDollars: priceCalc.costInDollars,
      pricingBreakdown: priceCalc.breakdown, // 🆕
    });
    await generation.save();

    await this.usersService.deductTokens(
      userId,
      costInTokens,
      'generation_reserve',
    );

    const p = generation.params as any;

    // Build request payload — provider will receive all needed fields
    const requestPayload: any = {
      prompt: dto.prompt,
      text: dto.prompt, // ElevenLabs TTS models use 'text' field
      style: p.style,
      duration: p.duration,
      instrumental: p.instrumental,
      customMode: dto.customMode,
      operation: p.operation,    // 🆕 Suno operation type
      title: p.title,            // 🆕 Suno track title
      voiceId: p.voiceId,
      voice: p.voiceId, // KIE ElevenLabs uses 'voice'
      language: p.language,
      language_code: p.language, // KIE ElevenLabs uses 'language_code'
      stability: p.stability,
      similarity_boost: p.similarity, // KIE ElevenLabs uses 'similarity_boost'
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
      costInDollars: priceCalc.costInDollars,    // 🆕
      pricingBreakdown: priceCalc.breakdown,     // 🆕
    };
  }

  // 🆕 ─── РАСЧЁТ ЦЕНЫ (для preview на фронте) ────────────────────

  async calculatePrice(modelSlug: string, params: Record<string, any>) {
    return this.pricingService.calculatePrice(modelSlug, params);
  }

  // 🆕 ─── UI-КОНФИГ МОДЕЛИ (для рендера формы на фронте) ────────

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
      costInDollars: generation.costInDollars,        // 🆕
      pricingBreakdown: generation.pricingBreakdown,  // 🆕
      errorMessage: generation.errorMessage,
      prompt: generation.prompt,
      params: generation.params,
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
        tokensCost: g.tokensCost,
        costInDollars: g.costInDollars,    // 🆕
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
   */
  async refundGeneration(generationId: string) {
    const generation = await this.generationModel.findById(generationId);
    if (!generation || generation.isRefunded) return;

    // Не возвращаем за бесплатные генерации (по подписке)
    if (!generation.tokensCost || generation.tokensCost <= 0) {
      generation.isRefunded = true;
      await generation.save();
      return;
    }

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

    generation.isRefunded = true;
    await generation.save();

    this.logger.log(
      `↩️ Refunded ${generation.tokensCost}🔥 for generation ${generationId}`,
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // RECORD SUCCESSFUL MEDIA GENERATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * 🆕 Фиксирует успешную media-генерацию в billing.
   * Вызывается из GenerationConsumer после получения результата от провайдера.
   *
   * Идемпотентность: повторный вызов не создаст дубль транзакции
   * (защита через флаг billingRecorded в Generation).
   *
   * ВАЖНО: токены уже списаны на стадии generateImage/Video/Audio
   * (через usersService.deductTokens). Здесь только запись транзакции
   * + инкремент счётчиков freeModelAccess (через recordMediaGeneration в billing).
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

    const isFree = !generation.tokensCost || generation.tokensCost <= 0;

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
        },
      );

      // Помечаем чтобы не записать дважды (на случай retry в очереди)
      await this.generationModel.updateOne(
        { _id: generation._id },
        { $set: { billingRecorded: true } },
      );

      this.logger.log(
        `💰 Billing recorded: ${generation.modelSlug} | ${generation.tokensCost || 0}🔥${isFree ? ' (free)' : ''
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
    const totalBalance = user.tokenBalance + user.bonusTokens;
    if (totalBalance < cost) {
      throw new BadRequestException(
        `Insufficient tokens. Need ${cost}, have ${totalBalance}`,
      );
    }
  }
}