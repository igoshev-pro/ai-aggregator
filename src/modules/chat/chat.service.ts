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
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { UsersService } from '../users/users.service';
import { BillingService } from '../billing/billing.service';
import { StreamChunk } from '../ai-providers/providers/base-provider.abstract';

export interface SendMessageDto {
  conversationId?: string;
  modelSlug: string;
  content: string;
  imageUrls?: string[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectModel(Conversation.name) private conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    @Inject(forwardRef(() => AiProvidersService))
    private aiProvidersService: AiProvidersService,
    @Inject(forwardRef(() => UsersService))
    private usersService: UsersService,
    @Inject(forwardRef(() => BillingService))
    private billingService: BillingService,
  ) {}

  /**
   * Получить все чаты пользователя
   */
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

  /**
   * Получить сообщения чата
   */
  async getMessages(
    userId: string,
    conversationId: string,
    page = 1,
    limit = 50,
  ) {
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

  /**
   * Отправить сообщение (без стриминга)
   */
  async sendMessage(userId: string, dto: SendMessageDto) {
    // Проверяем модель и баланс
    const model = await this.aiProvidersService.getModelBySlug(dto.modelSlug);
    const user = await this.usersService.findById(userId);
    const totalBalance = user.tokenBalance + user.bonusTokens;

    if (totalBalance < model.tokenCost) {
      throw new BadRequestException(
        `Insufficient tokens. Need ${model.tokenCost}, have ${totalBalance}`,
      );
    }

    // Получаем или создаём чат
    let conversation: ConversationDocument;
    if (dto.conversationId) {
      conversation = await this.getConversationWithAccess(userId, dto.conversationId);
    } else {
      conversation = await this.createConversation(userId, dto);
    }

    // Сохраняем сообщение пользователя
    const userMessage = new this.messageModel({
      conversationId: conversation._id,
      userId: new Types.ObjectId(userId),
      role: 'user',
      content: dto.content,
      imageUrls: dto.imageUrls || [],
    });
    await userMessage.save();

    // Получаем контекст (последние сообщения)
    const contextMessages = await this.buildContext(conversation, dto);

    // Генерируем ответ
    try {
      const result = await this.aiProvidersService.generateText(dto.modelSlug, {
        messages: contextMessages,
        maxTokens: dto.maxTokens || model.defaultParams?.maxTokens || 4096,
        temperature: dto.temperature ?? model.defaultParams?.temperature ?? 0.7,
      });

      if (!result.success) {
        // Сохраняем ошибку
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

      // Списываем токены
      await this.billingService.chargeForGeneration(
        userId,
        model.tokenCost,
        'text',
        dto.modelSlug,
        conversation._id.toString(),
      );

      // Сохраняем ответ ассистента
      const assistantMessage = new this.messageModel({
        conversationId: conversation._id,
        userId: new Types.ObjectId(userId),
        role: 'assistant',
        content: result.data?.content || '',
        modelSlug: dto.modelSlug,
        providerSlug: result.providerSlug,
        usage: result.usage,
        responseTimeMs: result.responseTimeMs,
        tokensCost: model.tokenCost,
      });
      await assistantMessage.save();

      // Обновляем чат
      conversation.messageCount += 2;
      conversation.totalTokensUsed += result.usage?.totalTokens || 0;
      conversation.lastMessageAt = new Date();

      // Auto-title на первое сообщение
      if (conversation.messageCount <= 2) {
        conversation.title = this.generateTitle(dto.content);
      }
      await conversation.save();

      // Обновляем daily generations
      await this.usersService.incrementDailyGenerations(userId);

      return {
        message: assistantMessage,
        conversation: {
          id: conversation._id,
          title: conversation.title,
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`Chat generation error: ${error.message}`);
      throw new BadRequestException('Failed to generate response');
    }
  }

  /**
   * Стриминг сообщения — возвращает AsyncGenerator
   */
  async *streamMessage(
    userId: string,
    dto: SendMessageDto,
  ): AsyncGenerator<{ type: string; data: any }> {
    const model = await this.aiProvidersService.getModelBySlug(dto.modelSlug);
    const user = await this.usersService.findById(userId);
    const totalBalance = user.tokenBalance + user.bonusTokens;

    if (totalBalance < model.tokenCost) {
      yield {
        type: 'error',
        data: {
          message: `Insufficient tokens. Need ${model.tokenCost}, have ${totalBalance}`,
        },
      };
      return;
    }

    // Получаем или создаём чат
    let conversation: ConversationDocument;
    if (dto.conversationId) {
      conversation = await this.getConversationWithAccess(userId, dto.conversationId);
    } else {
      conversation = await this.createConversation(userId, dto);
    }

    // Отправляем ID чата
    yield {
      type: 'conversation',
      data: { id: conversation._id.toString(), title: conversation.title },
    };

    // Сохраняем сообщение пользователя
    const userMessage = new this.messageModel({
      conversationId: conversation._id,
      userId: new Types.ObjectId(userId),
      role: 'user',
      content: dto.content,
      imageUrls: dto.imageUrls || [],
    });
    await userMessage.save();

    // Получаем контекст
    const contextMessages = await this.buildContext(conversation, dto);

    // Создаём placeholder для ответа ассистента
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

    let fullContent = '';
    let lastUsage: any = null;
    let success = false;

    try {
      const stream = this.aiProvidersService.generateTextStream(dto.modelSlug, {
        messages: contextMessages,
        maxTokens: dto.maxTokens || model.defaultParams?.maxTokens || 4096,
        temperature: dto.temperature ?? model.defaultParams?.temperature ?? 0.7,
        stream: true,
      });

      for await (const chunk of stream) {
        if (chunk.done) {
          if (chunk.usage) lastUsage = chunk.usage;
          success = true;
          break;
        }

        fullContent += chunk.content;
        yield {
          type: 'text_delta',
          data: { content: chunk.content },
        };
      }
    } catch (error) {
      yield {
        type: 'error',
        data: { message: error.message },
      };
    }

    if (success && fullContent) {
      // Списываем токены
      await this.billingService.chargeForGeneration(
        userId,
        model.tokenCost,
        'text',
        dto.modelSlug,
        conversation._id.toString(),
      );

      // Обновляем сообщение ассистента
      assistantMessage.content = fullContent;
      assistantMessage.isStreaming = false;
      assistantMessage.usage = lastUsage || {};
      assistantMessage.tokensCost = model.tokenCost;
      await assistantMessage.save();

      // Обновляем чат
      conversation.messageCount += 2;
      conversation.lastMessageAt = new Date();
      if (conversation.messageCount <= 2) {
        conversation.title = this.generateTitle(dto.content);
      }
      await conversation.save();

      await this.usersService.incrementDailyGenerations(userId);
    } else if (!success) {
      // Удаляем пустое сообщение ассистента
      await this.messageModel.findByIdAndDelete(assistantMessage._id);
    }

    yield {
      type: 'message_end',
      data: {
        messageId: assistantMessage._id.toString(),
        usage: lastUsage,
        tokensCost: success ? model.tokenCost : 0,
      },
    };
  }

  /**
   * Создать чат
   */
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

  /**
   * Удалить чат
   */
  async deleteConversation(userId: string, conversationId: string) {
    const conversation = await this.getConversationWithAccess(userId, conversationId);
    await this.messageModel.deleteMany({ conversationId: conversation._id });
    await this.conversationModel.findByIdAndDelete(conversation._id);
    return { deleted: true };
  }

  /**
   * Переименовать чат
   */
  async renameConversation(userId: string, conversationId: string, title: string) {
    const conversation = await this.getConversationWithAccess(userId, conversationId);
    conversation.title = title;
    await conversation.save();
    return conversation;
  }

  /**
   * Закрепить/открепить чат
   */
  async togglePin(userId: string, conversationId: string) {
    const conversation = await this.getConversationWithAccess(userId, conversationId);
    conversation.isPinned = !conversation.isPinned;
    await conversation.save();
    return conversation;
  }

  /**
   * Построить контекст для AI
   */
  private async buildContext(
    conversation: ConversationDocument,
    dto: SendMessageDto,
  ): Promise<{ role: string; content: string }[]> {
    const messages: { role: string; content: string }[] = [];

    // System prompt
    const systemPrompt = dto.systemPrompt || conversation.systemPrompt;
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // Последние N сообщений из чата (контекстное окно)
    const maxContextMessages = 20; // Можно настраивать
    const history = await this.messageModel
      .find({
        conversationId: conversation._id,
        isError: false,
        isStreaming: false,
      })
      .sort({ createdAt: -1 })
      .limit(maxContextMessages)
      .exec();

    // Реверсируем для хронологического порядка
    const orderedHistory = history.reverse();

    for (const msg of orderedHistory) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // Добавляем текущее сообщение
    messages.push({ role: 'user', content: dto.content });

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
    // Берём первые 50 символов сообщения как заголовок
    const cleaned = content.replace(/\n/g, ' ').trim();
    return cleaned.length > 50 ? cleaned.substring(0, 50) + '...' : cleaned;
  }
}