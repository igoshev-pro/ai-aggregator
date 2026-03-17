import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/generation',
  transports: ['websocket', 'polling'],
})
export class GenerationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(GenerationGateway.name);
  private userSockets = new Map<string, Set<string>>();

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      const userId = payload.sub;
      client.data.userId = userId;

      const sockets = this.userSockets.get(userId);
      if (sockets) {
        sockets.add(client.id);
      } else {
        this.userSockets.set(userId, new Set([client.id]));
      }

      client.join(`user:${userId}`);
      this.logger.log(`Client connected: ${client.id}, user: ${userId}`);
    } catch (error: any) {
      this.logger.warn(`Connection rejected: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
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

  @SubscribeMessage('generation:subscribe')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { generationId: string },
  ) {
    client.join(`generation:${data.generationId}`);
    return { event: 'subscribed', data: { generationId: data.generationId } };
  }

  @SubscribeMessage('generation:unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { generationId: string },
  ) {
    client.leave(`generation:${data.generationId}`);
    return { event: 'unsubscribed', data: { generationId: data.generationId } };
  }

  // ← ДОБАВЛЕН ЛОГ
  sendToUser(userId: string, event: string, data: any) {
    const sockets = this.userSockets.get(userId);
    this.logger.log(
      `sendToUser userId=${userId} event=${event} online=${!!sockets?.size} sockets=${sockets?.size || 0}`,
    );
    this.server.to(`user:${userId}`).emit(event, data);
  }

  sendToGeneration(generationId: string, event: string, data: any) {
    this.server.to(`generation:${generationId}`).emit(event, data);
  }

  broadcast(event: string, data: any) {
    this.server.emit(event, data);
  }

  isUserOnline(userId: string): boolean {
    const sockets = this.userSockets.get(userId);
    return !!sockets && sockets.size > 0;
  }
}