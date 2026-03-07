import { SupportService } from './support.service';
export declare class SupportController {
    private readonly supportService;
    constructor(supportService: SupportService);
    createTicket(userId: string, body: {
        subject: string;
        message: string;
    }): Promise<{
        success: boolean;
        data: import("mongoose").Document<unknown, {}, import("./schemas/ticket.schema").TicketDocument, {}, {}> & import("./schemas/ticket.schema").Ticket & import("mongoose").Document<import("mongoose").Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        };
    }>;
    getTickets(userId: string, page?: number, limit?: number): Promise<{
        success: boolean;
        data: {
            tickets: (import("mongoose").Document<unknown, {}, import("./schemas/ticket.schema").TicketDocument, {}, {}> & import("./schemas/ticket.schema").Ticket & import("mongoose").Document<import("mongoose").Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
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
    addMessage(userId: string, ticketId: string, content: string): Promise<{
        success: boolean;
        data: import("mongoose").Document<unknown, {}, import("./schemas/ticket.schema").TicketDocument, {}, {}> & import("./schemas/ticket.schema").Ticket & import("mongoose").Document<import("mongoose").Types.ObjectId, any, any, Record<string, any>, {}> & Required<{
            _id: import("mongoose").Types.ObjectId;
        }> & {
            __v: number;
        };
    }>;
}
