// src/modules/chat/chat.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { Conversation, ConversationSchema } from './schemas/conversation.schema';
import { Message, MessageSchema } from './schemas/message.schema';
import { AIModel, AIModelSchema } from '../ai-providers/schemas/model.schema';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';
import { UsersModule } from '../users/users.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
      { name: AIModel.name, schema: AIModelSchema },
    ]),
    forwardRef(() => AiProvidersModule),
    forwardRef(() => UsersModule),
    forwardRef(() => BillingModule),
  ],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}