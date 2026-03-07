"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var ChatService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const conversation_schema_1 = require("./schemas/conversation.schema");
const message_schema_1 = require("./schemas/message.schema");
const ai_providers_service_1 = require("../ai-providers/ai-providers.service");
const users_service_1 = require("../users/users.service");
const billing_service_1 = require("../billing/billing.service");
let ChatService = ChatService_1 = class ChatService {
    constructor(conversationModel, messageModel, aiProvidersService, usersService, billingService) {
        this.conversationModel = conversationModel;
        this.messageModel = messageModel;
        this.aiProvidersService = aiProvidersService;
        this.usersService = usersService;
        this.billingService = billingService;
        this.logger = new common_1.Logger(ChatService_1.name);
    }
    async getConversations(userId, page = 1, limit = 20) {
        const skip = (page - 1) * limit;
        const [conversations, total] = await Promise.all([
            this.conversationModel
                .find({ userId: new mongoose_2.Types.ObjectId(userId), isArchived: false })
                .sort({ isPinned: -1, lastMessageAt: -1 })
                .skip(skip)
                .limit(limit)
                .exec(),
            this.conversationModel.countDocuments({
                userId: new mongoose_2.Types.ObjectId(userId),
                isArchived: false,
            }),
        ]);
        return {
            conversations,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        };
    }
    async getMessages(userId, conversationId, page = 1, limit = 50) {
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
    async sendMessage(userId, dto) {
        const model = await this.aiProvidersService.getModelBySlug(dto.modelSlug);
        const user = await this.usersService.findById(userId);
        const totalBalance = user.tokenBalance + user.bonusTokens;
        if (totalBalance < model.tokenCost) {
            throw new common_1.BadRequestException(`Insufficient tokens. Need ${model.tokenCost}, have ${totalBalance}`);
        }
        let conversation;
        if (dto.conversationId) {
            conversation = await this.getConversationWithAccess(userId, dto.conversationId);
        }
        else {
            conversation = await this.createConversation(userId, dto);
        }
        const userMessage = new this.messageModel({
            conversationId: conversation._id,
            userId: new mongoose_2.Types.ObjectId(userId),
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
                    userId: new mongoose_2.Types.ObjectId(userId),
                    role: 'assistant',
                    content: result.error?.message || 'Generation failed',
                    modelSlug: dto.modelSlug,
                    providerSlug: result.providerSlug,
                    isError: true,
                    errorMessage: result.error?.message,
                });
                await errorMessage.save();
                throw new common_1.BadRequestException(result.error?.message || 'Generation failed');
            }
            await this.billingService.chargeForGeneration(userId, model.tokenCost, 'text', dto.modelSlug, conversation._id.toString());
            const assistantMessage = new this.messageModel({
                conversationId: conversation._id,
                userId: new mongoose_2.Types.ObjectId(userId),
                role: 'assistant',
                content: result.data?.content || '',
                modelSlug: dto.modelSlug,
                providerSlug: result.providerSlug,
                usage: result.usage,
                responseTimeMs: result.responseTimeMs,
                tokensCost: model.tokenCost,
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
        }
        catch (error) {
            if (error instanceof common_1.BadRequestException)
                throw error;
            this.logger.error(`Chat generation error: ${error.message}`);
            throw new common_1.BadRequestException('Failed to generate response');
        }
    }
    async *streamMessage(userId, dto) {
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
        let conversation;
        if (dto.conversationId) {
            conversation = await this.getConversationWithAccess(userId, dto.conversationId);
        }
        else {
            conversation = await this.createConversation(userId, dto);
        }
        yield {
            type: 'conversation',
            data: { id: conversation._id.toString(), title: conversation.title },
        };
        const userMessage = new this.messageModel({
            conversationId: conversation._id,
            userId: new mongoose_2.Types.ObjectId(userId),
            role: 'user',
            content: dto.content,
            imageUrls: dto.imageUrls || [],
        });
        await userMessage.save();
        const contextMessages = await this.buildContext(conversation, dto);
        const assistantMessage = new this.messageModel({
            conversationId: conversation._id,
            userId: new mongoose_2.Types.ObjectId(userId),
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
        let lastUsage = null;
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
                    if (chunk.usage)
                        lastUsage = chunk.usage;
                    success = true;
                    break;
                }
                fullContent += chunk.content;
                yield {
                    type: 'text_delta',
                    data: { content: chunk.content },
                };
            }
        }
        catch (error) {
            yield {
                type: 'error',
                data: { message: error.message },
            };
        }
        if (success && fullContent) {
            await this.billingService.chargeForGeneration(userId, model.tokenCost, 'text', dto.modelSlug, conversation._id.toString());
            assistantMessage.content = fullContent;
            assistantMessage.isStreaming = false;
            assistantMessage.usage = lastUsage || {};
            assistantMessage.tokensCost = model.tokenCost;
            await assistantMessage.save();
            conversation.messageCount += 2;
            conversation.lastMessageAt = new Date();
            if (conversation.messageCount <= 2) {
                conversation.title = this.generateTitle(dto.content);
            }
            await conversation.save();
            await this.usersService.incrementDailyGenerations(userId);
        }
        else if (!success) {
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
    async createConversation(userId, dto) {
        const conversation = new this.conversationModel({
            userId: new mongoose_2.Types.ObjectId(userId),
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
    async deleteConversation(userId, conversationId) {
        const conversation = await this.getConversationWithAccess(userId, conversationId);
        await this.messageModel.deleteMany({ conversationId: conversation._id });
        await this.conversationModel.findByIdAndDelete(conversation._id);
        return { deleted: true };
    }
    async renameConversation(userId, conversationId, title) {
        const conversation = await this.getConversationWithAccess(userId, conversationId);
        conversation.title = title;
        await conversation.save();
        return conversation;
    }
    async togglePin(userId, conversationId) {
        const conversation = await this.getConversationWithAccess(userId, conversationId);
        conversation.isPinned = !conversation.isPinned;
        await conversation.save();
        return conversation;
    }
    async buildContext(conversation, dto) {
        const messages = [];
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
    async getConversationWithAccess(userId, conversationId) {
        const conversation = await this.conversationModel.findById(conversationId);
        if (!conversation) {
            throw new common_1.NotFoundException('Conversation not found');
        }
        if (conversation.userId.toString() !== userId) {
            throw new common_1.ForbiddenException('Access denied to this conversation');
        }
        return conversation;
    }
    generateTitle(content) {
        const cleaned = content.replace(/\n/g, ' ').trim();
        return cleaned.length > 50 ? cleaned.substring(0, 50) + '...' : cleaned;
    }
};
exports.ChatService = ChatService;
exports.ChatService = ChatService = ChatService_1 = __decorate([
    __param(0, (0, mongoose_1.InjectModel)(conversation_schema_1.Conversation.name)),
    __param(1, (0, mongoose_1.InjectModel)(message_schema_1.Message.name)),
    __param(2, (0, common_1.Inject)((0, common_1.forwardRef)(() => ai_providers_service_1.AiProvidersService))),
    __param(3, (0, common_1.Inject)((0, common_1.forwardRef)(() => users_service_1.UsersService))),
    __param(4, (0, common_1.Inject)((0, common_1.forwardRef)(() => billing_service_1.BillingService))),
    __metadata("design:paramtypes", [mongoose_2.Model,
        mongoose_2.Model,
        ai_providers_service_1.AiProvidersService,
        users_service_1.UsersService,
        billing_service_1.BillingService])
], ChatService);
//# sourceMappingURL=chat.service.js.map