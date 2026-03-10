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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Generation.name, schema: GenerationSchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    forwardRef(() => UsersModule),
    forwardRef(() => AiProvidersModule),
    forwardRef(() => BillingModule),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}