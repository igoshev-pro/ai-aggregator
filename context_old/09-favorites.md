<!-- context/09-favorites.md -->
# ⭐ Favorites Module — Детальный контекст

## Назначение
Универсальная система избранного. Пользователь может добавлять в избранное генерации, чаты, модели.

## Файлы модуля
src/modules/favorites/
├── favorites.module.ts
├── favorites.controller.ts
├── favorites.service.ts
└── schemas/
└── favorite.schema.ts



## Favorite Schema
```typescript
{
  userId: ObjectId;
  type: string;        // 'generation' | 'conversation' | 'model'
  itemId: string;      // ID элемента
  title: string;       // Для отображения
  previewUrl: string;  // Превью (URL изображения)
  metadata: {};        // Доп. данные
}

// Unique compound index: { userId, type, itemId }
Логика Toggle

Если уже в избранном → удалить → return { isFavorite: false }
Если нет → добавить → return { isFavorite: true }
Дополнительно

В GenerationModule есть собственное поле isFavorite на схеме Generation для быстрого доступа. Модуль Favorites — это универсальная система для любых типов контента.

API Endpoints

Method	Path	Auth	Description
POST	/favorites/toggle	✅	Toggle избранное
GET	/favorites	✅	Список (?type=generation)