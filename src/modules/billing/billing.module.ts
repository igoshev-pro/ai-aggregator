import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { Transaction, TransactionSchema } from './schemas/transaction.schema';
import { Subscription, SubscriptionSchema } from './schemas/subscription.schema';
import { PromoCode, PromoCodeSchema } from './schemas/promo-code.schema';
import { AIModel, AIModelSchema } from '../ai-providers/schemas/model.schema';
import { YookassaProvider } from './providers/yookassa.provider';
import { CryptomusProvider } from './providers/cryptomus.provider';
import { StarsProvider } from './providers/stars.provider';
import { UsersModule } from '../users/users.module';
import { FreedomPayProvider } from './providers/freedompay/freedompay.provider';
import { TochkaProvider } from './providers/tochka/tochka.provider';
import { TochkaClient } from './providers/tochka/tochka.client';
import { TochkaWebhookVerifier } from './providers/tochka/tochka-webhook.verifier';
import { HeleketProvider } from './providers/heleket.provider'; // 👈 NEW
import { ReferralModule } from '../referral/referral.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: PromoCode.name, schema: PromoCodeSchema },
      { name: AIModel.name, schema: AIModelSchema },
    ]),
    forwardRef(() => UsersModule),
    forwardRef(() => ReferralModule),
  ],
  controllers: [BillingController],
  providers: [
    BillingService,
    YookassaProvider,
    CryptomusProvider,
    StarsProvider,
    FreedomPayProvider,
    // Tochka
    TochkaClient,
    TochkaWebhookVerifier,
    TochkaProvider,
    // Heleket 👇
    HeleketProvider,
  ],
  exports: [BillingService],
})
export class BillingModule {}