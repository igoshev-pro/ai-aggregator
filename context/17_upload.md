📦 Контекст: Backend (NestJS) — Блок 14: Upload Module

🗂️ Структура модуля


src/modules/upload/
├── upload.module.ts
└── upload.controller.ts

// Отдельный модуль, отличный от StorageModule/UploadController (Блок 11)
// Блок 11: src/modules/storage/upload.controller.ts
// Блок 14: src/modules/upload/upload.controller.ts
// ⚠️ Два контроллера на @Controller('upload') существуют параллельно
🔗 Зависимости модуля

Typescript

UploadModule imports:
  StorageModule   // реэкспортирует StorageService

UploadController injects:
  StorageService  // используется напрямую (uploadBuffer, deleteFile)
📡 API Эндпоинты


POST /upload/audio    загрузить аудиофайл → S3    [JWT, multipart/form-data]
POST /upload/image    загрузить изображение → S3  [JWT, multipart/form-data]

// Оба эндпоинта:
//   - Guards: JwtAuthGuard (на уровне контроллера)
//   - Storage: memoryStorage (буфер в RAM)
//   - fileSize limit: 10MB
//   - Auto-delete: setTimeout 1 час после загрузки
🎵 POST /upload/audio

Typescript

// Разрешённые MIME:
ALLOWED_AUDIO_MIMES = [
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave',
  'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/mp4',
  'audio/aac', 'audio/flac', 'audio/x-m4a', 'audio/m4a',
]

// key: `uploads/audio/${userId}/${uuid}.${ext}`
// Ответ: { success, data: { url, key, size, mimetype, originalName } }
// Логирование: upload начало + URL после загрузки
// scheduleDelete(key, 60 * 60 * 1000)  // 1 час
🖼️ POST /upload/image

Typescript

// Разрешённые MIME:
ALLOWED_IMAGE_MIMES = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
]

// key: `uploads/image/${userId}/${uuid}.${ext}`
// Ответ: { success, data: { url, key, size, mimetype } }
// ⚠️ originalName НЕ возвращается (в отличие от /audio)
// scheduleDelete(key, 60 * 60 * 1000)  // 1 час
🔑 Получение userId

Typescript

const userId = req.user?.id || req.user?._id || 'anonymous';

// ⚠️ Фолбэк 'anonymous' при наличии JwtAuthGuard невозможен в норме —
//    guard не пропустит запрос без валидного JWT
//    Но при отключённом guard или ошибке декодирования:
//    key = `uploads/audio/anonymous/${uuid}.mp3`
//    Все "анонимные" файлы в одной папке — трудно найти владельца
// ⚠️ req.user?.id — зависит от формата JWT payload.
//    Если JWT payload содержит 'sub' (стандарт), то нужно req.user?.sub
//    Аналогично Блоку 11 (storage/upload.controller.ts)
//    Нет использования @CurrentUser() декоратора (как в других контроллерах)
🗂️ getExtension()

Typescript

private getExtension(mimetype: string, originalName?: string): string

// Порядок поиска:
// 1. MIME → расширение из map (22 записи: аудио + изображения)
// 2. Fallback: расширение из originalName (parts.pop().toLowerCase())
// 3. Финальный fallback: 'bin'

// ✅ Дублирует логику StorageService.getExtension(), но расширена:
//    - Больше аудио форматов (flac, aac, m4a, wave, x-wav)
//    - Fallback из оригинального имени файла

// ⚠️ Fallback из originalName небезопасен:
//    Пользователь может загрузить файл с именем 'malware.php'
//    → ext = 'php', key = 'uploads/audio/userId/uuid.php'
//    S3 отдаёт файл как есть, но при ACL public-read
//    имя файла с .php не исполняется S3, риск минимален
//    Тем не менее нужна whitelist проверка расширения из originalName:
//    if (!ALLOWED_EXTENSIONS.includes(ext)) return 'bin'

// ⚠️ mimetype с параметрами ('audio/mpeg; codecs=mp3') → map miss → fallback
//    Аналогично проблеме в StorageService (Блок 11, п.5)
⏰ scheduleDelete()

Typescript

private scheduleDelete(key: string, delayMs: number) {
  setTimeout(async () => {
    await this.storage.deleteFile(key);
  }, delayMs);
}

// Удаляет временные файлы через 1 час после загрузки
// deleteFile ошибки логируются, не бросаются
🔄 Связь с Блоком 11 (storage/upload.controller.ts)

Typescript

// Блок 11 (StorageModule/UploadController):
//   @Controller('upload')
//   POST /upload/image  — только изображения, без auto-delete
//   GET  /upload/download — прокси скачивание
//   Создаёт собственный S3Client (дублирование)
//   Нет JwtAuthGuard на уровне контроллера (только на методе image)

// Блок 14 (UploadModule/UploadController):
//   @Controller('upload')
//   POST /upload/audio  — аудио с auto-delete
//   POST /upload/image  — изображения с auto-delete
//   Использует StorageService (правильно)
//   JwtAuthGuard на уровне контроллера

// ⚠️ КОНФЛИКТ МАРШРУТОВ: оба контроллера регистрируют POST /upload/image
//    NestJS зарегистрирует оба обработчика, сработает первый по порядку
//    загрузки модулей — поведение непредсказуемо и зависит от порядка
//    импорта в AppModule
// ⚠️ GET /upload/download из Блока 11 недоступен если UploadModule
//    перекрывает StorageModule маршруты
⚠️ Замеченные проблемы

🔴 Критичные

Конфликт маршрутов с Блоком 11 — два контроллера с @Controller('upload') регистрируют POST /upload/image. NestJS применит первый совпавший обработчик по порядку импорта модулей в AppModule. Один из обработчиков никогда не будет вызван. Нужно либо объединить в один контроллер, либо разделить пути (/upload/v2/image).

scheduleDelete на основе setTimeout в NestJS — setTimeout держит замыкание на key и экземпляр StorageService. При перезапуске приложения (deploy, crash) все запланированные удаления теряются. Файлы, загруженные до рестарта, останутся в S3 навсегда. Нужна персистентная очередь (Bull/BullMQ job) или S3 Lifecycle Policy на папку uploads/.

Все загружаемые файлы хранятся в RAM (memoryStorage) — при 100 одновременных загрузках по 10MB = 1GB RAM. Нет явного указания storage: memoryStorage() в FileInterceptor (используется дефолт multer, который тоже memoryStorage), но лимит fileSize: 10MB только на файл, не на суммарную нагрузку. Нужен diskStorage или потоковая загрузка в S3.

🟡 Средние

userId через req.user?.id || req.user?._id — нет использования @CurrentUser() декоратора (используется во всех других контроллерах проекта). JWT payload содержит sub, не id. req.user?.id вернёт undefined, req.user?._id тоже undefined — итог userId = 'anonymous' даже для авторизованных пользователей в зависимости от формата JWT. Нужно @CurrentUser('sub') userId: string как в остальных контроллерах.

Fallback расширения из originalName без whitelist — getExtension('unknown/type', 'file.php') вернёт 'php'. Файл загрузится в S3 с расширением .php. При наличии public-read ACL и некорректной конфигурации CDN — потенциальный вектор. Нужна проверка: расширение из originalName принимается только если оно входит в whitelist допустимых расширений.

Несоответствие ответов audio и image — uploadAudio возвращает originalName, uploadImage — нет. Непоследовательный API-контракт. Фронтенд должен знать об этом различии.

Логирование originalname из пользовательского ввода — this.logger.log(Audio upload: ${file.originalname}...) — file.originalname может содержать спецсимволы, escape-последовательности, Unicode. В зависимости от системы логирования — возможен log injection. Нужна санитизация перед логированием.

🟢 Минорные

Дублирование getExtension — метод дублирует StorageService.getExtension() с расширениями. При добавлении нового формата нужно обновлять оба места. Нужно вынести в общий хелпер или расширить метод StorageService.

MAX_SIZE = 10MB для аудио — 10MB для аудио очень мало. MP3 в качестве 128kbps = ~1MB/мин → максимум ~10 минут. Для Whisper транскрипции это ограничивает длинные записи. Для аудио имеет смысл отдельный лимит (25-50MB).

@Req() req: any — потеря типизации. Нужно @Req() req: Request из @nestjs/common с расширенным типом для user.

UploadModule не экспортирует ничего — контроллер регистрируется, но если другие модули хотят использовать логику загрузки — должны импортировать StorageModule напрямую. Это нормально для контроллер-модуля, но стоит зафиксировать явно.

