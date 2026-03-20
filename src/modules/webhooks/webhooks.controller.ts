import { Controller, Post, Body, Logger, HttpCode } from '@nestjs/common';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  @Post('kie-callback')
  @HttpCode(200)
  async kieCallback(@Body() body: any) {
    this.logger.log(`KIE webhook received: ${JSON.stringify(body).substring(0, 500)}`);
    // Просто принимаем и логируем. Основная логика через polling.
    return { success: true };
  }
}