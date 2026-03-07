backend/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   │   ├── configuration.ts
│   │   └── validation.schema.ts
│   ├── common/
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts
│   │   │   ├── roles.decorator.ts
│   │   │   └── throttle.decorator.ts
│   │   ├── guards/
│   │   │   ├── telegram-auth.guard.ts
│   │   │   ├── jwt-auth.guard.ts
│   │   │   └── roles.guard.ts
│   │   ├── interceptors/
│   │   │   ├── logging.interceptor.ts
│   │   │   └── timeout.interceptor.ts
│   │   ├── filters/
│   │   │   └── global-exception.filter.ts
│   │   ├── pipes/
│   │   │   └── validation.pipe.ts
│   │   ├── middleware/
│   │   │   └── rate-limit.middleware.ts
│   │   └── interfaces/
│   │       └── index.ts
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── strategies/
│   │   │   │   ├── jwt.strategy.ts
│   │   │   │   └── telegram.strategy.ts
│   │   │   └── dto/
│   │   │       ├── telegram-auth.dto.ts
│   │   │       └── auth-response.dto.ts
│   │   ├── users/
│   │   │   ├── users.module.ts
│   │   │   ├── users.controller.ts
│   │   │   ├── users.service.ts
│   │   │   ├── schemas/
│   │   │   │   └── user.schema.ts
│   │   │   └── dto/
│   │   │       └── update-user.dto.ts
│   │   ├── billing/
│   │   │   ├── billing.module.ts
│   │   │   ├── billing.controller.ts
│   │   │   ├── billing.service.ts
│   │   │   ├── schemas/
│   │   │   │   ├── transaction.schema.ts
│   │   │   │   ├── subscription.schema.ts
│   │   │   │   └── promo-code.schema.ts
│   │   │   ├── dto/
│   │   │   │   ├── create-payment.dto.ts
│   │   │   │   ├── apply-promo.dto.ts
│   │   │   │   └── token-package.dto.ts
│   │   │   └── providers/
│   │   │       ├── payment-provider.interface.ts
│   │   │       ├── yookassa.provider.ts
│   │   │       ├── cryptomus.provider.ts
│   │   │       └── stars.provider.ts
│   │   ├── ai-providers/
│   │   │   ├── ai-providers.module.ts
│   │   │   ├── ai-providers.service.ts
│   │   │   ├── ai-providers.controller.ts
│   │   │   ├── schemas/
│   │   │   │   ├── provider.schema.ts
│   │   │   │   └── model.schema.ts
│   │   │   ├── providers/
│   │   │   │   ├── base-provider.abstract.ts
│   │   │   │   ├── openrouter.provider.ts
│   │   │   │   ├── evolink.provider.ts
│   │   │   │   ├── kie.provider.ts
│   │   │   │   ├── replicate.provider.ts
│   │   │   │   └── provider-registry.service.ts
│   │   │   └── dto/
│   │   │       └── provider-config.dto.ts
│   │   ├── generation/
│   │   │   ├── generation.module.ts
│   │   │   ├── generation.controller.ts
│   │   │   ├── generation.service.ts
│   │   │   ├── generation.gateway.ts          # WebSocket
│   │   │   ├── schemas/
│   │   │   │   └── generation.schema.ts
│   │   │   ├── processors/
│   │   │   │   ├── text.processor.ts
│   │   │   │   ├── image.processor.ts
│   │   │   │   ├── video.processor.ts
│   │   │   │   └── audio.processor.ts
│   │   │   ├── queues/
│   │   │   │   ├── generation.queue.ts
│   │   │   │   └── generation.consumer.ts
│   │   │   └── dto/
│   │   │       ├── text-generation.dto.ts
│   │   │       ├── image-generation.dto.ts
│   │   │       ├── video-generation.dto.ts
│   │   │       └── audio-generation.dto.ts
│   │   ├── chat/
│   │   │   ├── chat.module.ts
│   │   │   ├── chat.controller.ts
│   │   │   ├── chat.service.ts
│   │   │   └── schemas/
│   │   │       ├── conversation.schema.ts
│   │   │       └── message.schema.ts
│   │   ├── favorites/
│   │   │   ├── favorites.module.ts
│   │   │   ├── favorites.controller.ts
│   │   │   ├── favorites.service.ts
│   │   │   └── schemas/
│   │   │       └── favorite.schema.ts
│   │   ├── admin/
│   │   │   ├── admin.module.ts
│   │   │   ├── admin.controller.ts
│   │   │   ├── admin.service.ts
│   │   │   └── dto/
│   │   │       ├── update-provider.dto.ts
│   │   │       ├── update-tariff.dto.ts
│   │   │       └── analytics-query.dto.ts
│   │   ├── referral/
│   │   │   ├── referral.module.ts
│   │   │   ├── referral.controller.ts
│   │   │   ├── referral.service.ts
│   │   │   └── schemas/
│   │   │       └── referral.schema.ts
│   │   ├── support/
│   │   │   ├── support.module.ts
│   │   │   ├── support.controller.ts
│   │   │   ├── support.service.ts
│   │   │   └── schemas/
│   │   │       └── ticket.schema.ts
│   │   └── analytics/
│   │       ├── analytics.module.ts
│   │       ├── analytics.service.ts
│   │       └── schemas/
│   │           └── analytics-event.schema.ts
├── .env.example
├── package.json
├── tsconfig.json
├── nest-cli.json
└── docker-compose.yml