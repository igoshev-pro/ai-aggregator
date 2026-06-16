import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferralController } from './referral.controller';
import { ReferralService } from './referral.service';
import { Referral, ReferralSchema } from './schemas/referral.schema';
import { Withdrawal, WithdrawalSchema } from './schemas/withdrawal.schema';
import {
  Transaction,
  TransactionSchema,
} from '../billing/schemas/transaction.schema';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Referral.name, schema: ReferralSchema },
      { name: Withdrawal.name, schema: WithdrawalSchema },
      // 🆕 Для записи транзакции WITHDRAWAL при выплате
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    forwardRef(() => UsersModule),
  ],
  controllers: [ReferralController],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}