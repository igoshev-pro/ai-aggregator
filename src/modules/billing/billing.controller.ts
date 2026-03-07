import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  Req,
  HttpCode,
  Headers,
  RawBodyRequest,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { TransactionType, SubscriptionPlan } from '@/common/interfaces';

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('packages')
  @ApiOperation({ summary: 'Get available token packages' })
  getPackages() {
    return { success: true, data: this.billingService.getTokenPackages() };
  }

  @Get('plans')
  @ApiOperation({ summary: 'Get subscription plans' })
  getPlans() {
    return { success: true, data: this.billingService.getSubscriptionPlans() };
  }

  @Get('balance')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get user balance and limits' })
  async getBalance(@CurrentUser('sub') userId: string) {
    const result = await this.billingService.getBalance(userId);
    return { success: true, data: result };
  }

  @Post('pay/tokens')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create payment for token package' })
  @HttpCode(200)
  async payTokens(
    @CurrentUser('sub') userId: string,
    @Body() body: {
      packageId: string;
      provider: 'yookassa' | 'cryptomus' | 'stars';
      returnUrl?: string;
    },
  ) {
    const result = await this.billingService.createTokenPayment(
      userId,
      body.packageId,
      body.provider,
      body.returnUrl,
    );
    return { success: true, data: result };
  }

  @Post('pay/subscription')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create payment for subscription' })
  @HttpCode(200)
  async paySubscription(
    @CurrentUser('sub') userId: string,
    @Body() body: {
      plan: SubscriptionPlan;
      provider: 'yookassa' | 'cryptomus' | 'stars';
      returnUrl?: string;
    },
  ) {
    const result = await this.billingService.createSubscription(
      userId,
      body.plan,
      body.provider,
      body.returnUrl,
    );
    return { success: true, data: result };
  }

  @Post('promo')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Apply promo code' })
  @HttpCode(200)
  async applyPromo(
    @CurrentUser('sub') userId: string,
    @Body() body: { code: string },
  ) {
    const result = await this.billingService.applyPromoCode(userId, body.code);
    return { success: true, data: result };
  }

  @Get('transactions')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get transaction history' })
  async getTransactions(
    @CurrentUser('sub') userId: string,
    @Query('type') type?: TransactionType,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const result = await this.billingService.getTransactionHistory(
      userId,
      type,
      page,
      limit,
    );
    return { success: true, data: result };
  }

  // === Webhooks (без авторизации JWT) ===

  @Post('webhook/yookassa')
  @ApiOperation({ summary: 'YooKassa payment webhook' })
  @HttpCode(200)
  async yookassaWebhook(
    @Body() body: any,
    @Headers() headers: any,
  ) {
    const result = await this.billingService.handlePaymentWebhook(
      'yookassa',
      body,
      headers,
    );
    return result;
  }

  @Post('webhook/cryptomus')
  @ApiOperation({ summary: 'Cryptomus payment webhook' })
  @HttpCode(200)
  async cryptomusWebhook(
    @Body() body: any,
    @Headers() headers: any,
  ) {
    const result = await this.billingService.handlePaymentWebhook(
      'cryptomus',
      body,
      headers,
    );
    return result;
  }
}