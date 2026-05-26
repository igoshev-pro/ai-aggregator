// src/modules/referral/referral-admin.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiQuery,
} from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard'; // если есть
import { Roles } from '@/common/decorators/roles.decorator'; // если есть
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { UserRole } from '@/common/interfaces';
import { ReferralService } from '../referral/referral.service';
import { WithdrawalStatus } from '../referral/schemas/withdrawal.schema';

class AdminWithdrawalActionDto {
  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  adminNote?: string;
}

@ApiTags('Admin / Referral')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin/referral')
export class ReferralAdminController {
  constructor(private readonly referralService: ReferralService) {}

  // ─── Выводы ─────────────────────────────────────────────────

  @Get('withdrawals')
  @ApiOperation({ summary: 'Список всех заявок на вывод' })
  @ApiQuery({ name: 'status', enum: WithdrawalStatus, required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getAllWithdrawals(
    @Query('status') status?: WithdrawalStatus,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit = 30,
  ) {
    const data = await this.referralService.adminGetAllWithdrawals(
      status,
      page,
      Math.min(limit, 100),
    );
    return { success: true, data };
  }

  @Get('withdrawals/summary')
  @ApiOperation({ summary: 'Сводка по выводам (по статусам)' })
  async getWithdrawalSummary() {
    const data = await this.referralService.adminGetWithdrawalSummary();
    return { success: true, data };
  }

  @Patch('withdrawals/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Одобрить заявку (взять в работу)' })
  async approveWithdrawal(
    @Param('id') id: string,
    @CurrentUser('sub') adminId: string,
    @Body() dto: AdminWithdrawalActionDto,
  ) {
    const data = await this.referralService.adminApproveWithdrawal(
      id,
      adminId,
      dto.adminNote || '',
    );
    return { success: true, data };
  }

  @Patch('withdrawals/:id/paid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отметить заявку как выплаченную' })
  async markPaid(
    @Param('id') id: string,
    @CurrentUser('sub') adminId: string,
    @Body() dto: AdminWithdrawalActionDto,
  ) {
    const data = await this.referralService.adminMarkPaid(
      id,
      adminId,
      dto.adminNote || '',
    );
    return { success: true, data };
  }

  @Patch('withdrawals/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Отклонить заявку (вернёт кэшбек юзеру атомарно)',
  })
  async rejectWithdrawal(
    @Param('id') id: string,
    @CurrentUser('sub') adminId: string,
    @Body() dto: AdminWithdrawalActionDto,
  ) {
    const data = await this.referralService.adminRejectWithdrawal(
      id,
      adminId,
      dto.adminNote || 'Отклонено администратором',
    );
    return { success: true, data };
  }

  // ─── Аналитика ──────────────────────────────────────────────

  @Get('top-referrers')
  @ApiOperation({ summary: 'Топ рефереров по заработку' })
  @ApiQuery({ name: 'limit', required: false })
  async getTopReferrers(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    const data = await this.referralService.adminGetTopReferrers(
      Math.min(limit, 100),
    );
    return { success: true, data };
  }
}