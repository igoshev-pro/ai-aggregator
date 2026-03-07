import { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
export declare class GenerationGateway implements OnGatewayConnection, OnGatewayDisconnect {
    private jwtService;
    private configService;
    server: Server;
    private readonly logger;
    private userSockets;
    constructor(jwtService: JwtService, configService: ConfigService);
    handleConnection(client: Socket): Promise<void>;
    handleDisconnect(client: Socket): void;
    handleSubscribe(client: Socket, data: {
        generationId: string;
    }): {
        event: string;
        data: {
            generationId: string;
        };
    };
    handleUnsubscribe(client: Socket, data: {
        generationId: string;
    }): {
        event: string;
        data: {
            generationId: string;
        };
    };
    sendToUser(userId: string, event: string, data: any): void;
    sendToGeneration(generationId: string, event: string, data: any): void;
    broadcast(event: string, data: any): void;
    isUserOnline(userId: string): boolean;
}
