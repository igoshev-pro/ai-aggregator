# 1. Клонировать/создать проект
mkdir ai-aggregator-backend && cd ai-aggregator-backend

# 2. Скопировать .env.example → .env и заполнить ключи
cp .env.example .env

# 3. Запустить инфраструктуру
docker-compose up -d mongodb redis

# 4. Установить зависимости
npm install

# 5. Запустить в dev-режиме
npm run start:dev

# 6. Swagger docs будет на
# http://localhost:3001/docs