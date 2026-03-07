import { Document, Types } from 'mongoose';
export type TicketDocument = Ticket & Document;
export declare class Ticket {
    userId: Types.ObjectId;
    subject: string;
    messages: {
        role: 'user' | 'support';
        content: string;
        createdAt: Date;
    }[];
    status: string;
    priority: string;
    assignedTo: string;
    resolvedAt: Date;
}
export declare const TicketSchema: import("mongoose").Schema<Ticket, import("mongoose").Model<Ticket, any, any, any, Document<unknown, any, Ticket, any, {}> & Ticket & {
    _id: Types.ObjectId;
} & {
    __v: number;
}, any>, {}, {}, {}, {}, import("mongoose").DefaultSchemaOptions, Ticket, Document<unknown, {}, import("mongoose").FlatRecord<Ticket>, {}, import("mongoose").DefaultSchemaOptions> & import("mongoose").FlatRecord<Ticket> & {
    _id: Types.ObjectId;
} & {
    __v: number;
}>;
