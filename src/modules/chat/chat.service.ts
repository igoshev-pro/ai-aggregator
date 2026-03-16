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

  async sendMessage(userId: string, dto: SendMessageDto) {
    this.logger.log(`📥 Received chat request:`, {
      userId,
      modelSlug: dto.modelSlug,
      contentLength: dto.content?.length,
    });
  
    // Проверка существования модели
    const model = await this.aiProvidersService.getModelBySlug(dto.modelSlug);
    if (!model) {
      this.logger.error(`❌ Model not found: ${dto.modelSlug}`);
      throw new NotFoundException(`Model ${dto.modelSlug} not found`);
    }
  
    this.logger.log(`✅ Model found: ${model.displayName || model.name}`);
    
    const user = await this.usersService.findById(userId);
    const totalBalance = user.tokenBalance + user.bonusTokens;

    // Проверяем минимальный баланс
    if (totalBalance < model.minTokenCost) {
      throw new BadRequestException(
        `Insufficient tokens. Need at least ${model.minTokenCost}, have ${totalBalance}`,
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

      // Списываем токены на основе реального использования
      const { costInTokens, costInDollars } = await this.billingService.chargeForGeneration(
        userId,
        dto.modelSlug,
        'text',
        conversation._id.toString(),
        result.usage?.inputTokens,
        result.usage?.outputTokens,
      );

      // Сохраняем ответ
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
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`Chat generation error: ${error.message}`);
      throw new BadRequestException('Failed to generate response');
    }
  }

  async *streamMessage(
    userId: string,
    dto: SendMessageDto,
  ): AsyncGenerator<{ type: string; data: any }> {
    console.log('=== STREAM MESSAGE DEBUG ===');
    console.log('1. UserID:', userId);
    console.log('2. DTO:', JSON.stringify(dto));
    console.log('3. Model slug received:', dto.modelSlug);

    try {
      // 1. Проверка пользователя
      console.log('4. Checking user...');
      const user = await this.usersService.findById(userId);
      if (!user) {
        console.log('ERROR: User not found');
        yield { type: 'error', data: { message: 'User not found' } };
        return;
      }
      console.log('5. User found:', user.telegramId, 'Balance:', user.tokenBalance + user.bonusTokens);

      // 2. Проверка модели
      console.log('6. Checking model...');
      const model = await this.aiProvidersService.getModelBySlug(dto.modelSlug);
      if (!model) {
        console.log('ERROR: Model not found:', dto.modelSlug);
        
        // Показать доступные модели
        const available = await this.modelModel.find({}, {slug: 1}).limit(10);
        console.log('Available models in DB:', available.map(m => m.slug));
        
        yield { type: 'error', data: { message: `Model ${dto.modelSlug} not found` } };
        return;
      }
      console.log('7. Model found:', model.name, '/', model.slug, '/', model.displayName);
      console.log('   Model details:', {
        type: model.type,
        isActive: model.isActive,
        isPremium: model.isPremium,
        minTokenCost: model.minTokenCost,
        providerMappings: model.providerMappings?.length || 0,
      });

      // 3. Проверка баланса
      console.log('8. Checking balance...');
      const totalBalance = user.tokenBalance + user.bonusTokens;
      const requiredTokens = model.minTokenCost || 1;
      console.log(`   Balance: ${totalBalance}, Required: ${requiredTokens}`);
      
      if (totalBalance < requiredTokens) {
        console.log('ERROR: Insufficient balance');
        yield { 
          type: 'error', 
          data: { message: `Недостаточно спичек. Нужно ${requiredTokens}, у вас ${totalBalance}` } 
        };
        return;
      }

      // 4. Создание/получение conversation
      console.log('9. Managing conversation...');
      let conversation: ConversationDocument;
      if (dto.conversationId) {
        console.log('   Loading existing conversation:', dto.conversationId);
        conversation = await this.getConversationWithAccess(userId, dto.conversationId);
      } else {
        console.log('   Creating new conversation');
        conversation = await this.createConversation(userId, dto);
      }
      console.log('10. Conversation ready:', conversation._id);

      yield {
        type: 'conversation',
        data: { id: conversation._id.toString(), title: conversation.title },
      };

      // 5. Сохранение сообщения пользователя
      console.log('11. Saving user message...');
      const userMessage = new this.messageModel({
        conversationId: conversation._id,
        userId: new Types.ObjectId(userId),
        role: 'user',
        content: dto.content,
        imageUrls: dto.imageUrls || [],
      });
      await userMessage.save();
      console.log('12. User message saved:', userMessage._id);

      // 6. Построение контекста
      console.log('13. Building context...');
      const contextMessages = await this.buildContext(conversation, dto);
      console.log('14. Context ready, messages count:', contextMessages.length);

      // 7. Создание сообщения ассистента
      console.log('15. Creating assistant message placeholder...');
      const assistantMessage = new this.messageModel({
        conversationId: conversation._id,
        userId: new Types.ObjectId(userId),
        role: 'assistant',
        content: '',
        modelSlug: dto.modelSlug,
        isStreaming: true,
      });
      await assistantMessage.save();
      console.log('16. Assistant message created:', assistantMessage._id);

      yield {
        type: 'message_start',
        data: { messageId: assistantMessage._id.toString() },
      };

      // 8. Начало стриминга
      console.log('17. Starting stream generation...');
      let fullContent = '';
      let lastUsage: any = null;
      let success = false;
      let costInTokens = 0;

      try {
        console.log('18. Calling aiProvidersService.generateTextStream...');
        const stream = this.aiProvidersService.generateTextStream(dto.modelSlug, {
          messages: contextMessages,
          maxTokens: dto.maxTokens || model.defaultParams?.maxTokens || 4096,
          temperature: dto.temperature ?? model.defaultParams?.temperature ?? 0.7,
          stream: true,
        });

        console.log('19. Stream created, starting iteration...');
        let chunkCount = 0;
        
        for await (const chunk of stream) {
          chunkCount++;
          if (chunkCount === 1) {
            console.log('20. First chunk received');
          }
          
          if (chunk.done) {
            console.log('21. Stream completed, total chunks:', chunkCount);
            if (chunk.usage) lastUsage = chunk.usage;
            success = true;
            break;
          }

          if (chunk.content) {
            fullContent += chunk.content;
            yield {
              type: 'text_delta',
              data: { content: chunk.content },
            };
          }
        }
        
        console.log('22. Stream iteration finished, success:', success);
        console.log('    Content length:', fullContent.length);
        
      } catch (error) {
        console.error('ERROR in stream:', error);
        yield {
          type: 'error',
          data: { message: error.message || 'Stream generation failed' },
        };
        success = false;
      }

      // 9. Сохранение результата
      if (success && fullContent) {
        console.log('23. Saving successful response...');
        
        // Списываем токены
        const { costInTokens: billedTokens } = await this.billingService.chargeForGeneration(
          userId,
          dto.modelSlug,
          'text',
          conversation._id.toString(),
          lastUsage?.inputTokens,
          lastUsage?.outputTokens,
        );

        costInTokens = billedTokens;

        assistantMessage.content = fullContent;
        assistantMessage.isStreaming = false;
        assistantMessage.usage = lastUsage || {};
        assistantMessage.tokensCost = costInTokens;
        assistantMessage.inputTokens = lastUsage?.inputTokens;
        assistantMessage.outputTokens = lastUsage?.outputTokens;
        await assistantMessage.save();

        conversation.messageCount += 2;
        conversation.lastMessageAt = new Date();
        if (conversation.messageCount <= 2) {
          conversation.title = this.generateTitle(dto.content);
        }
        await conversation.save();

        await this.usersService.incrementDailyGenerations(userId);
        
        console.log('24. Response saved successfully');
      } else if (!success) {
        console.log('25. Cleaning up failed message');
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
      
      console.log('26. Stream completed');
      console.log('=== END STREAM MESSAGE ===');
      
    } catch (error) {
      console.error('FATAL ERROR in streamMessage:', error);
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

  private async buildContext(
    conversation: ConversationDocument,
    dto: SendMessageDto,
  ): Promise<{ role: string; content: string }[]> {
    const messages: { role: string; content: string }[] = [];

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
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }

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
    const cleaned = content.replace(/\n/g, ' ').trim();
    return cleaned.length > 50 ? cleaned.substring(0, 50) + '...' : cleaned;
  }
}