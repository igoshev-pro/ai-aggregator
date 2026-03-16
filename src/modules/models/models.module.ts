// src/modules/models/models.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ModelsController } from './models.controller';
import { AIModel, AIModelSchema } from '../ai-providers/schemas/model.schema';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';
import { UsersModule } from '../users/users.module';
import { ModelsService } from './models.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AIModel.name, schema: AIModelSchema },
    ]),
    forwardRef(() => AiProvidersModule),
    forwardRef(() => UsersModule),
  ],
  controllers: [ModelsController],
  providers: [ModelsService],
  exports: [ModelsService],
})
export class ModelsModule {}