"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GenerationModule = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const bull_1 = require("@nestjs/bull");
const jwt_1 = require("@nestjs/jwt");
const config_1 = require("@nestjs/config");
const generation_controller_1 = require("./generation.controller");
const generation_service_1 = require("./generation.service");
const generation_gateway_1 = require("./generation.gateway");
const generation_consumer_1 = require("./queues/generation.consumer");
const generation_schema_1 = require("./schemas/generation.schema");
const ai_providers_module_1 = require("../ai-providers/ai-providers.module");
const users_module_1 = require("../users/users.module");
const billing_module_1 = require("../billing/billing.module");
let GenerationModule = class GenerationModule {
};
exports.GenerationModule = GenerationModule;
exports.GenerationModule = GenerationModule = __decorate([
    (0, common_1.Module)({
        imports: [
            mongoose_1.MongooseModule.forFeature([
                { name: generation_schema_1.Generation.name, schema: generation_schema_1.GenerationSchema },
            ]),
            bull_1.BullModule.registerQueue({
                name: 'generation',
                defaultJobOptions: {
                    removeOnComplete: 50,
                    removeOnFail: 20,
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 3000 },
                },
            }),
            jwt_1.JwtModule.registerAsync({
                imports: [config_1.ConfigModule],
                inject: [config_1.ConfigService],
                useFactory: (config) => ({
                    secret: config.get('JWT_SECRET'),
                }),
            }),
            (0, common_1.forwardRef)(() => ai_providers_module_1.AiProvidersModule),
            (0, common_1.forwardRef)(() => users_module_1.UsersModule),
            (0, common_1.forwardRef)(() => billing_module_1.BillingModule),
        ],
        controllers: [generation_controller_1.GenerationController],
        providers: [generation_service_1.GenerationService, generation_gateway_1.GenerationGateway, generation_consumer_1.GenerationConsumer],
        exports: [generation_service_1.GenerationService, generation_gateway_1.GenerationGateway],
    })
], GenerationModule);
//# sourceMappingURL=generation.module.js.map