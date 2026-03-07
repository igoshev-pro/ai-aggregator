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
var AuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const config_1 = require("@nestjs/config");
const users_service_1 = require("../users/users.service");
const crypto = require("crypto");
let AuthService = AuthService_1 = class AuthService {
    constructor(jwtService, usersService, configService) {
        this.jwtService = jwtService;
        this.usersService = usersService;
        this.configService = configService;
        this.logger = new common_1.Logger(AuthService_1.name);
        this.isDev = this.configService.get('NODE_ENV') !== 'production';
    }
    async authenticateWithTelegram(dto) {
        if (this.isDev) {
            if (dto.initData.includes('test') || dto.initData.includes('dev')) {
                this.logger.log('🔧 DEV mode: bypassing Telegram validation');
                return this.handleDevTelegramAuth(dto.initData, dto.referralCode);
            }
        }
        const telegramUser = this.validateAndParseInitData(dto.initData);
        if (!telegramUser) {
            throw new common_1.UnauthorizedException('Invalid Telegram authentication data');
        }
        const user = await this.usersService.findOrCreateByTelegram(telegramUser, dto.referralCode);
        if (user.isBanned) {
            throw new common_1.UnauthorizedException('Account is banned: ' + (user.banReason || 'No reason'));
        }
        const payload = {
            sub: user._id.toString(),
            telegramId: user.telegramId,
            role: user.role,
        };
        const accessToken = this.jwtService.sign(payload);
        return {
            accessToken,
            user: {
                id: user._id.toString(),
                telegramId: user.telegramId,
                firstName: user.firstName,
                username: user.username,
                tokenBalance: user.tokenBalance,
                bonusTokens: user.bonusTokens,
                role: user.role,
                subscriptionPlan: user.subscriptionPlan,
            },
        };
    }
    async devAuth(userId, username, role) {
        if (!this.isDev) {
            throw new common_1.UnauthorizedException('Dev auth is only available in development mode');
        }
        this.logger.log(`🔧 DEV Auth for user ${userId} (${username})`);
        const telegramUser = {
            id: userId,
            first_name: 'Test',
            last_name: 'User',
            username: username || `testuser_${userId}`,
            language_code: 'en',
            is_bot: false,
        };
        const user = await this.usersService.findOrCreateByTelegram(telegramUser, null);
        if (role && (role === 'admin' || role === 'moderator')) {
            user.role = role;
            await user.save();
        }
        if (user.tokenBalance === 0) {
            user.tokenBalance = 10000;
            user.bonusTokens = 5000;
            await user.save();
            this.logger.log(`🎁 DEV: Added test tokens to user ${userId}`);
        }
        const payload = {
            sub: user._id.toString(),
            telegramId: user.telegramId,
            role: user.role,
        };
        const accessToken = this.jwtService.sign(payload);
        return {
            accessToken,
            user: {
                id: user._id.toString(),
                telegramId: user.telegramId,
                firstName: user.firstName,
                username: user.username,
                tokenBalance: user.tokenBalance,
                bonusTokens: user.bonusTokens,
                role: user.role,
                subscriptionPlan: user.subscriptionPlan,
            },
        };
    }
    async handleDevTelegramAuth(initData, referralCode) {
        try {
            const params = new URLSearchParams(initData);
            const userStr = params.get('user');
            let userId = 123456789;
            let username = 'testuser';
            if (userStr) {
                try {
                    const userData = JSON.parse(decodeURIComponent(userStr));
                    userId = userData.id || userId;
                    username = userData.username || username;
                }
                catch (e) {
                    this.logger.warn('Failed to parse test user data, using defaults');
                }
            }
            return this.devAuth(userId, username);
        }
        catch (error) {
            this.logger.error('Error in handleDevTelegramAuth:', error);
            return this.devAuth(123456789, 'testuser');
        }
    }
    async devCreateToken(userId, telegramId, role = 'user') {
        if (!this.isDev) {
            throw new common_1.UnauthorizedException('Dev methods are only available in development mode');
        }
        const payload = {
            sub: userId,
            telegramId,
            role: role,
        };
        return this.jwtService.sign(payload);
    }
    async devValidateToken(token) {
        if (!this.isDev) {
            throw new common_1.UnauthorizedException('Dev methods are only available in development mode');
        }
        try {
            const decoded = this.jwtService.verify(token);
            return {
                valid: true,
                decoded,
                expiresAt: new Date(decoded.exp * 1000),
            };
        }
        catch (error) {
            return {
                valid: false,
                error: error.message,
            };
        }
    }
    validateAndParseInitData(initData) {
        try {
            const botToken = this.configService.get('TELEGRAM_BOT_TOKEN');
            if (!botToken) {
                if (this.isDev) {
                    this.logger.warn('⚠️ TELEGRAM_BOT_TOKEN not set, validation will fail');
                }
                return null;
            }
            const params = new URLSearchParams(initData);
            const hash = params.get('hash');
            if (!hash)
                return null;
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
            if (calculatedHash !== hash) {
                if (this.isDev) {
                    this.logger.warn(`❌ Hash mismatch: expected ${calculatedHash}, got ${hash}`);
                }
                return null;
            }
            const authDate = parseInt(params.get('auth_date') || '0', 10);
            const now = Math.floor(Date.now() / 1000);
            const maxAge = this.isDev ? 86400 * 30 : 86400;
            if (now - authDate > maxAge) {
                if (this.isDev) {
                    this.logger.warn(`⏰ Auth data expired: ${now - authDate} seconds old`);
                }
                return null;
            }
            const userStr = params.get('user');
            if (!userStr)
                return null;
            return JSON.parse(decodeURIComponent(userStr));
        }
        catch (error) {
            if (this.isDev) {
                this.logger.error('Error validating init data:', error);
            }
            return null;
        }
    }
    async refreshToken(userId) {
        const user = await this.usersService.findById(userId);
        const payload = {
            sub: user._id.toString(),
            telegramId: user.telegramId,
            role: user.role,
        };
        return { accessToken: this.jwtService.sign(payload) };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = AuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [jwt_1.JwtService,
        users_service_1.UsersService,
        config_1.ConfigService])
], AuthService);
//# sourceMappingURL=auth.service.js.map