"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingModule = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const billing_controller_1 = require("./billing.controller");
const billing_service_1 = require("./billing.service");
const transaction_schema_1 = require("./schemas/transaction.schema");
const subscription_schema_1 = require("./schemas/subscription.schema");
const promo_code_schema_1 = require("./schemas/promo-code.schema");
const yookassa_provider_1 = require("./providers/yookassa.provider");
const cryptomus_provider_1 = require("./providers/cryptomus.provider");
const stars_provider_1 = require("./providers/stars.provider");
const users_module_1 = require("../users/users.module");
let BillingModule = class BillingModule {
};
exports.BillingModule = BillingModule;
exports.BillingModule = BillingModule = __decorate([
    (0, common_1.Module)({
        imports: [
            mongoose_1.MongooseModule.forFeature([
                { name: transaction_schema_1.Transaction.name, schema: transaction_schema_1.TransactionSchema },
                { name: subscription_schema_1.Subscription.name, schema: subscription_schema_1.SubscriptionSchema },
                { name: promo_code_schema_1.PromoCode.name, schema: promo_code_schema_1.PromoCodeSchema },
            ]),
            (0, common_1.forwardRef)(() => users_module_1.UsersModule),
        ],
        controllers: [billing_controller_1.BillingController],
        providers: [
            billing_service_1.BillingService,
            yookassa_provider_1.YookassaProvider,
            cryptomus_provider_1.CryptomusProvider,
            stars_provider_1.StarsProvider,
        ],
        exports: [billing_service_1.BillingService],
    })
], BillingModule);
//# sourceMappingURL=billing.module.js.map