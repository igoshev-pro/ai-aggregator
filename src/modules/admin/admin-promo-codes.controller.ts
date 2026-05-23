// src/modules/admin/admin-promo-codes.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { UserRole } from '@/common/interfaces';
import { AdminPromoCodesService } from './admin-promo-codes.service';

@ApiTags('Admin Promo Codes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin/promo-codes')
export class AdminPromoCodesController {
  constructor(private readonly svc: AdminPromoCodesService) {}

  @Get()
  @ApiOperation({ summary: 'List promo codes' })
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('type') type?: any,
    @Query('status') status?: any,
    @Query('sortBy') sortBy?: any,
    @Query('order') order?: any,
  ) {
    const data = await this.svc.list({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search,
      type,
      status,
      sortBy,
      order,
    });
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get promo by ID' })
  async getOne(@Param('id') id: string) {
    const data = await this.svc.getById(id);
    return { success: true, data };
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Promo usage statistics' })
  async stats(@Param('id') id: string) {
    const data = await this.svc.stats(id);
    return { success: true, data };
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create promo code' })
  async create(
    @Body() body: any,
    @CurrentUser('sub') adminUserId: string,
  ) {
    const data = await this.svc.create(body, adminUserId);
    return { success: true, data };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update promo code' })
  async update(@Param('id') id: string, @Body() body: any) {
    const data = await this.svc.update(id, body);
    return { success: true, data };
  }

  @Post(':id/toggle')
  @HttpCode(200)
  @ApiOperation({ summary: 'Toggle isActive' })
  async toggle(@Param('id') id: string) {
    const data = await this.svc.toggle(id);
    return { success: true, data };
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete promo code' })
  async remove(@Param('id') id: string) {
    const data = await this.svc.remove(id);
    return { success: true, data };
  }
}