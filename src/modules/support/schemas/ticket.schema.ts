import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TicketDocument = Ticket & Document;

@Schema({ timestamps: true })
export class Ticket {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  subject: string;

  @Prop({
    type: [{
      role: { type: String, enum: ['user', 'support'] },
      content: String,
      createdAt: { type: Date, default: Date.now },
    }],
    default: [],
  })
  messages: {
    role: 'user' | 'support';
    content: string;
    createdAt: Date;
  }[];

  @Prop({ default: 'open', enum: ['open', 'in_progress', 'resolved', 'closed'] })
  status: string;

  @Prop({ default: 'medium', enum: ['low', 'medium', 'high'] })
  priority: string;

  @Prop()
  assignedTo: string;

  @Prop()
  resolvedAt: Date;
}

export const TicketSchema = SchemaFactory.createForClass(Ticket);

TicketSchema.index({ userId: 1, status: 1 });
TicketSchema.index({ status: 1, priority: -1 });