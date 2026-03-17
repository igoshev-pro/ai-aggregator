import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bull';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { GenerationGateway } from './generation.gateway';
import { GenerationConsumer } from './queues/generation.consumer';
import { Generation, GenerationSchema } from './schemas/generation.schema';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';
import { UsersModule } from '../users/users.module';
import { BillingModule } from '../billing/billing.module';
import { StorageModule } from '../storage/storage.module'; // ← ДОБАВИТЬ

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Generation.name, schema: GenerationSchema },
    ]),
    BullModule.registerQueue({
      name: 'generation',
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 20,
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
      },
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
    forwardRef(() => AiProvidersModule),
    forwardRef(() => UsersModule),
    forwardRef(() => BillingModule),
    StorageModule,
  ],
  controllers: [GenerationController],
  providers: [GenerationService, GenerationGateway, GenerationConsumer],
  exports: [GenerationService, GenerationGateway],
})
export class GenerationModule {}