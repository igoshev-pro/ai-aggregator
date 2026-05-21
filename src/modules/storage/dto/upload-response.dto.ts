export class UploadResponseDto {
  url: string;          // публичный URL (S3 Timeweb)
  key: string;          // ключ в bucket (для удаления)
  size: number;         // размер в байтах
  mimeType: string;     // MIME-тип
  filename: string;     // оригинальное имя файла
  type: 'image' | 'audio' | 'video';
}