// src/modules/admin/admin.controller.ts
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
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { UserRole } from '@/common/interfaces';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ─── Dashboard ──────────────────────────────────────────────────

  @Get('dashboard')
  @ApiOperation({ summary: 'Get admin dashboard stats' })
  async getDashboard() {
    const data = await this.adminService.getDashboardStats();
    return { success: true, data };
  }

  // ─── Users ──────────────────────────────────────────────────────

  @Get('users')
  @ApiOperation({ summary: 'List all users' })
  async getUsers(
    @Query('page') page = 1,
    @Query('limit') limit = 50,
    @Query('search') search?: string,
    @Query('role') role?: UserRole,
  ) {
    const data = await this.adminService.getUsers(page, limit, search, role);
    return { success: true, data };
  }

  @Put('users/:id/role')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Change user role' })
  async changeRole(
    @Param('id') userId: string,
    @Body('role') role: UserRole,
  ) {
    const data = await this.adminService.changeUserRole(userId, role);
    return { success: true, data };
  }

  @Put('users/:id/ban')
  @ApiOperation({ summary: 'Ban/unban user' })
  async toggleBan(
    @Param('id') userId: string,
    @Body() body: { ban: boolean; reason?: string },
  ) {
    const data = await this.adminService.toggleBan(userId, body.ban, body.reason);
    return { success: true, data };
  }

  @Post('users/:id/adjust-balance')
  @ApiOperation({ summary: 'Adjust user balance' })
  @HttpCode(200)
  async adjustBalance(
    @CurrentUser('sub') adminId: string,
    @Param('id') userId: string,
    @Body() body: { amount: number; reason: string },
  ) {
    const data = await this.adminService.adjustBalance(
      adminId,
      userId,
      body.amount,
      body.reason,
    );
    return { success: true, data };
  }

  // ─── Providers ──────────────────────────────────────────────────

  @Get('providers')
  @ApiOperation({ summary: 'List all AI providers' })
  async getProviders() {
    const data = await this.adminService.getProviders();
    return { success: true, data };
  }

  @Put('providers/:slug')
  @ApiOperation({ summary: 'Update provider settings' })
  async updateProvider(
    @Param('slug') slug: string,
    @Body() body: { isActive?: boolean; priority?: number },
  ) {
    const data = await this.adminService.updateProvider(slug, body);
    return { success: true, data };
  }

  // ─── Models ─────────────────────────────────────────────────────

  @Get('models')
  @ApiOperation({ summary: 'List all AI models' })
  async getModels() {
    const data = await this.adminService.getModels();
    return { success: true, data };
  }

  @Put('models/:slug')
  @ApiOperation({ summary: 'Update model settings' })
  async updateModel(
    @Param('slug') slug: string,
    @Body() body: {
      isActive?: boolean;
      tokenCost?: number;
      isPremium?: boolean;
      sortOrder?: number;
    },
  ) {
    const data = await this.adminService.updateModel(slug, body);
    return { success: true, data };
  }

  // ─── Promo codes ────────────────────────────────────────────────

  @Get('promo-codes')
  @ApiOperation({ summary: 'List all promo codes' })
  async getPromoCodes() {
    const data = await this.adminService.getPromoCodes();
    return { success: true, data };
  }

  @Post('promo-codes')
  @ApiOperation({ summary: 'Create promo code' })
  @HttpCode(201)
  async createPromoCode(
    @CurrentUser('sub') adminId: string,
    @Body() body: {
      code: string;
      description: string;
      bonusTokens: number;
      discountPercent?: number;
      maxUses?: number;
      expiresAt?: string;
    },
  ) {
    const data = await this.adminService.createPromoCode(adminId, body);
    return { success: true, data };
  }

  @Delete('promo-codes/:code')
  @ApiOperation({ summary: 'Deactivate promo code' })
  async deactivatePromo(@Param('code') code: string) {
    const data = await this.adminService.deactivatePromo(code);
    return { success: true, data };
  }

  // ─── Analytics ──────────────────────────────────────────────────

  @Get('analytics/revenue')
  @ApiOperation({ summary: 'Revenue analytics' })
  async getRevenue(@Query('days') days = 30) {
    const data = await this.adminService.getRevenueAnalytics(days);
    return { success: true, data };
  }

  @Get('analytics/generations')
  @ApiOperation({ summary: 'Generation analytics' })
  async getGenerationAnalytics(@Query('days') days = 30) {
    const data = await this.adminService.getGenerationAnalytics(days);
    return { success: true, data };
  }

  @Get('analytics/models')
  @ApiOperation({ summary: 'Model usage analytics' })
  async getModelAnalytics() {
    const data = await this.adminService.getModelUsageAnalytics();
    return { success: true, data };
  }
}