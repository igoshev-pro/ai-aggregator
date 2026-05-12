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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: PromoCode.name, schema: PromoCodeSchema },
      { name: AIModel.name, schema: AIModelSchema }, // ДОБАВЛЕНО
    ]),
    forwardRef(() => UsersModule),
  ],
  controllers: [BillingController],
  providers: [
    BillingService,
    YookassaProvider,
    CryptomusProvider,
    StarsProvider,
    FreedomPayProvider,
  ],
  exports: [BillingService],
})
export class BillingModule {}