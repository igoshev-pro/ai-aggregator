import { Model, Types } from 'mongoose';
import { Ticket, TicketDocument } from './schemas/ticket.schema';
export declare class SupportService {
    private ticketModel;
    constructor(ticketModel: Model<TicketDocument>);
    createTicket(userId: string, subject: string, message: string): Promise<import("mongoose").Document<unknown, {}, TicketDocument, {}, {}> & Ticket & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
        _id: Types.ObjectId;
    }> & {
        __v: number;
    }>;
    getUserTickets(userId: string, page?: number, limit?: number): Promise<{
        tickets: (import("mongoose").Document<unknown, {}, TicketDocument, {}, {}> & Ticket & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
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
    addMessage(userId: string, ticketId: string, content: string, role?: 'user' | 'support'): Promise<import("mongoose").Document<unknown, {}, TicketDocument, {}, {}> & Ticket & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
        _id: Types.ObjectId;
    }> & {
        __v: number;
    }>;
    closeTicket(ticketId: string): Promise<(import("mongoose").Document<unknown, {}, TicketDocument, {}, {}> & Ticket & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
        _id: Types.ObjectId;
    }> & {
        __v: number;
    }) | null>;
    getAllTickets(status?: string, page?: number, limit?: number): Promise<{
        tickets: (import("mongoose").Document<unknown, {}, TicketDocument, {}, {}> & Ticket & import("mongoose").Document<Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
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
}
