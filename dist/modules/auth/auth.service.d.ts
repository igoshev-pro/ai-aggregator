import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '@/modules/users/users.service';
import { TelegramAuthDto, AuthResponseDto } from './dto/telegram-auth.dto';
export declare class AuthService {
    private jwtService;
    private usersService;
    private configService;
    private readonly logger;
    private readonly isDev;
    constructor(jwtService: JwtService, usersService: UsersService, configService: ConfigService);
    authenticateWithTelegram(dto: TelegramAuthDto): Promise<AuthResponseDto>;
    devAuth(userId: number, username?: string, role?: string): Promise<AuthResponseDto>;
    private handleDevTelegramAuth;
    devCreateToken(userId: string, telegramId: number, role?: string): Promise<string>;
    devValidateToken(token: string): Promise<any>;
    private validateAndParseInitData;
    refreshToken(userId: string): Promise<{
        accessToken: string;
    }>;
}
