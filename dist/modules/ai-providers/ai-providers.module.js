"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiProvidersModule = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const ai_providers_controller_1 = require("./ai-providers.controller");
const ai_providers_service_1 = require("./ai-providers.service");
const provider_registry_service_1 = require("./providers/provider-registry.service");
const model_schema_1 = require("./schemas/model.schema");
const provider_schema_1 = require("./schemas/provider.schema");
let AiProvidersModule = class AiProvidersModule {
};
exports.AiProvidersModule = AiProvidersModule;
exports.AiProvidersModule = AiProvidersModule = __decorate([
    (0, common_1.Module)({
        imports: [
            mongoose_1.MongooseModule.forFeature([
                { name: model_schema_1.AIModel.name, schema: model_schema_1.AIModelSchema },
                { name: provider_schema_1.Provider.name, schema: provider_schema_1.ProviderSchema },
            ]),
        ],
        controllers: [ai_providers_controller_1.AiProvidersController],
        providers: [ai_providers_service_1.AiProvidersService, provider_registry_service_1.ProviderRegistryService],
        exports: [ai_providers_service_1.AiProvidersService, provider_registry_service_1.ProviderRegistryService],
    })
], AiProvidersModule);
//# sourceMappingURL=ai-providers.module.js.map