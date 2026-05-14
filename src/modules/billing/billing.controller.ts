import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  Headers,
  Header,
  UseInterceptors,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { TransactionType, SubscriptionPlan } from '@/common/interfaces';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';

type PaymentProviderName =
  | 'yookassa'
  | 'cryptomus'
  | 'stars'
  | 'freedompay'
  | 'tochka'
  | 'heleket';

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('packages')
  @ApiOperation({ summary: 'Get available token packages' })
  getPackages(@Query('currency') currency?: 'RUB' | 'USD') {
    return {
      success: true,
      data: this.billingService.getTokenPackages(currency || 'RUB'),
    };
  }

  @Get('plans')
  @ApiOperation({ summary: 'Get subscription plans' })
  getPlans(@Query('currency') currency?: 'RUB' | 'USD') {
    return {
      success: true,
      data: this.billingService.getSubscriptionPlans(currency || 'RUB'),
    };
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
    @Body()
    body: {
      packageId: string;
      provider: PaymentProviderName;
      currency?: 'RUB' | 'USD';
      returnUrl?: string;
    },
  ) {
    const result = await this.billingService.createTokenPayment(
      userId,
      body.packageId,
      body.provider,
      body.currency || 'RUB',
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
    @Body()
    body: {
      plan: SubscriptionPlan;
      provider: PaymentProviderName;
      currency?: 'RUB' | 'USD';
      returnUrl?: string;
    },
  ) {
    const result = await this.billingService.createSubscription(
      userId,
      body.plan,
      body.provider,
      body.currency || 'RUB',
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
  async yookassaWebhook(@Body() body: any, @Headers() headers: any) {
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
  async cryptomusWebhook(@Body() body: any, @Headers() headers: any) {
    const result = await this.billingService.handlePaymentWebhook(
      'cryptomus',
      body,
      headers,
    );
    return result;
  }

  @Post('webhook/freedompay')
  @ApiOperation({ summary: 'FreedomPay payment webhook (XML in/out)' })
  @HttpCode(200)
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @UseInterceptors(AnyFilesInterceptor())
  async freedompayWebhook(@Body() body: any): Promise<string> {
    return this.billingService.handleFreedomPayWebhook(body);
  }

  /**
   * Точка шлёт webhook как text/plain с JWT в теле.
   * В main.ts настроен bodyParser.text() для этого пути,
   * поэтому здесь body будет строкой.
   *
   * Возвращаем 200 OK почти всегда (чтобы Точка не ретраила бесконечно).
   * Если подпись невалидна — handleTochkaWebhook бросит UnauthorizedException → 401.
   */
  @Post('webhook/tochka')
  @ApiOperation({ summary: 'Tochka Bank payment webhook (JWT text/plain)' })
  @HttpCode(200)
  async tochkaWebhook(@Req() req: Request): Promise<{ ok: boolean }> {
    // body может прийти как string (text/plain) либо как Buffer — нормализуем
    const raw =
      typeof req.body === 'string'
        ? req.body
        : Buffer.isBuffer(req.body)
          ? req.body.toString('utf8')
          : String(req.body || '');

    return this.billingService.handleTochkaWebhook(raw);
  }

  @Post('webhook/heleket')
@ApiOperation({ summary: 'Heleket payment webhook' })
@HttpCode(200)
async heleketWebhook(@Body() body: any, @Headers() headers: any) {
  const result = await this.billingService.handlePaymentWebhook(
    'heleket',
    body,
    headers,
  );
  return result;
}
}