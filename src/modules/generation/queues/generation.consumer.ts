// src/modules/generation/queues/generation.consumer.ts
import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { forwardRef, Inject, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { GenerationService } from '../generation.service';
import { AiProvidersService } from '../../ai-providers/ai-providers.service';
import { GenerationStatus, GenerationType } from '@/common/interfaces';
import { GenerationGateway } from '../generation.gateway';
import { StorageService } from '../../storage/storage.service';

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
    private storageService: StorageService,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // ОСНОВНОЙ ОБРАБОТЧИК
  // ═══════════════════════════════════════════════════════════════

  @Process('process-generation')
  async handleGeneration(job: Job<GenerationJobData>) {
    const { generationId, userId, type, modelSlug, request } = job.data;
    const attemptInfo = `attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1}`;

    this.logger.log(
      `Processing ${type} generation ${generationId} with model ${modelSlug} (${attemptInfo})`,
    );

    await this.generationService.updateGeneration(generationId, {
      status: GenerationStatus.PROCESSING,
      startedAt: new Date(),
    });

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

      // ─── ASYNC TASK (poll until ready) ─────────────────────────
      if (
        result.data?.taskId &&
        (!result.data?.urls || result.data.urls.length === 0)
      ) {
        await this.pollTaskUntilComplete(
          generationId,
          userId,
          result.providerSlug,
          result.data.taskId,
          type,
        );
        return;
      }

      // ─── SYNC RESULT ───────────────────────────────────────────
      const providerUrls: string[] = result.data?.urls || [];
      const { storageUrls, storageKeys } = await this.saveToStorage(
        providerUrls,
        userId,
        type,
      );

      await this.generationService.updateGeneration(generationId, {
        status: GenerationStatus.COMPLETED,
        resultUrls: storageUrls.length ? storageUrls : providerUrls,
        storageUrls,
        storageKeys,
        savedToStorage: storageUrls.length > 0,
        resultContent: result.data?.content,
        providerSlug: result.providerSlug,
        responseTimeMs: result.responseTimeMs,
        completedAt: new Date(),
        progress: 100,
        metadata: result.data?.metadata || {},
      });

      // 🆕 ЗАПИСЫВАЕМ ТРАНЗАКЦИЮ В BILLING
      await this.generationService.recordSuccessfulGeneration(generationId);

      this.generationGateway.sendToUser(userId, 'generation:completed', {
        generationId,
        status: GenerationStatus.COMPLETED,
        resultUrls: storageUrls.length ? storageUrls : providerUrls,
        resultContent: result.data?.content,
        responseTimeMs: result.responseTimeMs,
      });

      this.logger.log(
        `✅ Generation ${generationId} completed in ${result.responseTimeMs}ms, saved to S3: ${storageUrls.length} files`,
      );
    } catch (error: any) {
      // ⚠️ ВАЖНО: НЕ делаем refund здесь — Bull может сделать retry.
      // Refund + WS-уведомление "failed" происходит ТОЛЬКО в @OnQueueFailed(),
      // когда все попытки исчерпаны.
      this.logger.warn(
        `⚠️ Generation ${generationId} attempt failed (${attemptInfo}): ${error.message}`,
      );

      // Сохраняем последнюю ошибку для аудита
      await this.generationService.updateGeneration(generationId, {
        errorMessage: error.message,
      });

      throw error; // Bull увидит ошибку и сделает retry (или финальный fail)
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ФИНАЛЬНЫЙ FAIL — после исчерпания всех retry
  // ═══════════════════════════════════════════════════════════════

  @OnQueueFailed()
  async onFailed(job: Job<GenerationJobData>, error: Error) {
    const { generationId, userId } = job.data;
    const maxAttempts = job.opts.attempts ?? 1;
    const isFinalFailure = job.attemptsMade >= maxAttempts;

    if (!isFinalFailure) {
      this.logger.warn(
        `🔄 Job ${job.id} (gen ${generationId}) failed attempt ${job.attemptsMade}/${maxAttempts}, will retry: ${error.message}`,
      );
      return;
    }

    this.logger.error(
      `🔴 Job ${job.id} for generation ${generationId} FINALLY failed after ${job.attemptsMade} attempts: ${error.message}`,
    );

    try {
      // 1) Помечаем генерацию как окончательно failed
      await this.generationService.updateGeneration(generationId, {
        status: GenerationStatus.FAILED,
        errorMessage: error.message,
        completedAt: new Date(),
      });

      // 2) Возвращаем токены (идемпотентно — через флаг isRefunded)
      await this.generationService.refundGeneration(generationId);

      // 3) Уведомляем пользователя
      this.generationGateway.sendToUser(userId, 'generation:failed', {
        generationId,
        status: GenerationStatus.FAILED,
        errorMessage: error.message,
        refunded: true,
      });
    } catch (handlerError: any) {
      this.logger.error(
        `❌ Critical: failed to handle final failure for gen ${generationId}: ${handlerError.message}`,
        handlerError.stack,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIVATE: SAVE TO S3
  // ═══════════════════════════════════════════════════════════════

  private async saveToStorage(
    urls: string[],
    userId: string,
    type: GenerationType,
  ): Promise<{ storageUrls: string[]; storageKeys: string[] }> {
    if (!urls.length) return { storageUrls: [], storageKeys: [] };

    const mediaType =
      type === GenerationType.IMAGE
        ? 'image'
        : type === GenerationType.VIDEO
        ? 'video'
        : 'audio';

    try {
      const results = await Promise.all(
        urls.map((url) =>
          this.storageService.downloadAndSave(url, userId, mediaType),
        ),
      );

      const storageUrls = results.map((r) => r.s3Url).filter(Boolean);
      const storageKeys = results.map((r) => r.key).filter(Boolean);

      return { storageUrls, storageKeys };
    } catch (error: any) {
      this.logger.error(`S3 save failed: ${error.message}`);
      return { storageUrls: [], storageKeys: [] };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIVATE: ASYNC POLL
  // ═══════════════════════════════════════════════════════════════

  private async pollTaskUntilComplete(
    generationId: string,
    userId: string,
    providerSlug: string,
    taskId: string,
    type: GenerationType,
  ) {
    const maxAttempts = 120;
    const maxConsecutiveFailures = 3;
    const pollInterval = 5000;
    let attempts = 0;
    let consecutiveFailures = 0;

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
          `Poll ${generationId}: attempt ${attempts}, status: ${taskResult.status}`,
        );

        // Обновление прогресса
        if (
          taskResult.progress !== undefined ||
          taskResult.eta !== undefined
        ) {
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

        // ─── УСПЕХ ─────────────────────────────────────────────
        if (taskResult.status === 'completed') {
          const providerUrls = taskResult.resultUrls || [];

          const { storageUrls, storageKeys } = await this.saveToStorage(
            providerUrls,
            userId,
            type,
          );

          await this.generationService.updateGeneration(generationId, {
            status: GenerationStatus.COMPLETED,
            resultUrls: storageUrls.length ? storageUrls : providerUrls,
            storageUrls,
            storageKeys,
            savedToStorage: storageUrls.length > 0,
            completedAt: new Date(),
            progress: 100,
          });

          // 🆕 ЗАПИСЫВАЕМ ТРАНЗАКЦИЮ В BILLING
          await this.generationService.recordSuccessfulGeneration(generationId);

          this.generationGateway.sendToUser(userId, 'generation:completed', {
            generationId,
            status: GenerationStatus.COMPLETED,
            resultUrls: storageUrls.length ? storageUrls : providerUrls,
          });

          this.logger.log(`✅ Async generation ${generationId} completed`);
          return;
        }

        // ─── НЕУДАЧА от провайдера ─────────────────────────────
        if (taskResult.status === 'failed') {
          consecutiveFailures++;
          const errorMsg = taskResult.error || 'Task failed at provider';
          this.logger.warn(
            `Poll ${generationId}: provider returned fail (${consecutiveFailures}/${maxConsecutiveFailures}): ${errorMsg}`,
          );

          if (consecutiveFailures >= maxConsecutiveFailures) {
            throw new Error(`Provider task failed: ${errorMsg}`);
          }
          continue;
        }

        // Задача всё ещё processing — сбрасываем счётчик ошибок
        consecutiveFailures = 0;
      } catch (error: any) {
        if (error.message.startsWith('Provider task failed:')) {
          throw error;
        }

        consecutiveFailures++;
        this.logger.warn(
          `Poll error for ${generationId} (${consecutiveFailures}/${maxConsecutiveFailures}): ${error.message}`,
        );

        if (consecutiveFailures >= maxConsecutiveFailures) {
          throw new Error(
            `Generation failed after ${consecutiveFailures} consecutive errors: ${error.message}`,
          );
        }
      }
    }

    throw new Error(
      `Generation timeout: task ${taskId} did not complete after ${maxAttempts} attempts`,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}