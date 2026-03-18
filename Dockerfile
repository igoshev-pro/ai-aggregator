# Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Копируем package files
COPY package*.json ./

# Устанавливаем зависимости
RUN pnpm ci

# Копируем исходники
COPY . .

# Собираем
RUN pnpm run build

# ─── Production Stage ────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Безопасность: non-root пользователь
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Копируем только то что нужно
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Переключаемся на non-root
USER nestjs

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=15s \
  CMD wget -qO- http://localhost:3001/api/v1/health || exit 1

CMD ["node", "dist/main"]