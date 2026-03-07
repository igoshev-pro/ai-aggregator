export declare class TelegramAuthDto {
    initData: string;
    referralCode?: string;
}
export declare class AuthResponseDto {
    accessToken: string;
    user: {
        id: string;
        telegramId: number;
        firstName: string;
        username: string;
        tokenBalance: number;
        bonusTokens: number;
        role: string;
        subscriptionPlan: string;
    };
}
