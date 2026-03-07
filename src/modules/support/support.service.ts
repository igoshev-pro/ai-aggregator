import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Ticket, TicketDocument } from './schemas/ticket.schema';

@Injectable()
export class SupportService {
  constructor(
    @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
  ) {}

  async createTicket(userId: string, subject: string, message: string) {
    const ticket = new this.ticketModel({
      userId: new Types.ObjectId(userId),
      subject,
      messages: [{ role: 'user', content: message, createdAt: new Date() }],
    });
    return ticket.save();
  }

  async getUserTickets(userId: string, page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    const filter = { userId: new Types.ObjectId(userId) };

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

  async addMessage(userId: string, ticketId: string, content: string, role: 'user' | 'support' = 'user') {
    const ticket = await this.ticketModel.findById(ticketId);
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (role === 'user' && ticket.userId.toString() !== userId) {
      throw new ForbiddenException('Access denied');
    }

    ticket.messages.push({ role, content, createdAt: new Date() });

    if (role === 'support' && ticket.status === 'open') {
      ticket.status = 'in_progress';
    }

    await ticket.save();
    return ticket;
  }

  async closeTicket(ticketId: string) {
    return this.ticketModel.findByIdAndUpdate(
      ticketId,
      { status: 'closed', resolvedAt: new Date() },
      { new: true },
    );
  }

  // Для админки
  async getAllTickets(status?: string, page = 1, limit = 20) {
    const filter: any = {};
    if (status) filter.status = status;

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
}