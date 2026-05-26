import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AiProvidersController } from './ai-providers.controller';
import { AiProvidersService } from './ai-providers.service';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { AIModel, AIModelSchema } from './schemas/model.schema';
import { Provider, ProviderSchema } from './schemas/provider.schema';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AIModel.name, schema: AIModelSchema },
      { name: Provider.name, schema: ProviderSchema },
    ]),
    forwardRef(() => BillingModule),
  ],
  controllers: [AiProvidersController],
  providers: [AiProvidersService, ProviderRegistryService],
  exports: [
    AiProvidersService, 
    ProviderRegistryService,
    MongooseModule, // ВАЖНО: экспортируем MongooseModule для использования в других модулях
  ],
})
export class AiProvidersModule {}