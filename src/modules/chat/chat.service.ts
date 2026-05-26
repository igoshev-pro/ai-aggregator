// src/modules/chat/chat.service.ts

import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Conversation, ConversationDocument } from './schemas/conversation.schema';
import { Message, MessageDocument } from './schemas/message.schema';
import { AIModel, ModelDocument } from '../ai-providers/schemas/model.schema';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { UsersService } from '../users/users.service';
import { BillingService } from '../billing/billing.service';
import { ProviderRegistryService } from '../ai-providers/providers/provider-registry.service';

export interface SendMessageDto {
  conversationId?: string;
  modelSlug: string;
  content: string;
  imageUrls?: string[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

// Тип для сообщения с поддержкой vision (imageUrls)
interface ContextMessage {
  role: string;
  content: string;
  imageUrls?: string[];
}

// 🆕 Глобальный минимум для работы с чатом
const MIN_REQUIRED_BALANCE = 0.01; // минимум 0.01 🔥 чтобы вообще начать запрос

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectModel(Conversation.name) private conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    @InjectModel(AIModel.name) private modelModel: Model<ModelDocument>,
    @Inject(forwardRef(() => AiProvidersService))
    private aiProvidersService: AiProvidersService,
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
    @Inject(forwardRef(() => BillingService))
    private billingService: BillingService,
    @Inject(forwardRef(() => ProviderRegistryService))
    private providerRegistry: ProviderRegistryService,
  ) {}

  async getConversations(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [conversations, total] = await Promise.all([
      this.conversationModel
        .find({ userId: new Types.ObjectId(userId), isArchived: false })
        .sort({ isPinned: -1, lastMessageAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.conversationModel.countDocuments({
        userId: new Types.ObjectId(userId),
        isArchived: false,
      }),
    ]);

    return {
      conversations,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getMessages(userId: string, conversationId: string, page = 1, limit = 50) {
    const conversation = await this.getConversationWithAccess(userId, conversationId);

    const skip = (page - 1) * limit;
    const [messages, total] = await Promise.all([
      this.messageModel
        .find({ conversationId: conversation._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.messageModel.countDocuments({ conversationId: conversation._id }),
    ]);

    return {
      messages: messages.reverse(),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 🆕 Helper: проверка достаточности баланса по preview-цене
  // ═══════════════════════════════════════════════════════════════

  private async checkSufficientBalance(
    userId: string,
    modelSlug: string,
  ): Promise<{ ok: true; balance: number } | { ok: false; balance: number; required: number }> {
    const user = await this.usersService.findById(userId);
    const totalBalance = user.tokenBalance + user.bonusTokens;

    try {
      const preview = await this.billingService.getModelPreviewCost(modelSlug);
      const required = Math.max(preview.minCostInTokens, MIN_REQUIRED_BALANCE);

      if (totalBalance < required) {
        return { ok: false, balance: totalBalance, required };
      }
      return { ok: true, balance: totalBalance };
    } catch {
      if (totalBalance < MIN_REQUIRED_BALANCE) {
        return { ok: false, balance: totalBalance, required: MIN_REQUIRED_BALANCE };
      }
      return { ok: true, balance: totalBalance };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // sendMessage (non-stream)
  // ═══════════════════════════════════════════════════════════════

  async sendMessage(userId: string, dto: SendMessageDto) {
    this.logger.log(`📥 Received chat request:`, {
      userId,
      modelSlug: dto.modelSlug,
      contentLength: dto.content?.length,
      hasImages: !!(dto.imageUrls && dto.imageUrls.length > 0),
    });

    const model = await this.aiProvidersService.getModelBySlug(dto.modelSlug);
    if (!model) {
      this.logger.error(`❌ Model not found: ${dto.modelSlug}`);
      throw new NotFoundException(`Model ${dto.modelSlug} not found`);
    }

    this.logger.log(`✅ Model found: ${model.displayName || model.name}`);

    // ═══ VISION VALIDATION ═══
    if (dto.imageUrls && dto.imageUrls.length > 0) {
      if (!(model as any).supportsVision) {
        this.logger.warn(
          `❌ Vision blocked: model="${dto.modelSlug}" does NOT support images, but ${dto.imageUrls.length} sent`,
        );
        throw new BadRequestException(
          `Модель "${model.displayName || model.name}" не поддерживает анализ изображений. Выберите модель с vision (GPT-4o, Claude, Gemini, Grok).`,
        );
      }

      const maxImages = (model as any).inputCapabilities?.maxInputImages || 4;
      if (dto.imageUrls.length > maxImages) {
        throw new BadRequestException(
          `Слишком много изображений: ${dto.imageUrls.length}. Максимум для этой модели: ${maxImages}.`,
        );
      }

      this.logger.log(`✅ Vision allowed: ${dto.imageUrls.length} image(s) for ${dto.modelSlug}`);
    }

    const balanceCheck = await this.checkSufficientBalance(userId, dto.modelSlug);
    if (!balanceCheck.ok) {
      throw new BadRequestException(
        `Недостаточно спичек. Минимум для этой модели: ${balanceCheck.required}🔥, у вас: ${balanceCheck.balance}🔥`,
      );
    }

    let conversation: ConversationDocument;
    if (dto.conversationId) {
      conversation = await this.getConversationWithAccess(userId, dto.conversationId);
    } else {
      conversation = await this.createConversation(userId, dto);
    }

    const userMessage = new this.messageModel({
      conversationId: conversation._id,
      userId: new Types.ObjectId(userId),
      role: 'user',
      content: dto.content,
      imageUrls: dto.imageUrls || [],
    });
    await userMessage.save();

    const contextMessages = await this.buildContext(conversation, dto);

    try {
      const result = await this.aiProvidersService.generateText(dto.modelSlug, {
        messages: contextMessages,
        maxTokens: dto.maxTokens || model.defaultParams?.maxTokens || 4096,
        temperature: dto.temperature ?? model.defaultParams?.temperature ?? 0.7,
      });

      if (!result.success) {
        const errorMessage = new this.messageModel({
          conversationId: conversation._id,
          userId: new Types.ObjectId(userId),
          role: 'assistant',
          content: result.error?.message || 'Generation failed',
          modelSlug: dto.modelSlug,
          providerSlug: result.providerSlug,
          isError: true,
          errorMessage: result.error?.message,
        });
        await errorMessage.save();

        throw new BadRequestException(result.error?.message || 'Generation failed');
      }

      const { costInTokens, costInDollars } = await this.billingService.chargeForGeneration(
        userId,
        dto.modelSlug,
        'text',
        conversation._id.toString(),
        result.usage?.inputTokens,
        result.usage?.outputTokens,
      );

      this.logger.log(
        `💸 Charged: ${costInTokens}🔥 (in=${result.usage?.inputTokens}, out=${result.usage?.outputTokens}, providerCost=$${costInDollars})`,
      );

      const assistantMessage = new this.messageModel({
        conversationId: conversation._id,
        userId: new Types.ObjectId(userId),
        role: 'assistant',
        content: result.data?.content || '',
        modelSlug: dto.modelSlug,
        providerSlug: result.providerSlug,
        usage: result.usage,
        responseTimeMs: result.responseTimeMs,
        tokensCost: costInTokens,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
      });
      await assistantMessage.save();

      conversation.messageCount += 2;
      conversation.totalTokensUsed += result.usage?.totalTokens || 0;
      conversation.lastMessageAt = new Date();

      if (conversation.messageCount <= 2) {
        conversation.title = this.generateTitle(dto.content);
      }
      await conversation.save();

      await this.usersService.incrementDailyGenerations(userId);

      return {
        message: assistantMessage,
        conversation: {
          id: conversation._id,
          title: conversation.title,
        },
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`Chat generation error: ${error.message}`);
      throw new BadRequestException('Failed to generate response');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // streamMessage
  // ═══════════════════════════════════════════════════════════════

  async *streamMessage(
    userId: string,
    dto: SendMessageDto,
  ): AsyncGenerator<{ type: string; data: any }> {
    this.logger.debug(`=== STREAM MESSAGE: user=${userId}, model=${dto.modelSlug} ===`);

    try {
      // 1. Проверка пользователя
      const user = await this.usersService.findById(userId);
      if (!user) {
        yield { type: 'error', data: { message: 'User not found' } };
        return;
      }

      // 2. Проверка модели
      const model = await this.aiProvidersService.getModelBySlug(dto.modelSlug);
      if (!model) {
        this.logger.warn(`Model not found: ${dto.modelSlug}`);
        yield { type: 'error', data: { message: `Model ${dto.modelSlug} not found` } };
        return;
      }

      // ═══ VISION VALIDATION ═══
      if (dto.imageUrls && dto.imageUrls.length > 0) {
        if (!(model as any).supportsVision) {
          yield {
            type: 'error',
            data: {
              message: `Модель "${model.displayName || model.name}" не поддерживает анализ изображений. Выберите модель с vision (GPT-4o, Claude, Gemini, Grok).`,
            },
          };
          return;
        }

        const maxImages = (model as any).inputCapabilities?.maxInputImages || 4;
        if (dto.imageUrls.length > maxImages) {
          yield {
            type: 'error',
            data: {
              message: `Слишком много изображений: ${dto.imageUrls.length}. Максимум для этой модели: ${maxImages}.`,
            },
          };
          return;
        }
      }

      // 3. Проверка баланса
      const balanceCheck = await this.checkSufficientBalance(userId, dto.modelSlug);
      if (!balanceCheck.ok) {
        yield {
          type: 'error',
          data: {
            message: `Недостаточно спичек. Минимум для этой модели: ${balanceCheck.required}🔥, у вас: ${balanceCheck.balance}🔥`,
          },
        };
        return;
      }

      // 4. Создание/получение conversation
      let conversation: ConversationDocument;
      if (dto.conversationId) {
        conversation = await this.getConversationWithAccess(userId, dto.conversationId);
      } else {
        conversation = await this.createConversation(userId, dto);
      }

      yield {
        type: 'conversation',
        data: { id: conversation._id.toString(), title: conversation.title },
      };

      // 5. Сохранение сообщения пользователя
      const userMessage = new this.messageModel({
        conversationId: conversation._id,
        userId: new Types.ObjectId(userId),
        role: 'user',
        content: dto.content,
        imageUrls: dto.imageUrls || [],
      });
      await userMessage.save();

      // 6. Построение контекста
      const contextMessages = await this.buildContext(conversation, dto);

      // 7. Создание сообщения ассистента (placeholder)
      const assistantMessage = new this.messageModel({
        conversationId: conversation._id,
        userId: new Types.ObjectId(userId),
        role: 'assistant',
        content: '',
        modelSlug: dto.modelSlug,
        isStreaming: true,
      });
      await assistantMessage.save();

      yield {
        type: 'message_start',
        data: { messageId: assistantMessage._id.toString() },
      };

      // 8. Начало стриминга
      let fullContent = '';
      let lastUsage: any = null;
      let success = false;
      let costInTokens = 0;

      try {
        const stream = this.aiProvidersService.generateTextStream(dto.modelSlug, {
          messages: contextMessages,
          maxTokens: dto.maxTokens || model.defaultParams?.maxTokens || 4096,
          temperature: dto.temperature ?? model.defaultParams?.temperature ?? 0.7,
          stream: true,
        });

        for await (const chunk of stream) {
          const chunkError = (chunk as any).error;
          if (chunkError) {
            this.logger.error(`Stream error in chunk: ${chunkError}`);
            yield {
              type: 'error',
              data: { message: chunkError },
            };
            success = false;
            break;
          }

          if (chunk.content) {
            if (chunk.content.startsWith('Error:') && chunk.done) {
              this.logger.error(`Stream returned legacy error: ${chunk.content}`);
              yield {
                type: 'error',
                data: { message: chunk.content },
              };
              success = false;
              break;
            }

            fullContent += chunk.content;
            yield {
              type: 'text_delta',
              data: { content: chunk.content },
            };
          }

          if (chunk.done) {
            if (chunk.usage) lastUsage = chunk.usage;
            success = fullContent.length > 0;
            if (!success) {
              this.logger.error('Stream ended with empty content — likely a provider error');
              yield {
                type: 'error',
                data: { message: 'Model returned empty response. Please try again.' },
              };
            }
            break;
          }
        }
      } catch (error: any) {
        this.logger.error(`Stream error: ${error.message}`);
        yield {
          type: 'error',
          data: { message: error.message || 'Stream generation failed' },
        };
        success = false;
      }

      // 9. Сохранение результата
      if (success && fullContent) {
        const { costInTokens: billedTokens, costInDollars } =
          await this.billingService.chargeForGeneration(
            userId,
            dto.modelSlug,
            'text',
            conversation._id.toString(),
            lastUsage?.inputTokens,
            lastUsage?.outputTokens,
          );

        costInTokens = billedTokens;

        this.logger.log(
          `💸 [stream] Charged: ${costInTokens}🔥 (in=${lastUsage?.inputTokens}, out=${lastUsage?.outputTokens}, providerCost=$${costInDollars})`,
        );

        // ✅ Обновляем сообщение ассистента
        assistantMessage.content = fullContent;
        assistantMessage.isStreaming = false;
        assistantMessage.providerSlug = (model as any).providerSlug;
        assistantMessage.usage = lastUsage;
        assistantMessage.tokensCost = costInTokens;
        assistantMessage.inputTokens = lastUsage?.inputTokens;
        assistantMessage.outputTokens = lastUsage?.outputTokens;
        await assistantMessage.save();

        // ✅ Обновляем conversation
        conversation.messageCount += 2;
        conversation.totalTokensUsed += lastUsage?.totalTokens || 0;
        conversation.lastMessageAt = new Date();

        if (conversation.messageCount <= 2) {
          conversation.title = this.generateTitle(dto.content);
        }
        await conversation.save();

        await this.usersService.incrementDailyGenerations(userId);
      } else if (!success) {
        // Чистим плейсхолдер если ничего не вышло
        await this.messageModel.findByIdAndDelete(assistantMessage._id);
      }

      yield {
        type: 'message_end',
        data: {
          messageId: assistantMessage._id.toString(),
          usage: lastUsage,
          tokensCost: success ? costInTokens : 0,
        },
      };

      this.logger.debug('=== END STREAM MESSAGE ===');
    } catch (error: any) {
      this.logger.error(`FATAL ERROR in streamMessage: ${error.message}`, error.stack);
      yield {
        type: 'error',
        data: { message: 'Internal server error' },
      };
    }
  }

  async createConversation(
    userId: string,
    dto: Partial<SendMessageDto>,
  ): Promise<ConversationDocument> {
    const conversation = new this.conversationModel({
      userId: new Types.ObjectId(userId),
      modelSlug: dto.modelSlug,
      systemPrompt: dto.systemPrompt,
      settings: {
        temperature: dto.temperature,
        maxTokens: dto.maxTokens,
      },
      lastMessageAt: new Date(),
    });
    return conversation.save();
  }

  async deleteConversation(userId: string, conversationId: string) {
    const conversation = await this.getConversationWithAccess(userId, conversationId);
    await this.messageModel.deleteMany({ conversationId: conversation._id });
    await this.conversationModel.findByIdAndDelete(conversation._id);
    return { deleted: true };
  }

  async renameConversation(userId: string, conversationId: string, title: string) {
    const conversation = await this.getConversationWithAccess(userId, conversationId);
    conversation.title = title;
    await conversation.save();
    return conversation;
  }

  async togglePin(userId: string, conversationId: string) {
    const conversation = await this.getConversationWithAccess(userId, conversationId);
    conversation.isPinned = !conversation.isPinned;
    await conversation.save();
    return conversation;
  }

  /**
   * Строит контекст для AI-провайдера с поддержкой vision (imageUrls).
   */
  private async buildContext(
    conversation: ConversationDocument,
    dto: SendMessageDto,
  ): Promise<ContextMessage[]> {
    const messages: ContextMessage[] = [];

    const systemPrompt = dto.systemPrompt || conversation.systemPrompt;
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    const maxContextMessages = 20;
    const history = await this.messageModel
      .find({
        conversationId: conversation._id,
        isError: false,
        isStreaming: false,
      })
      .sort({ createdAt: -1 })
      .limit(maxContextMessages)
      .exec();

    const orderedHistory = history.reverse();

    for (const msg of orderedHistory) {
      const contextMsg: ContextMessage = {
        role: msg.role,
        content: msg.content,
      };

      const msgImages = (msg as any).imageUrls;
      if (Array.isArray(msgImages) && msgImages.length > 0) {
        contextMsg.imageUrls = msgImages;
      }

      messages.push(contextMsg);
    }

    const lastUserMsg: ContextMessage = {
      role: 'user',
      content: dto.content,
    };
    if (dto.imageUrls && dto.imageUrls.length > 0) {
      lastUserMsg.imageUrls = dto.imageUrls;
    }
    messages.push(lastUserMsg);

    return messages;
  }

  private async getConversationWithAccess(
    userId: string,
    conversationId: string,
  ): Promise<ConversationDocument> {
    const conversation = await this.conversationModel.findById(conversationId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    if (conversation.userId.toString() !== userId) {
      throw new ForbiddenException('Access denied to this conversation');
    }
    return conversation;
  }

  private generateTitle(content: string): string {
    const cleaned = content.replace(/\n/g, ' ').trim();
    return cleaned.length > 50 ? cleaned.substring(0, 50) + '...' : cleaned;
  }
}