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
var GenerationGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GenerationGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const config_1 = require("@nestjs/config");
let GenerationGateway = GenerationGateway_1 = class GenerationGateway {
    constructor(jwtService, configService) {
        this.jwtService = jwtService;
        this.configService = configService;
        this.logger = new common_1.Logger(GenerationGateway_1.name);
        this.userSockets = new Map();
    }
    async handleConnection(client) {
        try {
            const token = client.handshake.auth?.token ||
                client.handshake.headers?.authorization?.replace('Bearer ', '');
            if (!token) {
                client.disconnect();
                return;
            }
            const payload = this.jwtService.verify(token, {
                secret: this.configService.get('JWT_SECRET'),
            });
            const userId = payload.sub;
            client.data.userId = userId;
            const sockets = this.userSockets.get(userId);
            if (sockets) {
                sockets.add(client.id);
            }
            else {
                this.userSockets.set(userId, new Set([client.id]));
            }
            client.join(`user:${userId}`);
            this.logger.log(`Client connected: ${client.id}, user: ${userId}`);
        }
        catch (error) {
            this.logger.warn(`Connection rejected: ${error.message}`);
            client.disconnect();
        }
    }
    handleDisconnect(client) {
        const userId = client.data?.userId;
        if (userId) {
            const sockets = this.userSockets.get(userId);
            if (sockets) {
                sockets.delete(client.id);
                if (sockets.size === 0) {
                    this.userSockets.delete(userId);
                }
            }
        }
        this.logger.debug(`Client disconnected: ${client.id}`);
    }
    handleSubscribe(client, data) {
        client.join(`generation:${data.generationId}`);
        return { event: 'subscribed', data: { generationId: data.generationId } };
    }
    handleUnsubscribe(client, data) {
        client.leave(`generation:${data.generationId}`);
        return { event: 'unsubscribed', data: { generationId: data.generationId } };
    }
    sendToUser(userId, event, data) {
        this.server.to(`user:${userId}`).emit(event, data);
    }
    sendToGeneration(generationId, event, data) {
        this.server.to(`generation:${generationId}`).emit(event, data);
    }
    broadcast(event, data) {
        this.server.emit(event, data);
    }
    isUserOnline(userId) {
        const sockets = this.userSockets.get(userId);
        return !!sockets && sockets.size > 0;
    }
};
exports.GenerationGateway = GenerationGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], GenerationGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)('generation:subscribe'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], GenerationGateway.prototype, "handleSubscribe", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('generation:unsubscribe'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], GenerationGateway.prototype, "handleUnsubscribe", null);
exports.GenerationGateway = GenerationGateway = GenerationGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({
        cors: { origin: '*', credentials: true },
        namespace: '/generation',
        transports: ['websocket', 'polling'],
    }),
    __metadata("design:paramtypes", [jwt_1.JwtService,
        config_1.ConfigService])
], GenerationGateway);
//# sourceMappingURL=generation.gateway.js.map