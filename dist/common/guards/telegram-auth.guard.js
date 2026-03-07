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
exports.TelegramAuthGuard = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const crypto = require("crypto");
let TelegramAuthGuard = class TelegramAuthGuard {
    constructor(configService) {
        this.configService = configService;
    }
    canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const initData = request.headers['x-telegram-init-data'];
        if (!initData) {
            throw new common_1.UnauthorizedException('Telegram init data is required');
        }
        const isValid = this.validateTelegramData(initData);
        if (!isValid) {
            throw new common_1.UnauthorizedException('Invalid Telegram init data');
        }
        const params = new URLSearchParams(initData);
        const userStr = params.get('user');
        if (userStr) {
            request.telegramUser = JSON.parse(decodeURIComponent(userStr));
        }
        return true;
    }
    validateTelegramData(initData) {
        const botToken = this.configService.get('TELEGRAM_BOT_TOKEN');
        if (!botToken) {
            throw new common_1.UnauthorizedException('Bot token not configured');
        }
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        if (!hash)
            return false;
        params.delete('hash');
        const dataCheckString = Array.from(params.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');
        const secretKey = crypto
            .createHmac('sha256', 'WebAppData')
            .update(botToken)
            .digest();
        const calculatedHash = crypto
            .createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');
        if (calculatedHash !== hash)
            return false;
        const authDate = parseInt(params.get('auth_date') || '0', 10);
        const now = Math.floor(Date.now() / 1000);
        if (now - authDate > 3600)
            return false;
        return true;
    }
};
exports.TelegramAuthGuard = TelegramAuthGuard;
exports.TelegramAuthGuard = TelegramAuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], TelegramAuthGuard);
//# sourceMappingURL=telegram-auth.guard.js.map