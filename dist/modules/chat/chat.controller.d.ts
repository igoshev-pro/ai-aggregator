import { Response } from 'express';
import { ChatService, SendMessageDto } from './chat.service';
export declare class ChatController {
    private readonly chatService;
    constructor(chatService: ChatService);
    getConversations(userId: string, page?: number, limit?: number): Promise<{
        success: boolean;
        data: {
            conversations: (import("mongoose").Document<unknown, {}, import("./schemas/conversation.schema").ConversationDocument, {}, {}> & import("./schemas/conversation.schema").Conversation & import("mongoose").Document<import("mongoose").Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
                _id: import("mongoose").Types.ObjectId;
            }> & {
                __v: number;
            })[];
            pagination: {
                page: number;
                limit: number;
                total: number;
                pages: number;
            };
        };
    }>;
    getMessages(userId: string, conversationId: string, page?: number, limit?: number): Promise<{
        success: boolean;
        data: {
            messages: (import("mongoose").Document<unknown, {}, import("./schemas/message.schema").MessageDocument, {}, {}> & import("./schemas/message.schema").Message & import("mongoose").Document<import("mongoose").Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
                _id: import("mongoose").Types.ObjectId;
            }> & {
                __v: number;
            })[];
            pagination: {
                page: number;
                limit: number;
                total: number;
                pages: number;
            };
        };
    }>;
    deleteConversation(userId: string, conversationId: string): Promise<{
        success: boolean;
        message: string;
    }>;
    renameConversation(userId: string, conversationId: string, title: string): Promise<{
        success: boolean;
        data: {
            id: import("mongoose").Types.ObjectId;
            title: string;
        };
    }>;
    togglePin(userId: string, conversationId: string): Promise<{
        success: boolean;
        data: {
            id: import("mongoose").Types.ObjectId;
            isPinned: boolean;
        };
    }>;
    sendMessage(userId: string, dto: SendMessageDto): Promise<{
        success: boolean;
        data: {
            conversation: {
                id: import("mongoose").Types.ObjectId;
                title: string;
            };
            message: {
                id: import("mongoose").Types.ObjectId;
                role: string;
                content: string;
                modelSlug: string;
                usage: {
                    inputTokens?: number;
                    outputTokens?: number;
                    totalTokens?: number;
                };
                responseTimeMs: number;
                tokensCost: number;
                createdAt: any;
            };
        };
    }>;
    streamMessage(userId: string, dto: SendMessageDto, res: Response): Promise<void>;
}
