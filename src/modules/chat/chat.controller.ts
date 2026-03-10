import {
  Controller,
  Get,
  Post,
  Delete,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery, ApiBody } from '@nestjs/swagger';
import { Response } from 'express';
import { ChatService, SendMessageDto } from './chat.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Throttle } from '@nestjs/throttler';

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ─── Conversations ─────────────────────────────────────────────

  @Get('conversations')
  @ApiOperation({ summary: 'Get user conversations list' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  async getConversations(
    @CurrentUser('sub') userId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const result = await this.chatService.getConversations(userId, page, limit);
    return { success: true, data: result };
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Get conversation messages' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  async getMessages(
    @CurrentUser('sub') userId: string,
    @Param('id') conversationId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    const result = await this.chatService.getMessages(
      userId,
      conversationId,
      page,
      limit,
    );
    return { success: true, data: result };
  }

  @Delete('conversations/:id')
  @ApiOperation({ summary: 'Delete conversation and all its messages' })
  async deleteConversation(
    @CurrentUser('sub') userId: string,
    @Param('id') conversationId: string,
  ) {
    await this.chatService.deleteConversation(userId, conversationId);
    return { success: true, message: 'Conversation deleted' };
  }

  @Put('conversations/:id/rename')
  @ApiOperation({ summary: 'Rename conversation' })
  @ApiBody({ schema: { properties: { title: { type: 'string', example: 'Мой чат' } } } })
  async renameConversation(
    @CurrentUser('sub') userId: string,
    @Param('id') conversationId: string,
    @Body('title') title: string,
  ) {
    const result = await this.chatService.renameConversation(
      userId,
      conversationId,
      title,
    );
    return {
      success: true,
      data: { id: result._id, title: result.title },
    };
  }

  @Put('conversations/:id/pin')
  @ApiOperation({ summary: 'Toggle pin/unpin conversation' })
  async togglePin(
    @CurrentUser('sub') userId: string,
    @Param('id') conversationId: string,
  ) {
    const result = await this.chatService.togglePin(userId, conversationId);
    return {
      success: true,
      data: { id: result._id, isPinned: result.isPinned },
    };
  }

  // ─── Send Message (non-streaming) ──────────────────────────────

  @Post('send')
  @ApiOperation({ summary: 'Send message and get full response (no streaming)' })
  @ApiBody({
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
  })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(200)
  async sendMessage(
    @CurrentUser('sub') userId: string,
    @Body() dto: SendMessageDto,
  ) {
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

  // ─── Send Message (SSE Streaming) ──────────────────────────────

  @Post('stream')
  @ApiOperation({
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
  })
  @ApiBody({
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
  })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(200)
  async streamMessage(
    @CurrentUser('sub') userId: string,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ) {
    // ─── SSE Headers ────────────────────────────────────────────
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Nginx: отключить буферизацию

    // Flush headers
    res.flushHeaders();

    try {
      const stream = this.chatService.streamMessage(userId, dto);

      for await (const event of stream) {
        // Формат SSE: event: <type>\ndata: <json>\n\n
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event.data)}\n\n`);

        // Принудительный flush для немедленной доставки
        if (typeof (res as any).flush === 'function') {
          (res as any).flush();
        }
      }
    } catch (error) {
      // Отправляем ошибку как SSE event
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ message: error.message })}\n\n`);
    }

    // Финальное событие — закрытие стрима
    res.write('event: done\n');
    res.write('data: {}\n\n');
    res.end();
  }
}