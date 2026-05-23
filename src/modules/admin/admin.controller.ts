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
import { CreateModelDto, ModelsFilterDto, UpdateModelDto } from './dto/model.dto';
import { UpdateTokenomicsDto } from './dto/tokenomics.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ─── Access check ───────────────────────────────────────────────

  @Get('check')
  @ApiOperation({ summary: 'Check admin access' })
  async checkAccess(
    @CurrentUser('userId') userId: string,
    @CurrentUser('role') role: UserRole,
    @CurrentUser('telegramId') telegramId: number,
    @CurrentUser('username') username: string,
  ) {
    return { ok: true, role, telegramId, username, userId };
  }

  // ─── Dashboard ──────────────────────────────────────────────────

  @Get('dashboard')
  @ApiOperation({ summary: 'Get admin dashboard stats' })
  async getDashboard() {
    const data = await this.adminService.getDashboardStats();
    return { success: true, data };
  }

  // ─── Users ──────────────────────────────────────────────────────

  @Get('users')
  @ApiOperation({ summary: 'List users with filters' })
  async getUsers(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('search') search?: string,
    @Query('role') role?: UserRole | 'all',
    @Query('banned') banned?: 'all' | 'active' | 'banned',
    @Query('sortBy') sortBy?: string,
    @Query('order') order?: 'asc' | 'desc',
  ) {
    const data = await this.adminService.getUsers(
      Number(page),
      Number(limit),
      search,
      role,
      banned,
      sortBy,
      order,
    );
    return { success: true, data };
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get user details with stats' })
  async getUserById(@Param('id') userId: string) {
    const data = await this.adminService.getUserById(userId);
    return { success: true, data };
  }

  @Put('users/:id/role')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Change user role (SUPER_ADMIN only)' })
  async changeRole(
    @CurrentUser('sub') adminId: string,
    @Param('id') userId: string,
    @Body('role') role: UserRole,
  ) {
    const data = await this.adminService.changeUserRole(adminId, userId, role);
    return { success: true, data };
  }

  @Put('users/:id/ban')
  @ApiOperation({ summary: 'Ban/unban user' })
  async toggleBan(
    @CurrentUser('sub') adminId: string,
    @Param('id') userId: string,
    @Body() body: { ban: boolean; reason?: string },
  ) {
    const data = await this.adminService.toggleBan(
      adminId,
      userId,
      body.ban,
      body.reason,
    );
    return { success: true, data };
  }

  @Post('users/:id/adjust-balance')
  @HttpCode(200)
  @ApiOperation({ summary: 'Adjust user balance (tokens/bonus/cashback)' })
  async adjustBalance(
    @CurrentUser('sub') adminId: string,
    @Param('id') userId: string,
    @Body()
    body: {
      balanceType: 'tokenBalance' | 'bonusTokens' | 'cashbackBalance';
      amount: number;
      reason: string;
    },
  ) {
    const data = await this.adminService.adminAdjustBalanceV2(
      adminId,
      userId,
      body.balanceType,
      body.amount,
      body.reason,
    );
    return { success: true, data };
  }

  @Delete('users/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete user (soft delete + anonymize)' })
  async deleteUser(
    @CurrentUser('sub') adminId: string,
    @Param('id') userId: string,
  ) {
    const data = await this.adminService.deleteUser(adminId, userId);
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
  @ApiOperation({ summary: 'List models with filters' })
  async getModels(@Query() filters: ModelsFilterDto) {
    const data = await this.adminService.getModelsFiltered(filters);
    return { success: true, data };
  }

  @Get('models/:slug')
  @ApiOperation({ summary: 'Get model by slug' })
  async getModel(@Param('slug') slug: string) {
    const data = await this.adminService.getModelBySlug(slug);
    return { success: true, data };
  }

  @Post('models')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(201)
  @ApiOperation({ summary: 'Create new model' })
  async createModel(@Body() body: CreateModelDto) {
    const data = await this.adminService.createModel(body);
    return { success: true, data };
  }

  @Put('models/:slug')
  @ApiOperation({ summary: 'Update model' })
  async updateModel(
    @Param('slug') slug: string,
    @Body() body: UpdateModelDto,
  ) {
    const data = await this.adminService.updateModel(slug, body);
    return { success: true, data };
  }

  @Post('models/:slug/toggle')
  @HttpCode(200)
  @ApiOperation({ summary: 'Toggle isActive flag' })
  async toggleModel(@Param('slug') slug: string) {
    const data = await this.adminService.toggleModelActive(slug);
    return { success: true, data };
  }

  @Delete('models/:slug')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete model (soft by default, ?hard=true for hard)' })
  async deleteModel(
    @Param('slug') slug: string,
    @Query('hard') hard?: string,
  ) {
    const data = await this.adminService.deleteModel(slug, hard === 'true');
    return { success: true, data };
  }

  // ─── Analytics ──────────────────────────────────────────────────

  @Get('analytics/revenue')
  @ApiOperation({ summary: 'Revenue analytics' })
  async getRevenue(@Query('days') days = 30) {
    const data = await this.adminService.getRevenueAnalytics(Number(days));
    return { success: true, data };
  }

  @Get('analytics/generations')
  @ApiOperation({ summary: 'Generation analytics' })
  async getGenerationAnalytics(@Query('days') days = 30) {
    const data = await this.adminService.getGenerationAnalytics(Number(days));
    return { success: true, data };
  }

  @Get('analytics/models')
  @ApiOperation({ summary: 'Model usage analytics' })
  async getModelAnalytics() {
    const data = await this.adminService.getModelUsageAnalytics();
    return { success: true, data };
  }

  // ─── Tokenomics settings ────────────────────────────────────────

  @Get('settings/tokenomics')
  @ApiOperation({ summary: 'Get tokenomics settings' })
  async getTokenomics() {
    const data = await this.adminService.getTokenomics();
    return { success: true, data };
  }

  @Put('settings/tokenomics')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update tokenomics settings' })
  async updateTokenomics(
    @CurrentUser('sub') adminId: string,
    @Body() body: UpdateTokenomicsDto,
  ) {
    const data = await this.adminService.updateTokenomics(adminId, body);
    return { success: true, data };
  }
}