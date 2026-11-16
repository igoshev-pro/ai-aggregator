// src/modules/generation/queues/generation.consumer.ts
import {
  isNonRetryableProviderError,
  userFacingGenerationError,
} from '../../../common/errors/provider-outage';
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
  // Провайдеры (ключи реестра), на которых задача уже упала — следующий
  // retry Bull начнёт с другого провайдера из providerMappings.
  excludeProviders?: string[];
}

// Ошибка попытки: какой провайдер упал и есть ли смысл повторять.
interface AttemptError extends Error {
  providerSlug?: string;
  retryable?: boolean;
}

function attemptError(
  message: string,
  retryable: boolean,
  providerSlug?: string,
): AttemptError {
  const err: AttemptError = new Error(message);
  err.retryable = retryable;
  err.providerSlug = providerSlug;
  return err;
}

// Сколько ждём асинхронную задачу провайдера. Bull-таймаут задачи
// (generation.service: image 780с, video 1200с, audio 900с) должен быть больше
// этого окна + создания задачи (HTTP до 120с) + сохранения в S3.
const POLL_INTERVAL_MS = 5000;
const POLL_WINDOW_MS: Record<string, number> = {
  [GenerationType.IMAGE]: 8 * 60_000,
  [GenerationType.VIDEO]: 15 * 60_000,
  [GenerationType.AUDIO]: 10 * 60_000,
};
// Подряд идущих сбоев опроса (сеть, 5xx, код ≠ 200 в теле), после которых
// сдаёмся. Настоящий state=fail у провайдера — провал сразу, без ожидания.
const MAX_CONSECUTIVE_POLL_ERRORS = 8;

// Есть ли в ответе провайдера хоть какой-то результат
function hasProviderResult(
  urls: string[] | undefined,
  content?: string,
  metadata?: Record<string, any>,
): boolean {
  if (Array.isArray(urls) && urls.some((u) => typeof u === 'string' && u.length > 0)) {
    return true;
  }
  if (typeof content === 'string' && content.trim().length > 0) return true;
  // Gemini Omni Audio: результат — объект голосового профиля, без URL
  return !!metadata?.resultObject;
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
    const excludeProviders = job.data.excludeProviders || [];
    const attemptInfo = `attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1}`;
    // Провайдер текущей попытки — чтобы записать его в excludeProviders при сбое
    let activeProvider: string | undefined;

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

      const execOptions = { excludeProviders };

      switch (type) {
        case GenerationType.IMAGE:
          result = await this.aiProvidersService.generateImage(modelSlug, request, execOptions);
          break;
        case GenerationType.VIDEO:
          // idempotencyKey — Higgsfield: повтор задачи вернёт тот же request_id
          result = await this.aiProvidersService.generateVideo(
            modelSlug,
            { ...request, idempotencyKey: generationId },
            execOptions,
          );
          break;
        case GenerationType.AUDIO:
          result = await this.aiProvidersService.generateAudio(modelSlug, request, execOptions);
          break;
        default:
          throw attemptError(`Unsupported generation type: ${type}`, false);
      }

      activeProvider =
        result.providerSlug && result.providerSlug !== 'none'
          ? result.providerSlug
          : undefined;

      if (!result.success) {
        throw attemptError(
          result.error?.message || 'Generation failed',
          // retryable=false — модерация/параметры: повтор Bull не поможет
          result.error?.retryable !== false,
          activeProvider,
        );
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

      // Провайдер сказал «готово», но ничего не отдал — это сбой, а не успех:
      // не списываем, пробуем ещё раз (на другом провайдере).
      if (!hasProviderResult(providerUrls, result.data?.content, result.data?.metadata)) {
        throw attemptError('Provider returned empty result', true, activeProvider);
      }

      // Ответ пришёл после того, как Bull снял задачу по таймауту и
      // генерацию уже признали упавшей (спички возвращены) — не трогаем.
      const beforeSave = await this.generationService.getRawGeneration(generationId);
      if (
        beforeSave &&
        (beforeSave.isRefunded || beforeSave.status === GenerationStatus.FAILED)
      ) {
        this.logger.warn(
          `Gen ${generationId}: late sync result from ${activeProvider} after final failure — dropped`,
        );
        return;
      }

      const { storageUrls, storageKeys } = await this.saveToStorage(
        providerUrls,
        userId,
        type,
      );
      this.assertNoInlineData(storageUrls, providerUrls, activeProvider);

      const syncUpdate: any = {
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
      };

      // 🔧 Сохраняем metadata из preCharge (freeAccess и т.д.),
      //    добавляем поля от провайдера только если они есть.
      if (
        result.data?.metadata &&
        Object.keys(result.data.metadata).length > 0
      ) {
        const current = await this.generationService.getRawGeneration(generationId);
        syncUpdate.metadata = {
          ...(current?.metadata || {}),
          ...result.data.metadata,
        };
      }

      await this.generationService.updateGeneration(generationId, syncUpdate);

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
      // когда все попытки исчерпаны (или задача снята через discard).
      const failedProvider: string | undefined =
        (error as AttemptError)?.providerSlug || activeProvider;
      const retryable = (error as AttemptError)?.retryable !== false;

      this.logger.warn(
        `⚠️ Generation ${generationId} attempt failed (${attemptInfo}, provider=${failedProvider || '?'}, ` +
          `retryable=${retryable}): ${error.message}`,
      );

      // Сырой текст провайдера — для аудита (scripts/failures-report.js).
      // errorMessage не трогаем: его пишет onFailed понятным пользователю текстом.
      try {
        const auditUpdate: Record<string, any> = {
          providerError: `[${failedProvider || '?'} · ${attemptInfo}] ${String(error.message || '').substring(0, 2000)}`,
        };
        if (failedProvider) auditUpdate.providerSlug = failedProvider;
        await this.generationService.updateGeneration(generationId, auditUpdate);
      } catch (auditErr: any) {
        this.logger.error(`Failed to save providerError for ${generationId}: ${auditErr.message}`);
      }

      if (!retryable) {
        // Модерация / неверные параметры — повтор бессмыслен. discard()
        // запрещает Bull retry; onFailed увидит isDiscarded() и сделает возврат.
        await job.discard();
      } else if (failedProvider) {
        // Следующая попытка — на следующем провайдере из providerMappings
        await this.addExcludedProvider(job, failedProvider);
      }

      throw error; // Bull увидит ошибку и сделает retry (или финальный fail)
    }
  }

  private async addExcludedProvider(job: Job<GenerationJobData>, providerSlug: string) {
    const current = job.data.excludeProviders || [];
    if (current.includes(providerSlug)) return;
    try {
      await job.update({ ...job.data, excludeProviders: [...current, providerSlug] });
    } catch (err: any) {
      this.logger.warn(
        `Failed to record excluded provider ${providerSlug} for job ${job.id}: ${err.message}`,
      );
    }
  }

  // Результат пришёл base64 (OpenRouter), а S3 не принял — в БД и в WS
  // мегабайты data: не пишем, считаем попытку неудачной.
  private assertNoInlineData(
    storageUrls: string[],
    providerUrls: string[],
    providerSlug?: string,
  ) {
    const finalUrls = storageUrls.length ? storageUrls : providerUrls;
    if (finalUrls.some((u) => typeof u === 'string' && u.startsWith('data:'))) {
      throw attemptError('Failed to save inline (base64) result to storage', true, providerSlug);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ФИНАЛЬНЫЙ FAIL — после исчерпания всех retry
  // ═══════════════════════════════════════════════════════════════

  @OnQueueFailed()
  async onFailed(job: Job<GenerationJobData>, error: Error) {
    const { generationId, userId } = job.data;
    const maxAttempts = job.opts.attempts ?? 1;
    // discard() (модерация/параметры) — Bull не повторит, значит это финал,
    // даже если попытки ещё остались.
    const discarded = !!(job as any).isDiscarded?.();
    const isFinalFailure = discarded || job.attemptsMade >= maxAttempts;

    if (!isFinalFailure) {
      this.logger.warn(
        `🔄 Job ${job.id} (gen ${generationId}) failed attempt ${job.attemptsMade}/${maxAttempts}, will retry: ${error.message}`,
      );
      // Таймаут Bull не проходит через catch обработчика — провайдера,
      // на котором висела задача, исключаем здесь.
      try {
        const current = await this.generationService.getRawGeneration(generationId);
        if (current?.providerSlug) {
          await this.addExcludedProvider(job, current.providerSlug);
        }
      } catch {
        // не критично
      }
      return;
    }

    this.logger.error(
      `🔴 Job ${job.id} for generation ${generationId} FINALLY failed after ${job.attemptsMade} attempts` +
        `${discarded ? ' (discarded: non-retryable)' : ''}: ${error.message}`,
    );

    try {
      // Если генерация уже успешно завершилась (race: Bull timeout vs
      // async polling, который досчитался до completed) — НЕ трогаем её
      // и НЕ возвращаем деньги.
      const current = await this.generationService.getRawGeneration(generationId);
      if (
        current &&
        (current.billingRecorded ||
          current.status === GenerationStatus.COMPLETED)
      ) {
        this.logger.warn(
          `⚠️ Gen ${generationId} already completed/billed — skip fail handling & refund`,
        );
        return;
      }

      // Пользователю — понятный русский текст; сырой — в providerError и в логе.
      const userMessage = userFacingGenerationError(error.message);

      const failUpdate: Record<string, any> = {
        status: GenerationStatus.FAILED,
        errorMessage: userMessage,
        completedAt: new Date(),
      };
      // providerError пишет обработчик попытки; если он не успел (таймаут
      // Bull), сохраняем хотя бы текст финальной ошибки. Не перезаписываем.
      if (!(current as any)?.providerError) {
        failUpdate.providerError =
          `[${current?.providerSlug || '?'} · attempt ${job.attemptsMade}/${maxAttempts}] ` +
          String(error.message || '').substring(0, 2000);
      }

      await this.generationService.updateGeneration(generationId, failUpdate);

      await this.generationService.refundGeneration(generationId);

      this.generationGateway.sendToUser(userId, 'generation:failed', {
        generationId,
        status: GenerationStatus.FAILED,
        errorMessage: userMessage,
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
    const maxAttempts = Math.ceil(
      (POLL_WINDOW_MS[type] ?? POLL_WINDOW_MS[GenerationType.VIDEO]) / POLL_INTERVAL_MS,
    );
    let attempts = 0;
    let consecutivePollErrors = 0;

    await this.generationService.updateGeneration(generationId, {
      taskId,
      providerSlug,
    });

    while (attempts < maxAttempts) {
      attempts++;
      await this.sleep(POLL_INTERVAL_MS);

      // Осиротевший опрос: Bull уже снял попытку по таймауту, генерация
      // провалена/возвращена или её ведёт новая попытка (другой taskId).
      // Дальше не опрашиваем и ничего не списываем.
      const current = await this.generationService.getRawGeneration(generationId);
      if (
        !current ||
        current.status === GenerationStatus.FAILED ||
        current.status === GenerationStatus.COMPLETED ||
        current.isRefunded ||
        current.billingRecorded ||
        (current.taskId && current.taskId !== taskId)
      ) {
        this.logger.warn(
          `Poll ${generationId}: stop polling task ${taskId} — generation is ` +
            `${current ? `${current.status}${current.isRefunded ? ', refunded' : ''}, taskId=${current.taskId}` : 'missing'}`,
        );
        return;
      }

      let taskResult;
      try {
        taskResult = await this.aiProvidersService.checkTaskStatus(
          providerSlug,
          taskId,
        );
      } catch (error: any) {
        // Сеть / HTTP / код ≠ 200 при опросе — временный сбой, не провал задачи
        consecutivePollErrors++;
        this.logger.warn(
          `Poll error for ${generationId} (${consecutivePollErrors}/${MAX_CONSECUTIVE_POLL_ERRORS}): ${error.message}`,
        );
        if (consecutivePollErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          throw attemptError(
            `Generation failed after ${consecutivePollErrors} consecutive errors: ${error.message}`,
            true,
            providerSlug,
          );
        }
        continue;
      }
      consecutivePollErrors = 0;

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

        // «Готово» без результата — сбой провайдера, не списываем
        if (!hasProviderResult(providerUrls, undefined, taskResult.metadata)) {
          throw attemptError('Provider returned empty result', true, providerSlug);
        }

        const { storageUrls, storageKeys } = await this.saveToStorage(
          providerUrls,
          userId,
          type,
        );
        this.assertNoInlineData(storageUrls, providerUrls, providerSlug);

        // Собираем апдейт, metadata мерджим только если пришла
        const completedUpdate: any = {
          status: GenerationStatus.COMPLETED,
          resultUrls: storageUrls.length ? storageUrls : providerUrls,
          storageUrls,
          storageKeys,
          savedToStorage: storageUrls.length > 0,
          completedAt: new Date(),
          progress: 100,
        };

        // 🔧 Сохраняем metadata из preCharge (freeAccess и т.д.),
        //    добавляем поля от провайдера только если они есть.
        if (
          taskResult.metadata &&
          Object.keys(taskResult.metadata).length > 0
        ) {
          const fresh = await this.generationService.getRawGeneration(generationId);
          completedUpdate.metadata = {
            ...(fresh?.metadata || {}),
            ...taskResult.metadata, // например { audioIds } для Suno
          };
        }

        await this.generationService.updateGeneration(
          generationId,
          completedUpdate,
        );

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
      // Провайдер явно сказал «fail» — повторять опрос незачем.
      // Модерация/параметры — без retry; прочее — retry на другом провайдере.
      if (taskResult.status === 'failed') {
        const errorMsg = taskResult.error || 'Task failed at provider';
        this.logger.warn(`Poll ${generationId}: provider returned fail: ${errorMsg}`);
        throw attemptError(
          `Provider task failed: ${errorMsg}`,
          !isNonRetryableProviderError(errorMsg),
          providerSlug,
        );
      }
    }

    throw attemptError(
      `Generation timeout: task ${taskId} did not complete after ${maxAttempts} attempts`,
      true,
      providerSlug,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}