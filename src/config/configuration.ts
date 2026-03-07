// src/config/configuration.ts
export default () => ({
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/ai-aggregator',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || '',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    expiration: process.env.JWT_EXPIRATION || '7d',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    botUsername: process.env.TELEGRAM_BOT_USERNAME || '',
  },

  providers: {
    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY || '',
      baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    },
    evolink: {
      apiKey: process.env.EVOLINK_API_KEY || '',
      baseUrl: process.env.EVOLINK_BASE_URL || '',
    },
    kie: {
      apiKey: process.env.KIE_API_KEY || '',
      baseUrl: process.env.KIE_BASE_URL || '',
    },
    replicate: {
      apiKey: process.env.REPLICATE_API_KEY || '',
    },
  },

  payment: {
    yookassa: {
      shopId: process.env.YOOKASSA_SHOP_ID || '',
      secretKey: process.env.YOOKASSA_SECRET_KEY || '',
      webhookSecret: process.env.YOOKASSA_WEBHOOK_SECRET || '',
    },
    cryptomus: {
      merchantId: process.env.CRYPTOMUS_MERCHANT_ID || '',
      apiKey: process.env.CRYPTOMUS_API_KEY || '',
    },
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT || '',
    bucket: process.env.S3_BUCKET || '',
    accessKey: process.env.S3_ACCESS_KEY || '',
    secretKey: process.env.S3_SECRET_KEY || '',
    region: process.env.S3_REGION || '',
  },

  defaultPricing: {
    text: {
      'gpt-4o': 3,
      'gpt-4o-mini': 1,
      'claude-3.5-sonnet': 3,
      'claude-3-haiku': 1,
      'gemini-2.0-flash': 1,
      'gemini-1.5-pro': 3,
      'deepseek-v3': 1,
      'deepseek-r1': 2,
      'grok-3': 3,
      'perplexity-sonar': 2,
      'qwen-2.5-72b': 2,
    },
    image: {
      'midjourney': 10,
      'dall-e-3': 5,
      'flux-pro': 5,
      'stable-diffusion-xl': 3,
      'seedream': 5,
      'imagen-3': 5,
      'chatgpt-images': 5,
      'nano-banana': 5,
    },
    video: {
      'sora': 30,
      'kling-1.6': 20,
      'runway-gen3': 25,
      'veo-2': 25,
      'hailuo': 15,
      'luma-ray2': 20,
      'pika-2.0': 15,
    },
    audio: {
      'suno-v4': 10,
      'elevenlabs': 5,
    },
  },
});