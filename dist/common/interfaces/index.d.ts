export interface TelegramUser {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    photo_url?: string;
    is_premium?: boolean;
}
export interface JwtPayload {
    sub: string;
    telegramId: number;
    role: UserRole;
}
export declare enum UserRole {
    USER = "user",
    PREMIUM = "premium",
    ADMIN = "admin",
    SUPER_ADMIN = "super_admin"
}
export declare enum GenerationType {
    TEXT = "text",
    IMAGE = "image",
    VIDEO = "video",
    AUDIO = "audio"
}
export declare enum GenerationStatus {
    PENDING = "pending",
    PROCESSING = "processing",
    COMPLETED = "completed",
    FAILED = "failed",
    CANCELLED = "cancelled"
}
export declare enum TransactionType {
    DEPOSIT = "deposit",
    WITHDRAWAL = "withdrawal",
    GENERATION = "generation",
    REFUND = "refund",
    REFERRAL_BONUS = "referral_bonus",
    PROMO_CODE = "promo_code",
    SUBSCRIPTION = "subscription",
    ADMIN_ADJUSTMENT = "admin_adjustment"
}
export declare enum PaymentStatus {
    PENDING = "pending",
    COMPLETED = "completed",
    FAILED = "failed",
    REFUNDED = "refunded"
}
export declare enum SubscriptionPlan {
    FREE = "free",
    BASIC = "basic",
    PRO = "pro",
    UNLIMITED = "unlimited"
}
