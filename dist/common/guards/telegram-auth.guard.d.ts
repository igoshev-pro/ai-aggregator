import { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
export declare class TelegramAuthGuard implements CanActivate {
    private configService;
    constructor(configService: ConfigService);
    canActivate(context: ExecutionContext): boolean;
    private validateTelegramData;
}
