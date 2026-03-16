// src/scripts/migrate-token-system.ts

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { Logger } from '@nestjs/common';

async function migrate() {
  const logger = new Logger('Migration');
  
  try {
    logger.log('Starting token system migration...');
    
    const app = await NestFactory.createApplicationContext(AppModule);
    
    // Получаем модели из DI
    const mongoose = app.get('DatabaseConnection');
    const modelModel = mongoose.model('AIModel');
    const generationModel = mongoose.model('Generation');
    const messageModel = mongoose.model('Message');
    const transactionModel = mongoose.model('Transaction');
    
    // 1. Обновляем модели - добавляем новые поля если их нет
    logger.log('Updating AI models...');
    const models = await modelModel.find({});
    
    for (const model of models) {
      let needsUpdate = false;
      
      // Проверяем и добавляем новые поля
      if (model.costPerMillionInputTokens === undefined) {
        needsUpdate = true;
        
        if (model.type === 'text') {
          // Для текстовых моделей примерно рассчитываем на основе старого tokenCost
          model.costPerMillionInputTokens = model.tokenCost ? model.tokenCost * 0.5 : 1;
          model.costPerMillionOutputTokens = model.tokenCost ? model.tokenCost * 2 : 5;
        } else {
          // Для медиа моделей ставим 0 так как у них фиксированная стоимость
          model.costPerMillionInputTokens = 0;
          model.costPerMillionOutputTokens = 0;
        }
      }
      
      if (model.fixedCostPerGeneration === undefined) {
        needsUpdate = true;
        
        if (model.type !== 'text') {
          // Для медиа моделей конвертируем tokenCost в доллары
          model.fixedCostPerGeneration = model.tokenCost ? model.tokenCost * 0.01 : 0.05;
        } else {
          model.fixedCostPerGeneration = 0;
        }
      }
      
      if (model.tokensPerDollar === undefined) {
        needsUpdate = true;
        model.tokensPerDollar = model.type === 'text' ? 1000 : 100;
      }
      
      if (model.minTokenCost === undefined) {
        needsUpdate = true;
        model.minTokenCost = Math.max(1, Math.floor((model.tokenCost || 1) * 0.5));
      }
      
      if (needsUpdate) {
        await model.save();
        logger.log(`Updated model: ${model.slug}`);
      }
    }
    
    // 2. Обновляем генерации - добавляем новые поля
    logger.log('Updating generations...');
    await generationModel.updateMany(
      { inputTokens: { $exists: false } },
      { 
        $set: { 
          inputTokens: 0,
          outputTokens: 0,
          totalProviderTokens: 0,
          costInDollars: 0,
        }
      }
    );
    
    // 3. Обновляем сообщения - добавляем новые поля
    logger.log('Updating messages...');
    await messageModel.updateMany(
      { inputTokens: { $exists: false } },
      { 
        $set: { 
          inputTokens: 0,
          outputTokens: 0,
        }
      }
    );
    
    // 4. Обновляем транзакции - добавляем новые поля
    logger.log('Updating transactions...');
    await transactionModel.updateMany(
      { costInDollars: { $exists: false } },
      { 
        $set: { 
          inputTokens: 0,
          outputTokens: 0,
          costInDollars: 0,
          costInTokens: 0,
        }
      }
    );
    
    logger.log('✅ Migration completed successfully!');
    
    await app.close();
  } catch (error) {
    logger.error(`❌ Migration failed: ${error.message}`);
    process.exit(1);
  }
}

migrate();