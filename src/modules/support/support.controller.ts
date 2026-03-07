import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SupportService } from './support.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('tickets')
  @ApiOperation({ summary: 'Create support ticket' })
  @HttpCode(201)
  async createTicket(
    @CurrentUser('sub') userId: string,
    @Body() body: { subject: string; message: string },
  ) {
    const ticket = await this.supportService.createTicket(
      userId,
      body.subject,
      body.message,
    );
    return { success: true, data: ticket };
  }

  @Get('tickets')
  @ApiOperation({ summary: 'Get my tickets' })
  async getTickets(
    @CurrentUser('sub') userId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    const data = await this.supportService.getUserTickets(userId, page, limit);
    return { success: true, data };
  }

  @Post('tickets/:id/message')
  @ApiOperation({ summary: 'Add message to ticket' })
  @HttpCode(200)
  async addMessage(
    @CurrentUser('sub') userId: string,
    @Param('id') ticketId: string,
    @Body('content') content: string,
  ) {
    const ticket = await this.supportService.addMessage(
      userId,
      ticketId,
      content,
    );
    return { success: true, data: ticket };
  }
}