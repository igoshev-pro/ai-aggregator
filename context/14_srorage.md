📦 Контекст: Backend (NestJS) — Блок 11: Storage Module

🗂️ Структура модуля


src/modules/storage/
├── storage.module.ts
├── storage.service.ts
└── upload.controller.ts
    (+ UploadResponseDto — объявлен дважды, не используется как класс)
🔗 Зависимости модуля

Typescript

StorageModule imports:
  ConfigModule

exports:
  StorageService

// UploadController инжектирует:
//   StorageService  — только для конструктора (не вызывается в методах)
//   ConfigService   — для инициализации S3Client

// ⚠️ StorageService инжектируется в UploadController,
//    но ни один его метод не вызывается в контроллере.
//    Контроллер создаёт собственный S3Client напрямую.
📡 API Эндпоинты


POST /upload/image      загрузить изображение в S3   [JWT, multipart/form-data]
GET  /upload/download   прокси-скачивание файла      [публичный, без JWT]
☁️ S3 конфигурация

Typescript

// StorageService:
S3_BUCKET      default: 'ai-generations'
S3_PUBLIC_URL  default: ''
S3_ENDPOINT    default: 'https://s3.timeweb.cloud'
S3_REGION      default: 'ru-1'
S3_ACCESS_KEY  required (default: '')
S3_SECRET_KEY  required (default: '')
forcePathStyle: true   // обязательно для Timeweb S3

// UploadController:
// Инициализирует ИДЕНТИЧНЫЙ S3Client с теми же env переменными
// — полное дублирование конфигурации
🗂️ StorageService — методы

downloadAndSave()

Typescript

async downloadAndSave(
  url: string,
  userId: string,
  type: 'image' | 'video' | 'audio' = 'image',
): Promise<{ s3Url: string; key: string; size: number }>

// Флоу:
// 1. url.startsWith('data:') → saveBase64()
// 2. axios.get(url, { responseType: 'arraybuffer', timeout: 60000 })
// 3. contentType из headers || 'image/png'
// 4. ext = getExtension(contentType)
// 5. key = `${type}s/${userId}/${uuid}.${ext}`
// 6. PutObjectCommand → S3
// 7. return { s3Url: publicUrl/key, key, size }

// При любой ошибке:
//   → logger.error
//   → return { s3Url: url, key: '', size: 0 }  ← оригинальный URL как fallback
//   ⚠️ Caller не может отличить успех от fallback (key: '' как сигнал)
//   ⚠️ Провайдерские URL имеют TTL — через 24-72ч fallback URL протухнет
saveBase64() — private

Typescript

// data:contentType;base64,data → S3
// key = `${type}s/${userId}/${uuid}.ext`
// ⚠️ type параметр: string (не 'image'|'video'|'audio')
//    При передаче произвольной строки — путь в S3 будет некорректным
//    Например: saveBase64(url, userId, 'documents') → key: 'documentss/userId/...'
//    (двойная 's' из `${type}s/`)
deleteFile()

Typescript

async deleteFile(key: string): Promise<void>
// Если key пустой → return (защита от удаления корня)
// При ошибке → logger.error, не бросает
// ⚠️ Нет проверки что key принадлежит этому bucket/userId
//    Можно удалить любой файл зная ключ
uploadBuffer()

Typescript

async uploadBuffer(buffer: Buffer, key: string, contentType: string): Promise<string>
// Прямой upload буфера с произвольным key
// return publicUrl/key
// ⚠️ key передаётся снаружи — вызывающий код полностью контролирует путь
// ⚠️ Нет валидации key (path traversal теоретически возможен)
getPublicUrl()

Typescript

getPublicUrl(key: string): string
// return `${this.publicUrl}/${key}`
// ⚠️ Если S3_PUBLIC_URL не задан (default: '') → URL будет '/key'
//    Все сохранённые файлы получат невалидные URL без домена
getExtension()

Typescript

// Маппинг contentType → расширение
// Поддерживаемые: png, jpg, webp, gif, mp4, webm, mp3, wav, ogg
// Неизвестный contentType → 'bin'
// ⚠️ 'audio/flac', 'video/quicktime', 'image/avif' → 'bin'
//    Файл сохранится с расширением .bin — не откроется в браузере
// ⚠️ contentType может содержать параметры: 'image/jpeg; charset=utf-8'
//    map['image/jpeg; charset=utf-8'] → undefined → 'bin'
//    Нужен split(';')[0].trim() перед lookup
📤 UploadController

POST /upload/image

Typescript

// Guards: JwtAuthGuard
// Multer: memoryStorage, fileSize limit: 10MB
// fileFilter: только image/jpeg, image/png, image/webp

// Флоу:
// 1. FileInterceptor сохраняет в memory
// 2. ext = mimetype.split('/')[1].replace('jpeg', 'jpg')
//    ⚠️ 'image/webp' → 'webp' ✓
//    ⚠️ 'image/jpeg' → 'jpg' ✓
//    ⚠️ 'image/png' → 'png' ✓
// 3. key = `uploads/${userId}/${uuid}.${ext}`
// 4. PutObjectCommand → собственный this.s3 (НЕ через StorageService)
// 5. url = `${this.publicUrl}/${key}`
// 6. return { success, data: { url, key, size, mimetype } }

// ⚠️ StorageService полностью игнорируется
// ⚠️ Нет обработки ошибок S3 — любой сбой даст 500 без описания
// ⚠️ Нет санитизации originalname — имя файла нигде не используется,
//    key строится из uuid, но originalname доступен если нужен
GET /upload/download

Typescript

// Guards: НЕТ — публичный эндпоинт
// Query: url (required), filename (optional)

// Флоу:
// 1. Проверка url на наличие
// 2. new URL(url).hostname — парсинг
// 3. Проверка hostname по allowlist:
//    ['replicate.delivery', 'replicate.com', 'pbxt.replicate',
//     'tjzk.replicate', 'oaidalleapiprodscus.blob', 'cdn.openai.com',
//     'storage.googleapis.com', 'r2.cloudflarestorage.com',
//     's3.timeweb.cloud', 'suno', 'kie', 'evolink']
// 4. safeName = filename.replace(/[^a-zA-Z0-9_.\-]/g, '_')
// 5. axios.get(url, { responseType: 'stream', timeout: 120000 })
// 6. pipe response.data → res

// ⚠️ Проверка через hostname.includes(d):
//    'suno', 'kie', 'evolink' — короткие строки
//    hostname 'not-suno.evil.com' → includes('suno') → true → SSRF bypass
//    Нужна точная проверка: hostname === d || hostname.endsWith('.'+d)

// ⚠️ Нет JWT guard — любой неавторизованный пользователь может
//    использовать сервер как прокси для скачивания файлов

// ⚠️ const axios = require('axios') внутри метода —
//    CommonJS require() внутри async функции вместо ES import вверху файла

// ⚠️ @Res() res: any — потерян тип Response из express
//    (импортирован как type Response, но используется any)

// ⚠️ Нет обработки ошибок axios.get —
//    если внешний URL недоступен → необработанный 500

// ⚠️ filename в Content-Disposition не экранирован по RFC 5987
//    для Unicode имён файлов
⚠️ Замеченные проблемы

🔴 Критичные

SSRF bypass через allowlist — проверка hostname.includes('suno') позволяет создать домен evil-suno.com или fakesuno.malicious.ru и пройти фильтр. Нужна точная проверка: hostname === domain || hostname.endsWith('.' + domain). Особенно опасно для коротких подстрок 'kie', 'suno', 'evolink'.

GET /upload/download — публичный без авторизации — любой пользователь (включая неавторизованных) может использовать сервер как прокси для скачивания файлов с разрешённых доменов. Нет JwtAuthGuard, нет rate limiting. Создаёт вектор для abuse (трафик за счёт сервиса).

UploadController создаёт собственный S3Client — полное дублирование конфигурации и логики. При изменении S3 endpoint / credentials нужно обновлять оба места. StorageService инжектируется но не используется.

S3_PUBLIC_URL без значения → невалидные URL — дефолт '' означает что при незаданной переменной все getPublicUrl(key) вернут /key. Все сохранённые файлы получат относительные пути вместо абсолютных URL.

🟡 Средние

contentType с параметрами → расширение 'bin' — Content-Type: image/jpeg; charset=utf-8 не матчится в словаре getExtension(). Файл сохранится как .bin. Нужен contentType.split(';')[0].trim() перед lookup.

saveBase64 принимает type: string — при вызове с произвольной строкой генерируется дважды-суффиксированный путь: documentss/userId/.... Тип должен быть 'image' | 'video' | 'audio' как в downloadAndSave.

downloadAndSave не различает успех и fallback — возвращает { s3Url: originalUrl, key: '', size: 0 } при ошибке. Вызывающий код (GenerationConsumer) проверяет key: '' как признак неудачи, но явного контракта нет. Если провайдерский URL протухнет — у пользователя пропадут результаты генерации.

Нет обработки ошибок в POST /upload/image — ошибка S3 вернёт необработанный 500. Нет try/catch, нет понятного сообщения пользователю.

Нет обработки ошибок в GET /upload/download — ошибка axios (внешний URL недоступен, timeout) → необработанный 500 с утечкой стека. Нужен try/catch с res.status(502).

🟢 Минорные

require('axios') внутри метода — const axios = require('axios') в теле proxyDownload(). Axios уже импортирован в storage.service.ts через ES import. Нужно добавить import axios from 'axios' вверху файла контроллера.

@Res() res: any — тип Response импортирован (import type { Response }), но параметр аннотирован как any. Теряется типизация и IDE-подсказки.

checkBucket() при старте не awaited — вызов в конструкторе this.checkBucket() без await. Ошибка подключения к S3 при старте логируется, но не влияет на запуск приложения. Первые запросы могут падать без явного сигнала о проблеме.

UploadResponseDto объявлен дважды и нигде не используется — класс присутствует дважды в коде (в начале и в конце файла), не имеет декораторов NestJS/Swagger, не используется как тип возврата ни в одном методе.

deleteFile без проверки принадлежности — принимает любой key и удаляет объект. Если key попадёт из пользовательского ввода (например через Admin API) без проверки — можно удалить чужой файл.