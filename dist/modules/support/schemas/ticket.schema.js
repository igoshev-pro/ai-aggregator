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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TicketSchema = exports.Ticket = void 0;
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
let Ticket = class Ticket {
};
exports.Ticket = Ticket;
__decorate([
    (0, mongoose_1.Prop)({ required: true, type: mongoose_2.Types.ObjectId, ref: 'User', index: true }),
    __metadata("design:type", mongoose_2.Types.ObjectId)
], Ticket.prototype, "userId", void 0);
__decorate([
    (0, mongoose_1.Prop)({ required: true }),
    __metadata("design:type", String)
], Ticket.prototype, "subject", void 0);
__decorate([
    (0, mongoose_1.Prop)({
        type: [{
                role: { type: String, enum: ['user', 'support'] },
                content: String,
                createdAt: { type: Date, default: Date.now },
            }],
        default: [],
    }),
    __metadata("design:type", Array)
], Ticket.prototype, "messages", void 0);
__decorate([
    (0, mongoose_1.Prop)({ default: 'open', enum: ['open', 'in_progress', 'resolved', 'closed'] }),
    __metadata("design:type", String)
], Ticket.prototype, "status", void 0);
__decorate([
    (0, mongoose_1.Prop)({ default: 'medium', enum: ['low', 'medium', 'high'] }),
    __metadata("design:type", String)
], Ticket.prototype, "priority", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", String)
], Ticket.prototype, "assignedTo", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", Date)
], Ticket.prototype, "resolvedAt", void 0);
exports.Ticket = Ticket = __decorate([
    (0, mongoose_1.Schema)({ timestamps: true })
], Ticket);
exports.TicketSchema = mongoose_1.SchemaFactory.createForClass(Ticket);
exports.TicketSchema.index({ userId: 1, status: 1 });
exports.TicketSchema.index({ status: 1, priority: -1 });
//# sourceMappingURL=ticket.schema.js.map