"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const mongoose_1 = require("@nestjs/mongoose");
const throttler_1 = require("@nestjs/throttler");
const bull_1 = require("@nestjs/bull");
const schedule_1 = require("@nestjs/schedule");
const configuration_1 = require("./config/configuration");
const auth_module_1 = require("./modules/auth/auth.module");
const users_module_1 = require("./modules/users/users.module");
const billing_module_1 = require("./modules/billing/billing.module");
const ai_providers_module_1 = require("./modules/ai-providers/ai-providers.module");
const generation_module_1 = require("./modules/generation/generation.module");
const chat_module_1 = require("./modules/chat/chat.module");
const favorites_module_1 = require("./modules/favorites/favorites.module");
const admin_module_1 = require("./modules/admin/admin.module");
const referral_module_1 = require("./modules/referral/referral.module");
const support_module_1 = require("./modules/support/support.module");
const analytics_module_1 = require("./modules/analytics/analytics.module");
const health_module_1 = require("./modules/health/health.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                load: [configuration_1.default],
                envFilePath: '.env',
            }),
            mongoose_1.MongooseModule.forRootAsync({
                inject: [config_1.ConfigService],
                useFactory: (config) => ({
                    uri: config.get('MONGO_URI'),
                    autoIndex: true,
                }),
            }),
            bull_1.BullModule.forRootAsync({
                inject: [config_1.ConfigService],
                useFactory: (config) => ({
                    redis: {
                        host: config.get('REDIS_HOST'),
                        port: config.get('REDIS_PORT'),
                        password: config.get('REDIS_PASSWORD'),
                    },
                    defaultJobOptions: {
                        removeOnComplete: 100,
                        removeOnFail: 50,
                        attempts: 3,
                        backoff: {
                            type: 'exponential',
                            delay: 2000,
                        },
                    },
                }),
            }),
            throttler_1.ThrottlerModule.forRootAsync({
                inject: [config_1.ConfigService],
                useFactory: (config) => ([{
                        ttl: config.get('THROTTLE_TTL', 60) * 1000,
                        limit: config.get('THROTTLE_LIMIT', 60),
                    }]),
            }),
            schedule_1.ScheduleModule.forRoot(),
            auth_module_1.AuthModule,
            users_module_1.UsersModule,
            billing_module_1.BillingModule,
            ai_providers_module_1.AiProvidersModule,
            generation_module_1.GenerationModule,
            chat_module_1.ChatModule,
            favorites_module_1.FavoritesModule,
            admin_module_1.AdminModule,
            referral_module_1.ReferralModule,
            support_module_1.SupportModule,
            analytics_module_1.AnalyticsModule,
            health_module_1.HealthModule
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map