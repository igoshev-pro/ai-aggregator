import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { forwardRef, Inject, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { GenerationService } from '../generation.service';
import { AiProvidersService } from '../../ai-providers/ai-providers.service';
import { GenerationStatus, GenerationType } from '@/common/interfaces';
import { GenerationGateway } from '../generation.gateway';

interface GenerationJobData {
  generationId: string;
  userId: string;
  type: GenerationType;
  modelSlug: string;
  request: any;
}

@Processor('generation')
export class GenerationConsumer {
  private readonly logger = new Logger(GenerationConsumer.name);

  constructor(
    @Inject(forwardRef(() => GenerationService))
    private generationService: GenerationService,
    @Inject(forwardRef(() => AiProvidersService))
    private aiProvidersService: AiProvidersService,
    private generationGateway: GenerationGateway,
  ) {}

  @Process('process-generation')
  async handleGeneration(job: Job<GenerationJobData>) {
    const { generationId, userId, type, modelSlug, request } = job.data;

    this.logger.log(
      `Processing ${type} generation ${generationId} with model ${modelSlug}`,
    );

    // Обновляем статус на processing
    await this.generationService.updateGeneration(generationId, {
      status: GenerationStatus.PROCESSING,
      startedAt: new Date(),
    });

    // Уведомляем по WebSocket
    this.generationGateway.sendToUser(userId, 'generation:status', {
      generationId,
      status: GenerationStatus.PROCESSING,
    });

    try {
      let result;

      switch (type) {
        case GenerationType.IMAGE:
          result = await this.aiProvidersService.generateImage(modelSlug, request);
          break;
        case GenerationType.VIDEO:
          result = await this.aiProvidersService.generateVideo(modelSlug, request);
          break;
        case GenerationType.AUDIO:
          result = await this.aiProvidersService.generateAudio(modelSlug, request);
          break;
        default:
          throw new Error(`Unsupported generation type: ${type}`);
      }

      if (!result.success) {
        throw new Error(result.error?.message || 'Generation failed');
      }

      // Если есть taskId — это async генерация, нужен polling
      if (result.data?.taskId && (!result.data?.urls || result.data.urls.length === 0)) {
        await this.pollTaskUntilComplete(
          generationId,
          userId,
          result.providerSlug,
          result.data.taskId,
          type,
        );
        return;
      }

      // Результат уже готов
      const now = new Date();
      await this.generationService.updateGeneration(generationId, {
        status: GenerationStatus.COMPLETED,
        resultUrls: result.data?.urls || [],
        resultContent: result.data?.content,
        providerSlug: result.providerSlug,
        responseTimeMs: result.responseTimeMs,
        completedAt: now,
        progress: 100,
        metadata: result.data?.metadata || {},
      });

      this.generationGateway.sendToUser(userId, 'generation:completed', {
        generationId,
        status: GenerationStatus.COMPLETED,
        resultUrls: result.data?.urls || [],
        resultContent: result.data?.content,
        responseTimeMs: result.responseTimeMs,
      });

      this.logger.log(
        `✅ Generation ${generationId} completed in ${result.responseTimeMs}ms`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Generation ${generationId} failed: ${error.message}`,
      );

      await this.generationService.updateGeneration(generationId, {
        status: GenerationStatus.FAILED,
        errorMessage: error.message,
        completedAt: new Date(),
      });

      // Рефанд токенов
      await this.generationService.refundGeneration(generationId);

      this.generationGateway.sendToUser(userId, 'generation:failed', {
        generationId,
        status: GenerationStatus.FAILED,
        errorMessage: error.message,
        refunded: true,
      });

      throw error; // Пробросить чтобы Bull retry сработал
    }
  }

  /**
   * Polling async задачи до завершения
   */
  private async pollTaskUntilComplete(
    generationId: string,
    userId: string,
    providerSlug: string,
    taskId: string,
    type: GenerationType,
  ) {
    const maxAttempts = 120; // 10 минут при интервале 5 сек
    const pollInterval = 5000;
    let attempts = 0;

    // Сохраняем taskId
    await this.generationService.updateGeneration(generationId, {
      taskId,
      providerSlug,
    });

    while (attempts < maxAttempts) {
      attempts++;
      await this.sleep(pollInterval);

      try {
        const taskResult = await this.aiProvidersService.checkTaskStatus(
          providerSlug,
          taskId,
        );

        this.logger.debug(
          `Poll ${generationId}: attempt ${attempts}, status: ${taskResult.status}, progress: ${taskResult.progress}`,
        );

        // Обновляем прогресс
        if (taskResult.progress !== undefined || taskResult.eta !== undefined) {
          await this.generationService.updateGeneration(generationId, {
            progress: taskResult.progress || 0,
            eta: taskResult.eta,
          });

          this.generationGateway.sendToUser(userId, 'generation:progress', {
            generationId,
            progress: taskResult.progress || 0,
            eta: taskResult.eta,
            status: GenerationStatus.PROCESSING,
          });
        }

        if (taskResult.status === 'completed') {
          const now = new Date();
          await this.generationService.updateGeneration(generationId, {
            status: GenerationStatus.COMPLETED,
            resultUrls: taskResult.resultUrls || [],
            completedAt: now,
            progress: 100,
          });

          this.generationGateway.sendToUser(userId, 'generation:completed', {
            generationId,
            status: GenerationStatus.COMPLETED,
            resultUrls: taskResult.resultUrls || [],
          });

          this.logger.log(`✅ Async generation ${generationId} completed`);
          return;
        }

        if (taskResult.status === 'failed') {
          throw new Error(taskResult.error || 'Task failed at provider');
        }
      } catch (error) {
        if (error.message.includes('Task failed')) {
          throw error;
        }
        // Network error — continue polling
        this.logger.warn(
          `Poll error for ${generationId}: ${error.message}, retrying...`,
        );
      }
    }

    // Timeout
    throw new Error(
      `Generation timeout: task ${taskId} did not complete in ${(maxAttempts * pollInterval) / 1000} seconds`,
    );
  }

  @OnQueueFailed()
  async onFailed(job: Job<GenerationJobData>, error: Error) {
    this.logger.error(
      `Job ${job.id} for generation ${job.data.generationId} failed after ${job.attemptsMade} attempts: ${error.message}`,
    );

    // На последней попытке — финальный refund уже сделан в catch
    if (job.attemptsMade >= (job.opts.attempts || 3)) {
      this.logger.error(
        `Generation ${job.data.generationId} permanently failed`,
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}