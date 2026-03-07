import { Model, Types } from 'mongoose';
import { Conversation, ConversationDocument } from './schemas/conversation.schema';
import { Message, MessageDocument } from './schemas/message.schema';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { UsersService } from '../users/users.service';
import { BillingService } from '../billing/billing.service';
export interface SendMessageDto {
    conversationId?: string;
    modelSlug: string;
    content: string;
    imageUrls?: string[];
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
}
export declare class ChatService {
    private conversationModel;
    private messageModel;
    private aiProvidersService;
    private usersService;
    private billingService;
    private readonly logger;
    constructor(conversationModel: Model<ConversationDocument>, messageModel: Model<MessageDocument>, aiProvidersService: AiProvidersService, usersService: UsersService, billingService: BillingService);
    getConversations(userId: string, page?: number, limit?: number): Promise<{
        conversations: (import("mongoose").Document<unknown, {}, ConversationDocument, {}, {}> & Conversation & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
            _id: Types.ObjectId;
        }> & {
            __v: number;
        })[];
        pagination: {
            page: number;
            limit: number;
            total: number;
            pages: number;
        };
    }>;
    getMessages(userId: string, conversationId: string, page?: number, limit?: number): Promise<{
        messages: (import("mongoose").Document<unknown, {}, MessageDocument, {}, {}> & Message & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
            _id: Types.ObjectId;
        }> & {
            __v: number;
        })[];
        pagination: {
            page: number;
            limit: number;
            total: number;
            pages: number;
        };
    }>;
    sendMessage(userId: string, dto: SendMessageDto): Promise<{
        message: import("mongoose").Document<unknown, {}, MessageDocument, {}, {}> & Message & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
            _id: Types.ObjectId;
        }> & {
            __v: number;
        };
        conversation: {
            id: Types.ObjectId;
            title: string;
        };
    }>;
    streamMessage(userId: string, dto: SendMessageDto): AsyncGenerator<{
        type: string;
        data: any;
    }>;
    createConversation(userId: string, dto: Partial<SendMessageDto>): Promise<ConversationDocument>;
    deleteConversation(userId: string, conversationId: string): Promise<{
        deleted: boolean;
    }>;
    renameConversation(userId: string, conversationId: string, title: string): Promise<ConversationDocument>;
    togglePin(userId: string, conversationId: string): Promise<ConversationDocument>;
    private buildContext;
    private getConversationWithAccess;
    private generateTitle;
}
