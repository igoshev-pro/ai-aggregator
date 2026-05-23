import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { UserRole } from '@/common/interfaces';
import { AdminBillingService } from './admin-billing.service';

@ApiTags('Admin Billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin')
export class AdminBillingController {
  constructor(private readonly svc: AdminBillingService) {}

  // ─── Plans ─────────────────────────────────────────────────────

  @Get('plans')
  @ApiOperation({ summary: 'List subscription plans' })
  async listPlans() {
    const data = await this.svc.listPlans();
    return { success: true, data };
  }

  @Get('plans/:id')
  @ApiOperation({ summary: 'Get plan by ID' })
  async getPlan(@Param('id') id: string) {
    const data = await this.svc.getPlan(id);
    return { success: true, data };
  }

  @Post('plans')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(201)
  @ApiOperation({ summary: 'Create new plan' })
  async createPlan(@Body() body: any) {
    const data = await this.svc.createPlan(body);
    return { success: true, data };
  }

  @Put('plans/:id')
  @ApiOperation({ summary: 'Update plan' })
  async updatePlan(@Param('id') id: string, @Body() body: any) {
    const data = await this.svc.updatePlan(id, body);
    return { success: true, data };
  }

  @Post('plans/:id/toggle')
  @HttpCode(200)
  @ApiOperation({ summary: 'Toggle plan isActive' })
  async togglePlan(@Param('id') id: string) {
    const data = await this.svc.togglePlan(id);
    return { success: true, data };
  }

  @Delete('plans/:id')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete plan' })
  async deletePlan(@Param('id') id: string) {
    const data = await this.svc.deletePlan(id);
    return { success: true, data };
  }

  // ─── Token packages ────────────────────────────────────────────

  @Get('token-packages')
  @ApiOperation({ summary: 'List token packages' })
  async listPackages() {
    const data = await this.svc.listPackages();
    return { success: true, data };
  }

  @Get('token-packages/:id')
  @ApiOperation({ summary: 'Get package by ID' })
  async getPackage(@Param('id') id: string) {
    const data = await this.svc.getPackage(id);
    return { success: true, data };
  }

  @Post('token-packages')
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(201)
  @ApiOperation({ summary: 'Create new token package' })
  async createPackage(@Body() body: any) {
    const data = await this.svc.createPackage(body);
    return { success: true, data };
  }

  @Put('token-packages/:id')
  @ApiOperation({ summary: 'Update token package' })
  async updatePackage(@Param('id') id: string, @Body() body: any) {
    const data = await this.svc.updatePackage(id, body);
    return { success: true, data };
  }

  @Post('token-packages/:id/toggle')
  @HttpCode(200)
  @ApiOperation({ summary: 'Toggle package isActive' })
  async togglePackage(@Param('id') id: string) {
    const data = await this.svc.togglePackage(id);
    return { success: true, data };
  }

  @Delete('token-packages/:id')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete package' })
  async deletePackage(@Param('id') id: string) {
    const data = await this.svc.deletePackage(id);
    return { success: true, data };
  }
}