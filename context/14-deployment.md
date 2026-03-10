<!-- context/14-deployment.md -->
# 🚀 Deployment — Детальный контекст

## Назначение
Инфраструктура, Docker, CI/CD, мониторинг, масштабирование.

## Docker Compose — Локальная разработка

### Сервисы
```yaml
services:
  app:          # NestJS приложение (port 3001)
  mongodb:      # MongoDB 7 (port 27017)
  redis:        # Redis 7 Alpine (port 6379)
  mongo-express: # MongoDB GUI (port 8081)
Volumes


mongo_data    — персистентное хранилище MongoDB
redis_data    — персистентное хранилище Redis
Запуск

Bash

# Полный стек
docker-compose up -d

# Только инфра (для локальной разработки NestJS)
docker-compose up -d mongodb redis

# Логи
docker-compose logs -f app
Dockerfile


Stage 1: Builder
  - node:20-alpine
  - npm ci + npm run build

Stage 2: Production
  - node:20-alpine
  - non-root user (nodejs:nestjs)
  - copy dist + node_modules
  - HEALTHCHECK: wget http://localhost:3001/api/v1/health
  - CMD: node dist/main
Production Deployment

Рекомендуемый стек


┌─────────────────────────────────────────────┐
│              Nginx / Traefik                │
│         (reverse proxy + SSL)               │
├─────────────────────────────────────────────┤
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ App #1   │  │ App #2   │  │ App #3   │ │
│  │ :3001    │  │ :3002    │  │ :3003    │ │
│  └──────────┘  └──────────┘  └──────────┘ │
│                                             │
├─────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────────┐    │
│  │ MongoDB      │  │ Redis            │    │
│  │ Replica Set  │  │ Sentinel/Cluster │    │
│  └──────────────┘  └──────────────────┘    │
└─────────────────────────────────────────────┘
Nginx конфигурация (пример)

Nginx

upstream api_backend {
    least_conn;
    server app1:3001;
    server app2:3002;
    server app3:3003;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/ssl/cert.pem;
    ssl_certificate_key /etc/ssl/key.pem;

    # API
    location /api/ {
        proxy_pass http://api_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SSE (chat streaming)
    location /api/v1/chat/stream {
        proxy_pass http://api_backend;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding off;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }

    # WebSocket
    location /generation {
        proxy_pass http://api_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
    }

    # Swagger docs (dev only)
    location /docs {
        proxy_pass http://api_backend;
    }
}
Env Variables — Production

Bash

# Обязательные
NODE_ENV=production
PORT=3001
MONGO_URI=mongodb://user:pass@mongo1:27017,mongo2:27017/ai-aggregator?replicaSet=rs0
REDIS_HOST=redis-sentinel
REDIS_PORT=26379
REDIS_PASSWORD=strong_password
JWT_SECRET=crypto-random-64-chars-minimum
TELEGRAM_BOT_TOKEN=actual-bot-token

# AI Providers (хотя бы один)
OPENROUTER_API_KEY=sk-or-xxx

# Payments (хотя бы один)
YOOKASSA_SHOP_ID=xxx
YOOKASSA_SECRET_KEY=xxx

# CORS
CORS_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
Health Check

Endpoint


GET /api/v1/health

Response:
{
  "status": "ok",
  "timestamp": "2025-01-15T10:00:00Z",
  "uptime": 86400,
  "mongo": "connected",
  "memory": {
    "rss": "145 MB",
    "heap": "98 MB"
  }
}
Docker HEALTHCHECK

Dockerfile

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/v1/health || exit 1
Мониторинг

Рекомендуемые инструменты

Инструмент	Назначение
PM2	Process manager (если без Docker)
Grafana + Prometheus	Метрики и дашборды
Loki	Логи
Sentry	Error tracking
UptimeRobot / Betterstack	Uptime monitoring
Mongo Atlas	MongoDB monitoring (если Atlas)
Ключевые метрики для мониторинга


- Response time (p50, p95, p99)
- Error rate (5xx / total)
- Active connections (HTTP + WebSocket)
- Queue depth (Bull)
- Queue processing time
- MongoDB connection pool usage
- Redis memory usage
- Provider health status
- Token deduction failures
- Payment webhook processing time
Масштабирование

Горизонтальное


Проблема: WebSocket — stateful
Решение: Redis Adapter для Socket.IO

npm install @socket.io/redis-adapter

// В GenerationGateway:
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const pubClient = createClient({ url: REDIS_URL });
const subClient = pubClient.duplicate();
server.adapter(createAdapter(pubClient, subClient));
Bull Queue при нескольких инстансах

Bull по умолчанию работает через Redis → автоматически распределяет задачи между worker-ами на разных инстансах. Никакой дополнительной настройки не нужно.

MongoDB Replica Set


Для production обязательно:
- Минимум 3 ноды (primary + secondary + arbiter)
- Read preference: secondaryPreferred для аналитики
- Write concern: majority для финансовых операций
CI/CD Pipeline (пример GitHub Actions)

Yaml

name: Deploy

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run lint
      - run: npm run test

  build-and-deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build Docker image
        run: docker build -t ai-aggregator:${{ github.sha }} .
      - name: Push to registry
        run: |
          docker tag ai-aggregator:${{ github.sha }} registry.example.com/ai-aggregator:latest
          docker push registry.example.com/ai-aggregator:latest
      - name: Deploy
        run: |
          ssh deploy@server "cd /app && docker-compose pull && docker-compose up -d"
Backup Strategy


MongoDB:
  - mongodump каждые 6 часов
  - Retention: 30 дней
  - Хранение: S3 / Object Storage

Redis:
  - RDB snapshots каждый час
  - AOF для point-in-time recovery

.env файлы:
  - Зашифрованные в отдельном репозитории
  - Или через Secrets Manager
Порядок первого деплоя

Bash

# 1. Подготовить сервер
ssh root@server
apt update && apt install docker.io docker-compose-plugin

# 2. Создать директорию
mkdir -p /app && cd /app

# 3. Скопировать файлы
scp docker-compose.yml Dockerfile .env.production server:/app/

# 4. Переименовать env
mv .env.production .env

# 5. Запустить
docker-compose up -d

# 6. Проверить
curl http://localhost:3001/api/v1/health

# 7. Настроить Nginx + SSL (certbot)
apt install nginx certbot python3-certbot-nginx
# ... настроить конфиг ...
certbot --nginx -d api.yourdomain.com

# 8. Назначить первого super_admin
# Подключиться к MongoDB и вручную:
db.users.updateOne(
  { telegramId: YOUR_TELEGRAM_ID },
  { $set: { role: 'super_admin' } }
)
TODO

 GitHub Actions CI/CD pipeline
 Sentry integration для error tracking
 Prometheus metrics endpoint /metrics
 Grafana dashboards
 Automated database backups
 Blue-green deployment strategy
 Auto-scaling rules
 CDN для медиа-файлов (S3 + CloudFront)
 Database migration system
 Smoke tests after deploy