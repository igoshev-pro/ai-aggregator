// src/modules/analytics/analytics.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Req,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { UserRole } from '@/common/interfaces';

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * Клиентский endpoint для трекинга событий
   */
  @Post('track')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Track analytics event' })
  @HttpCode(200)
  async track(
    @CurrentUser('sub') userId: string,
    @Body() body: {
      event: string;
      properties?: Record<string, any>;
      source?: string;
      platform?: string;
    },
    @Req() req: Request,
  ) {
    await this.analyticsService.track({
      event: body.event,
      userId,
      properties: body.properties,
      source: body.source,
      platform: body.platform,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    return { success: true };
  }

  /**
   * Batch-трекинг (для фронта — отправка пачкой)
   */
  @Post('track/batch')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Track multiple events' })
  @HttpCode(200)
  async trackBatch(
    @CurrentUser('sub') userId: string,
    @Body() body: {
      events: {
        event: string;
        properties?: Record<string, any>;
        source?: string;
      }[];
    },
  ) {
    const events = body.events.map((e) => ({ ...e, userId }));
    await this.analyticsService.trackBatch(events);
    return { success: true };
  }

  /**
   * Админ: статистика по событиям
   */
  @Get('stats')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get event stats (admin)' })
  async getStats(@Query('days') days = 30) {
    const data = await this.analyticsService.getEventStats(days);
    return { success: true, data };
  }

  /**
   * Админ: статистика по платформам
   */
  @Get('platforms')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get platform stats (admin)' })
  async getPlatformStats(@Query('days') days = 30) {
    const data = await this.analyticsService.getPlatformStats(days);
    return { success: true, data };
  }
}