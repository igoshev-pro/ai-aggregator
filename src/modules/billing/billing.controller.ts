// src/modules/billing/billing.controller.ts
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
  BadRequestException,
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
  async getPackages(@Query('currency') currency?: 'RUB' | 'USD') {
    const data = await this.billingService.getTokenPackages(currency || 'RUB');
    return {
      success: true,
      data,
    };
  }

  @Get('plans')
  @ApiOperation({ summary: 'Get subscription plans' })
  async getPlans(@Query('currency') currency?: 'RUB' | 'USD') {
    const data = await this.billingService.getSubscriptionPlans(currency || 'RUB');
    return {
      success: true,
      data,
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

  // ═══════════════════════════════════════════════════════════════
  // Покупка токенов / подписки (с поддержкой промокода)
  // ═══════════════════════════════════════════════════════════════

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
      promoCode?: string; // 🆕
    },
  ) {
    const result = await this.billingService.createTokenPayment(
      userId,
      body.packageId,
      body.provider,
      body.currency || 'RUB',
      body.returnUrl,
      body.promoCode, // 🆕
    );
    return { success: true, data: result };
  }

    @Post('pay/tokens-custom')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create payment for custom amount of tokens' })
  @HttpCode(200)
  async payTokensCustom(
    @CurrentUser('sub') userId: string,
    @Body()
    body: {
      tokens: number;
      provider: PaymentProviderName;
      currency?: 'RUB' | 'USD';
      returnUrl?: string;
    },
  ) {
    const result = await this.billingService.createCustomTokenPayment(
      userId,
      body.tokens,
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
      promoCode?: string; // 🆕
    },
  ) {
    const result = await this.billingService.createSubscription(
      userId,
      body.plan,
      body.provider,
      body.currency || 'RUB',
      body.returnUrl,
      body.promoCode, // 🆕
    );
    return { success: true, data: result };
  }

  // ═══════════════════════════════════════════════════════════════
  // Промокоды
  // ═══════════════════════════════════════════════════════════════

  /**
   * Применение промокода ОТДЕЛЬНО (без покупки).
   * Работает только для type=BONUS_TOKENS — начисляет токены сразу.
   * Для скидок/дней подписки нужно использовать /pay/tokens или /pay/subscription
   * с параметром promoCode.
   */
  @Post('promo')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Apply standalone promo code (bonus tokens only)' })
  @HttpCode(200)
  async applyPromo(
    @CurrentUser('sub') userId: string,
    @Body() body: { code: string },
  ) {
    const result = await this.billingService.applyPromoCode(userId, body.code);
    return { success: true, data: result };
  }

  /**
   * 🆕 Предпросмотр промокода — рассчитывает эффект (скидку/бонусы) БЕЗ применения.
   * Используется на странице оплаты, чтобы показать "−20%, итого 2400₽" до клика "Оплатить".
   */
    @Post('promo/preview')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Preview promo code effect (no apply)' })
  @HttpCode(200)
  async previewPromo(
    @CurrentUser('sub') userId: string,
    @Body()
    body: {
      code: string;
      purchaseType: 'subscription' | 'token_package';
      plan?: SubscriptionPlan; // для subscription
      packageId?: string;       // для token_package
    },
  ) {
    if (body.purchaseType === 'token_package') {
      if (!body.packageId) {
        throw new BadRequestException('packageId is required for token_package');
      }
      const result = await this.billingService.previewPromoCode(
        userId,
        body.code,
        { type: 'token_package', packageId: body.packageId },
      );
      return { success: true, data: result };
    }

    if (body.purchaseType === 'subscription') {
      if (!body.plan) {
        throw new BadRequestException('plan is required for subscription');
      }
      const result = await this.billingService.previewPromoCode(
        userId,
        body.code,
        { type: 'subscription', plan: body.plan },
      );
      return { success: true, data: result };
    }

    throw new BadRequestException('Invalid purchaseType');
  }


  // ═══════════════════════════════════════════════════════════════
  // 🆕 Free models quota (pre-flight для фронта)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Квота по бесплатным моделям подписки.
   *
   * Используется фронтом ДО отправки запроса на генерацию, чтобы:
   * - показывать "осталось X/Y" рядом с моделью
   * - блокировать Send при исчерпанном лимите
   * - показывать таймер до сброса
   *
   * @param modelSlug — опционально: если указан, возвращает данные только
   *                    по этой модели. Иначе — по всем free-моделям плана.
   */
  @Get('free-models/quota')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get free models usage quota for current user',
    description:
      'Returns hourly/daily usage and limits for free models of the user subscription plan. ' +
      'If modelSlug query param is provided, returns data only for that model.',
  })
  async getFreeModelsQuota(
    @CurrentUser('sub') userId: string,
    @Query('modelSlug') modelSlug?: string,
  ) {
    const data = await this.billingService.getFreeQuotaForUser(
      userId,
      modelSlug,
    );
    return { success: true, data };
  }

  // ═══════════════════════════════════════════════════════════════
  // Транзакции
  // ═══════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════
  // Webhooks (без авторизации JWT)
  // ═══════════════════════════════════════════════════════════════

  @Post('webhook/yookassa')
  @ApiOperation({ summary: 'YooKassa payment webhook' })
  @HttpCode(200)
  async yookassaWebhook(@Body() body: any, @Headers() headers: any) {
    return this.billingService.handlePaymentWebhook('yookassa', body, headers);
  }

  @Post('webhook/cryptomus')
  @ApiOperation({ summary: 'Cryptomus payment webhook' })
  @HttpCode(200)
  async cryptomusWebhook(@Body() body: any, @Headers() headers: any) {
    return this.billingService.handlePaymentWebhook('cryptomus', body, headers);
  }

  @Post('webhook/freedompay')
  @ApiOperation({ summary: 'FreedomPay payment webhook (XML in/out)' })
  @HttpCode(200)
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @UseInterceptors(AnyFilesInterceptor())
  async freedompayWebhook(@Body() body: any): Promise<string> {
    return this.billingService.handleFreedomPayWebhook(body);
  }

  @Post('webhook/tochka')
  @ApiOperation({ summary: 'Tochka Bank payment webhook (JWT text/plain)' })
  @HttpCode(200)
  async tochkaWebhook(@Req() req: Request): Promise<{ ok: boolean }> {
    const raw =
      typeof req.body === 'string'
        ? req.body
        : Buffer.isBuffer(req.body)
          ? req.body.toString('utf8')
          : String(req.body || '');

    if (!raw || raw.length < 20) {
      return { ok: true };
    }

    try {
      return await this.billingService.handleTochkaWebhook(raw);
    } catch (err) {
      return { ok: true };
    }
  }

  @Post('webhook/heleket')
  @ApiOperation({ summary: 'Heleket payment webhook' })
  @HttpCode(200)
  async heleketWebhook(@Body() body: any, @Headers() headers: any) {
    return this.billingService.handlePaymentWebhook('heleket', body, headers);
  }
}