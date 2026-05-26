// src/modules/admin/admin.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Generation, GenerationSchema } from '../generation/schemas/generation.schema';
import { Transaction, TransactionSchema } from '../billing/schemas/transaction.schema';
import { UsersModule } from '../users/users.module';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';
import { BillingModule } from '../billing/billing.module';
import { AIModel, AIModelSchema } from '../ai-providers/schemas/model.schema';
import {
  TokenomicsSettings,
  TokenomicsSettingsSchema,
} from './schemas/tokenomics-settings.schema';
import { AdminBillingService } from './admin-billing.service';
import { AdminBillingController } from './admin-billing.controller';

// Promo codes
import {
  PromoCode,
  PromoCodeSchema,
} from '../billing/schemas/promo-code.schema';
import { AdminPromoCodesController } from './admin-promo-codes.controller';
import { AdminPromoCodesService } from './admin-promo-codes.service';

// 🆕 Transactions
import { AdminTransactionsController } from './admin-transactions.controller';
import { AdminTransactionsService } from './admin-transactions.service';
import { ReferralAdminController } from './admin-referral.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Generation.name, schema: GenerationSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: AIModel.name, schema: AIModelSchema },
      { name: TokenomicsSettings.name, schema: TokenomicsSettingsSchema },
      { name: PromoCode.name, schema: PromoCodeSchema },
    ]),
    forwardRef(() => UsersModule),
    forwardRef(() => AiProvidersModule),
    forwardRef(() => BillingModule),
  ],
  controllers: [
    AdminController,
    AdminBillingController,
    AdminPromoCodesController,
    AdminTransactionsController, // 🆕
    ReferralAdminController
  ],
  providers: [
    AdminService,
    AdminBillingService,
    AdminPromoCodesService,
    AdminTransactionsService, // 🆕
  ],
})
export class AdminModule {}