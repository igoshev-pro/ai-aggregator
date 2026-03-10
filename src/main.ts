import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import helmet from 'helmet';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3001);
  const apiPrefix = configService.get<string>('API_PREFIX', 'api/v1');

  // Security
  app.use(helmet());

  // CORS
  const corsOrigins = configService.get<string>('CORS_ORIGINS', '').split(',');
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Telegram-Init-Data'],
  });

  // Global prefix
  app.setGlobalPrefix(apiPrefix);

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global filters & interceptors
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // WebSocket adapter
  app.useWebSocketAdapter(new IoAdapter(app));

  // Swagger
  if (configService.get('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('AI Aggregator API')
      .setDescription('Backend API for AI Aggregator Mini App')
      .setVersion('1.0')
      .addBearerAuth()
      .addApiKey(
        { type: 'apiKey', name: 'X-Telegram-Init-Data', in: 'header' },
        'telegram-auth',
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(port);
  console.log(`🚀 Server running on http://localhost:${port}`);
  console.log(`📚 Swagger docs: http://localhost:${port}/docs`);
}

bootstrap();