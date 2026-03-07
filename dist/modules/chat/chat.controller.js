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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const chat_service_1 = require("./chat.service");
const jwt_auth_guard_1 = require("../../common/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const throttler_1 = require("@nestjs/throttler");
let ChatController = class ChatController {
    constructor(chatService) {
        this.chatService = chatService;
    }
    async getConversations(userId, page = 1, limit = 20) {
        const result = await this.chatService.getConversations(userId, page, limit);
        return { success: true, data: result };
    }
    async getMessages(userId, conversationId, page = 1, limit = 50) {
        const result = await this.chatService.getMessages(userId, conversationId, page, limit);
        return { success: true, data: result };
    }
    async deleteConversation(userId, conversationId) {
        await this.chatService.deleteConversation(userId, conversationId);
        return { success: true, message: 'Conversation deleted' };
    }
    async renameConversation(userId, conversationId, title) {
        const result = await this.chatService.renameConversation(userId, conversationId, title);
        return {
            success: true,
            data: { id: result._id, title: result.title },
        };
    }
    async togglePin(userId, conversationId) {
        const result = await this.chatService.togglePin(userId, conversationId);
        return {
            success: true,
            data: { id: result._id, isPinned: result.isPinned },
        };
    }
    async sendMessage(userId, dto) {
        const result = await this.chatService.sendMessage(userId, dto);
        return {
            success: true,
            data: {
                conversation: result.conversation,
                message: {
                    id: result.message._id,
                    role: result.message.role,
                    content: result.message.content,
                    modelSlug: result.message.modelSlug,
                    usage: result.message.usage,
                    responseTimeMs: result.message.responseTimeMs,
                    tokensCost: result.message.tokensCost,
                    createdAt: result.message['createdAt'],
                },
            },
        };
    }
    async streamMessage(userId, dto, res) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        try {
            const stream = this.chatService.streamMessage(userId, dto);
            for await (const event of stream) {
                res.write(`event: ${event.type}\n`);
                res.write(`data: ${JSON.stringify(event.data)}\n\n`);
                if (typeof res.flush === 'function') {
                    res.flush();
                }
            }
        }
        catch (error) {
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({ message: error.message })}\n\n`);
        }
        res.write('event: done\n');
        res.write('data: {}\n\n');
        res.end();
    }
};
exports.ChatController = ChatController;
__decorate([
    (0, common_1.Get)('conversations'),
    (0, swagger_1.ApiOperation)({ summary: 'Get user conversations list' }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false, type: Number, example: 1 }),
    (0, swagger_1.ApiQuery)({ name: 'limit', required: false, type: Number, example: 20 }),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __param(1, (0, common_1.Query)('page')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "getConversations", null);
__decorate([
    (0, common_1.Get)('conversations/:id/messages'),
    (0, swagger_1.ApiOperation)({ summary: 'Get conversation messages' }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false, type: Number, example: 1 }),
    (0, swagger_1.ApiQuery)({ name: 'limit', required: false, type: Number, example: 50 }),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('page')),
    __param(3, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object, Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "getMessages", null);
__decorate([
    (0, common_1.Delete)('conversations/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'Delete conversation and all its messages' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "deleteConversation", null);
__decorate([
    (0, common_1.Put)('conversations/:id/rename'),
    (0, swagger_1.ApiOperation)({ summary: 'Rename conversation' }),
    (0, swagger_1.ApiBody)({ schema: { properties: { title: { type: 'string', example: 'Мой чат' } } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)('title')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "renameConversation", null);
__decorate([
    (0, common_1.Put)('conversations/:id/pin'),
    (0, swagger_1.ApiOperation)({ summary: 'Toggle pin/unpin conversation' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "togglePin", null);
__decorate([
    (0, common_1.Post)('send'),
    (0, swagger_1.ApiOperation)({ summary: 'Send message and get full response (no streaming)' }),
    (0, swagger_1.ApiBody)({
        schema: {
            type: 'object',
            required: ['modelSlug', 'content'],
            properties: {
                conversationId: { type: 'string', description: 'Existing conversation ID (omit to create new)' },
                modelSlug: { type: 'string', example: 'gpt-4o-mini' },
                content: { type: 'string', example: 'Привет! Как дела?' },
                imageUrls: { type: 'array', items: { type: 'string' }, description: 'Image URLs for vision models' },
                systemPrompt: { type: 'string', description: 'Custom system prompt' },
                temperature: { type: 'number', example: 0.7 },
                maxTokens: { type: 'number', example: 4096 },
            },
        },
    }),
    (0, throttler_1.Throttle)({ default: { limit: 10, ttl: 60000 } }),
    (0, common_1.HttpCode)(200),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "sendMessage", null);
__decorate([
    (0, common_1.Post)('stream'),
    (0, swagger_1.ApiOperation)({
        summary: 'Send message with Server-Sent Events streaming',
        description: `
      Returns a stream of SSE events:
      
      - **event: conversation** — conversation ID and title
      - **event: message_start** — assistant message ID  
      - **event: text_delta** — text chunk
      - **event: error** — error occurred
      - **event: message_end** — generation complete with usage stats
      - **event: done** — stream finished
    `,
    }),
    (0, swagger_1.ApiBody)({
        schema: {
            type: 'object',
            required: ['modelSlug', 'content'],
            properties: {
                conversationId: { type: 'string' },
                modelSlug: { type: 'string', example: 'gpt-4o-mini' },
                content: { type: 'string', example: 'Напиши стихотворение' },
                imageUrls: { type: 'array', items: { type: 'string' } },
                systemPrompt: { type: 'string' },
                temperature: { type: 'number', example: 0.7 },
                maxTokens: { type: 'number', example: 4096 },
            },
        },
    }),
    (0, throttler_1.Throttle)({ default: { limit: 10, ttl: 60000 } }),
    (0, common_1.HttpCode)(200),
    __param(0, (0, current_user_decorator_1.CurrentUser)('sub')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "streamMessage", null);
exports.ChatController = ChatController = __decorate([
    (0, swagger_1.ApiTags)('Chat'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Controller)('chat'),
    __metadata("design:paramtypes", [chat_service_1.ChatService])
], ChatController);
//# sourceMappingURL=chat.controller.js.map