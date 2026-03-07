import { Document, Types } from 'mongoose';
export type ConversationDocument = Conversation & Document;
export declare class Conversation {
    userId: Types.ObjectId;
    modelSlug: string;
    title: string;
    isPinned: boolean;
    isArchived: boolean;
    messageCount: number;
    totalTokensUsed: number;
    systemPrompt: string;
    settings: {
        temperature?: number;
        maxTokens?: number;
        topP?: number;
    };
    lastMessageAt: Date;
}
export declare const ConversationSchema: import("mongoose").Schema<Conversation, import("mongoose").Model<Conversation, any, any, any, Document<unknown, any, Conversation, any, {}> & Conversation & {
    _id: Types.ObjectId;
} & {
    __v: number;
}, any>, {}, {}, {}, {}, import("mongoose").DefaultSchemaOptions, Conversation, Document<unknown, {}, import("mongoose").FlatRecord<Conversation>, {}, import("mongoose").DefaultSchemaOptions> & import("mongoose").FlatRecord<Conversation> & {
    _id: Types.ObjectId;
} & {
    __v: number;
}>;
