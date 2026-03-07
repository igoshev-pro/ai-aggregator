"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionPlan = exports.PaymentStatus = exports.TransactionType = exports.GenerationStatus = exports.GenerationType = exports.UserRole = void 0;
var UserRole;
(function (UserRole) {
    UserRole["USER"] = "user";
    UserRole["PREMIUM"] = "premium";
    UserRole["ADMIN"] = "admin";
    UserRole["SUPER_ADMIN"] = "super_admin";
})(UserRole || (exports.UserRole = UserRole = {}));
var GenerationType;
(function (GenerationType) {
    GenerationType["TEXT"] = "text";
    GenerationType["IMAGE"] = "image";
    GenerationType["VIDEO"] = "video";
    GenerationType["AUDIO"] = "audio";
})(GenerationType || (exports.GenerationType = GenerationType = {}));
var GenerationStatus;
(function (GenerationStatus) {
    GenerationStatus["PENDING"] = "pending";
    GenerationStatus["PROCESSING"] = "processing";
    GenerationStatus["COMPLETED"] = "completed";
    GenerationStatus["FAILED"] = "failed";
    GenerationStatus["CANCELLED"] = "cancelled";
})(GenerationStatus || (exports.GenerationStatus = GenerationStatus = {}));
var TransactionType;
(function (TransactionType) {
    TransactionType["DEPOSIT"] = "deposit";
    TransactionType["WITHDRAWAL"] = "withdrawal";
    TransactionType["GENERATION"] = "generation";
    TransactionType["REFUND"] = "refund";
    TransactionType["REFERRAL_BONUS"] = "referral_bonus";
    TransactionType["PROMO_CODE"] = "promo_code";
    TransactionType["SUBSCRIPTION"] = "subscription";
    TransactionType["ADMIN_ADJUSTMENT"] = "admin_adjustment";
})(TransactionType || (exports.TransactionType = TransactionType = {}));
var PaymentStatus;
(function (PaymentStatus) {
    PaymentStatus["PENDING"] = "pending";
    PaymentStatus["COMPLETED"] = "completed";
    PaymentStatus["FAILED"] = "failed";
    PaymentStatus["REFUNDED"] = "refunded";
})(PaymentStatus || (exports.PaymentStatus = PaymentStatus = {}));
var SubscriptionPlan;
(function (SubscriptionPlan) {
    SubscriptionPlan["FREE"] = "free";
    SubscriptionPlan["BASIC"] = "basic";
    SubscriptionPlan["PRO"] = "pro";
    SubscriptionPlan["UNLIMITED"] = "unlimited";
})(SubscriptionPlan || (exports.SubscriptionPlan = SubscriptionPlan = {}));
//# sourceMappingURL=index.js.map