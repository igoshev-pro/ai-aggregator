import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import {
  UserRole,
  TransactionType,
  PaymentStatus,
} from '@/common/interfaces';
import { AdminTransactionsService } from './admin-transactions.service';

type AdminResponse = { success: boolean; data: any };

@ApiTags('Admin Transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin/transactions')
export class AdminTransactionsController {
  constructor(private readonly svc: AdminTransactionsService) {}

    // ─── Список с фильтрами ───────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List transactions with filters' })
  async list(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('search') search?: string,
    @Query('userId') userId?: string,
    @Query('type') type?: TransactionType | 'all',
    @Query('status') status?: PaymentStatus | 'all',
    @Query('provider') provider?: string,
    @Query('modelSlug') modelSlug?: string,
    @Query('promoCode') promoCode?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('amountMin') amountMin?: string,
    @Query('amountMax') amountMax?: string,
    @Query('sortBy') sortBy?: string,
    @Query('order') order?: 'asc' | 'desc',
  ): Promise<AdminResponse> {
    const data = await this.svc.list({
      page: Number(page),
      limit: Number(limit),
      search,
      userId,
      type,
      status,
      provider,
      modelSlug,
      promoCode,
      dateFrom,
      dateTo,
      amountMin: amountMin !== undefined ? Number(amountMin) : undefined,
      amountMax: amountMax !== undefined ? Number(amountMax) : undefined,
      sortBy,
      order,
    });
    return { success: true, data };
  }

  // ─── Дашборд-статистика ───────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Aggregated transactions statistics' })
  async stats(
    @Query('days') days = 30,
  ): Promise<AdminResponse> {
    const data = await this.svc.getStats(Number(days));
    return { success: true, data };
  }

  // ─── Детали одной транзакции ──────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get transaction by ID (with user info)' })
  async getOne(
    @Param('id') id: string,
  ): Promise<AdminResponse> {
    const data = await this.svc.getById(id);
    return { success: true, data };
  }
}