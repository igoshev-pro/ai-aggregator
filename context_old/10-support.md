<!-- context/10-support.md -->
# 🆘 Support Module — Детальный контекст

## Назначение
Тикет-система поддержки. Пользователи создают тикеты, саппорт отвечает.

## Файлы модуля
src/modules/support/
├── support.module.ts
├── support.controller.ts
├── support.service.ts
└── schemas/
└── ticket.schema.ts



## Ticket Schema
```typescript
{
  userId: ObjectId → User;
  subject: string;
  messages: [{
    role: 'user' | 'support';
    content: string;
    createdAt: Date;
  }];
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high';
  assignedTo: string;
  resolvedAt: Date;
}
Логика

При первом ответе саппорта: open → in_progress
Проверка доступа: пользователь видит только свои тикеты
Админ через SupportService.getAllTickets() видит все
API Endpoints

Method	Path	Auth	Description
POST	/support/tickets	✅	Создать тикет
GET	/support/tickets	✅	Мои тикеты
POST	/support/tickets/:id/message	✅	Ответить

## TODO
- [ ] Добавить эндпоинты для админа в AdminController (getAllTickets, reply, close, assign)
- [ ] Уведомления в TG при ответе саппорта (через Bot API sendMessage)
- [ ] Автозакрытие тикетов через 7 дней без активности (Cron job)
- [ ] Приоритизация тикетов от premium-пользователей
- [ ] Прикрепление файлов/скриншотов к сообщениям
- [ ] Шаблоны быстрых ответов для саппорта
- [ ] Метрики: среднее время ответа, количество открытых тикетов