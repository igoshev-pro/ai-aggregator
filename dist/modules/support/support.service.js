"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupportService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const ticket_schema_1 = require("./schemas/ticket.schema");
let SupportService = class SupportService {
    constructor(ticketModel) {
        this.ticketModel = ticketModel;
    }
    async createTicket(userId, subject, message) {
        const ticket = new this.ticketModel({
            userId: new mongoose_2.Types.ObjectId(userId),
            subject,
            messages: [{ role: 'user', content: message, createdAt: new Date() }],
        });
        return ticket.save();
    }
    async getUserTickets(userId, page = 1, limit = 10) {
        const skip = (page - 1) * limit;
        const filter = { userId: new mongoose_2.Types.ObjectId(userId) };
        const [tickets, total] = await Promise.all([
            this.ticketModel
                .find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .exec(),
            this.ticketModel.countDocuments(filter),
        ]);
        return {
            tickets,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        };
    }
    async addMessage(userId, ticketId, content, role = 'user') {
        const ticket = await this.ticketModel.findById(ticketId);
        if (!ticket)
            throw new common_1.NotFoundException('Ticket not found');
        if (role === 'user' && ticket.userId.toString() !== userId) {
            throw new common_1.ForbiddenException('Access denied');
        }
        ticket.messages.push({ role, content, createdAt: new Date() });
        if (role === 'support' && ticket.status === 'open') {
            ticket.status = 'in_progress';
        }
        await ticket.save();
        return ticket;
    }
    async closeTicket(ticketId) {
        return this.ticketModel.findByIdAndUpdate(ticketId, { status: 'closed', resolvedAt: new Date() }, { new: true });
    }
    async getAllTickets(status, page = 1, limit = 20) {
        const filter = {};
        if (status)
            filter.status = status;
        const skip = (page - 1) * limit;
        const [tickets, total] = await Promise.all([
            this.ticketModel
                .find(filter)
                .populate('userId', 'firstName username telegramId')
                .sort({ priority: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .exec(),
            this.ticketModel.countDocuments(filter),
        ]);
        return {
            tickets,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        };
    }
};
exports.SupportService = SupportService;
exports.SupportService = SupportService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)(ticket_schema_1.Ticket.name)),
    __metadata("design:paramtypes", [mongoose_2.Model])
], SupportService);
//# sourceMappingURL=support.service.js.map