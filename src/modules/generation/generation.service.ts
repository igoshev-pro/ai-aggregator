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
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { UsersService } from '../users/users.service';
import { BillingService } from '../billing/billing.service';
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
    @InjectModel(Generation.name) private generationModel: Model<GenerationDocument>,
    @InjectQueue('generation') private generationQueue: Queue,
    @Inject(forwardRef(() => AiProvidersService))
    private aiProvidersService: AiProvidersService,
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
    @Inject(forwardRef(() => BillingService))
    private billingService: BillingService,
  ) {}

  async generateImage(userId: string, dto: ImageGenerationDto) {
    const model = await this.aiProvidersService.getModelBySlug(dto.modelSlug);

    const { costInTokens } = await this.billingService.calculateGenerationCost(dto.modelSlug);

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
      },
      tokensCost: costInTokens,
    });
    await generation.save();

    await this.usersService.deductTokens(userId, costInTokens, 'generation_reserve');

    const p = generation.params as {
      width?: number;
      height?: number;
      aspectRatio?: string;
      resolution?: string;
      quality?: string;
      outputFormat?: string;
      steps?: number;
      seed?: number;
      numImages?: number;
      style?: string;
      inputUrls?: string[];
    };

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
          inputUrls: p.inputUrls,
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
    };
  }

  async generateVideo(userId: string, dto: VideoGenerationDto) {
    const model = await this.aiProvidersService.getModelBySlug(dto.modelSlug);

    const { costInTokens } = await this.billingService.calculateGenerationCost(dto.modelSlug);

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
        duration: dto.duration || (model.defaultParams as any)?.duration || 5,
        aspectRatio: dto.aspectRatio || (model.defaultParams as any)?.aspectRatio || '16:9',
        resolution: dto.resolution || (model.defaultParams as any)?.resolution || '720p',
        mode: dto.mode,
        quality: dto.quality,
        sound: dto.sound,
        removeWatermark: dto.removeWatermark,
        promptOptimizer: dto.promptOptimizer,
        waterMark: dto.waterMark,
        style: dto.style,
      },
      tokensCost: costInTokens,
    });
    await generation.save();

    await this.usersService.deductTokens(userId, costInTokens, 'generation_reserve');

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
          duration: p.duration,
          aspectRatio: p.aspectRatio,
          resolution: p.resolution,
          mode: p.mode,
          quality: p.quality,
          sound: p.sound,
          removeWatermark: p.removeWatermark,
          promptOptimizer: p.promptOptimizer,
          waterMark: p.waterMark,
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
    };
  }

  async generateAudio(userId: string, dto: AudioGenerationDto) {
    const model = await this.aiProvidersService.getModelBySlug(dto.modelSlug);

    const { costInTokens } = await this.billingService.calculateGenerationCost(dto.modelSlug);

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
        voiceId: dto.voiceId,
        language: dto.language,
      },
      tokensCost: costInTokens,
    });
    await generation.save();

    await this.usersService.deductTokens(userId, costInTokens, 'generation_reserve');

    await this.generationQueue.add(
      'process-generation',
      {
        generationId: generation._id.toString(),
        userId,
        type: GenerationType.AUDIO,
        modelSlug: dto.modelSlug,
        request: {
          prompt: dto.prompt,
          style: dto.style,
          duration: generation.params.duration,
          instrumental: generation.params.instrumental,
          voiceId: generation.params.voiceId,
          language: generation.params.language,
        },
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
    };
  }

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

  async refundGeneration(generationId: string) {
    const generation = await this.generationModel.findById(generationId);
    if (!generation || generation.isRefunded) return;

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
  }

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
     