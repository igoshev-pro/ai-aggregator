import { Document, Types } from 'mongoose';
export type MessageDocument = Message & Document;
export declare class Message {
    conversationId: Types.ObjectId;
    userId: Types.ObjectId;
    role: string;
    content: string;
    imageUrls: string[];
    modelSlug: string;
    providerSlug: string;
    usage: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
    };
    responseTimeMs: number;
    tokensCost: number;
    isError: boolean;
    errorMessage: string;
    isStreaming: boolean;
}
export declare const MessageSchema: import("mongoose").Schema<Message, import("mongoose").Model<Message, any, any, any, Document<unknown, any, Message, any, {}> & Message & {
    _id: Types.ObjectId;
} & {
    __v: number;
}, any>, {}, {}, {}, {}, import("mongoose").DefaultSchemaOptions, Message, Document<unknown, {}, import("mongoose").FlatRecord<Message>, {}, import("mongoose").DefaultSchemaOptions> & import("mongoose").FlatRecord<Message> & {
    _id: Types.ObjectId;
} & {
    __v: number;
}>;
