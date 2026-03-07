declare const _default: () => {
    port: number;
    nodeEnv: string;
    mongo: {
        uri: string;
    };
    redis: {
        host: string;
        port: number;
        password: string;
    };
    jwt: {
        secret: string;
        expiration: string;
    };
    telegram: {
        botToken: string;
        botUsername: string;
    };
    providers: {
        openrouter: {
            apiKey: string;
            baseUrl: string;
        };
        evolink: {
            apiKey: string;
            baseUrl: string;
        };
        kie: {
            apiKey: string;
            baseUrl: string;
        };
        replicate: {
            apiKey: string;
        };
    };
    payment: {
        yookassa: {
            shopId: string;
            secretKey: string;
            webhookSecret: string;
        };
        cryptomus: {
            merchantId: string;
            apiKey: string;
        };
    };
    s3: {
        endpoint: string;
        bucket: string;
        accessKey: string;
        secretKey: string;
        region: string;
    };
    defaultPricing: {
        text: {
            'gpt-4o': number;
            'gpt-4o-mini': number;
            'claude-3.5-sonnet': number;
            'claude-3-haiku': number;
            'gemini-2.0-flash': number;
            'gemini-1.5-pro': number;
            'deepseek-v3': number;
            'deepseek-r1': number;
            'grok-3': number;
            'perplexity-sonar': number;
            'qwen-2.5-72b': number;
        };
        image: {
            midjourney: number;
            'dall-e-3': number;
            'flux-pro': number;
            'stable-diffusion-xl': number;
            seedream: number;
            'imagen-3': number;
            'chatgpt-images': number;
            'nano-banana': number;
        };
        video: {
            sora: number;
            'kling-1.6': number;
            'runway-gen3': number;
            'veo-2': number;
            hailuo: number;
            'luma-ray2': number;
            'pika-2.0': number;
        };
        audio: {
            'suno-v4': number;
            elevenlabs: number;
        };
    };
};
export default _default;
