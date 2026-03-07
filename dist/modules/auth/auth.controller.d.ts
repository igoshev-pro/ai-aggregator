import { AuthService } from './auth.service';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    telegramAuth(dto: TelegramAuthDto): Promise<{
        success: boolean;
        data: import("./dto/telegram-auth.dto").AuthResponseDto;
    }>;
    devAuth(dto: {
        userId: number;
        username?: string;
    }): Promise<import("./dto/telegram-auth.dto").AuthResponseDto>;
    refresh(userId: string): Promise<{
        success: boolean;
        data: {
            accessToken: string;
        };
    }>;
}
