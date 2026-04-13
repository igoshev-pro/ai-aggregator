import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  Req,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { StorageService } from '../storage/storage.service';
import { v4 as uuidv4 } from 'uuid';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

// Макс 10 MB
const MAX_SIZE = 10 * 1024 * 1024;

const ALLOWED_AUDIO_MIMES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/aac',
  'audio/flac',
  'audio/x-m4a',
  'audio/m4a',
];

const ALLOWED_IMAGE_MIMES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
];

@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(private readonly storage: StorageService) {}

  /**
   * POST /upload/audio
   * Загрузка аудиофайла → S3 → возврат публичного URL
   */
  @Post('audio')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_AUDIO_MIMES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException(`Недопустимый тип файла: ${file.mimetype}. Разрешены: MP3, WAV, OGG, WEBM, AAC, FLAC, M4A`), false);
        }
      },
    }),
  )
  async uploadAudio(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('Файл не передан');
    }

    const userId = req.user?.id || req.user?._id || 'anonymous';
    this.logger.log(`Audio upload: ${file.originalname} (${file.size} bytes) by user ${userId}`);

    try {
      const ext = this.getExtension(file.mimetype, file.originalname);
      const key = `uploads/audio/${userId}/${uuidv4()}.${ext}`;

      const url = await this.storage.uploadBuffer(
        file.buffer,
        key,
        file.mimetype,
      );

      this.logger.log(`Audio uploaded → ${url}`);

      // Планируем удаление через 1 час
      this.scheduleDelete(key, 60 * 60 * 1000);

      return {
        success: true,
        data: {
          url,
          key,
          size: file.size,
          mimetype: file.mimetype,
          originalName: file.originalname,
        },
      };
    } catch (error: any) {
      this.logger.error(`Upload failed: ${error.message}`);
      throw new BadRequestException('Ошибка загрузки файла');
    }
  }

  /**
   * POST /upload/image
   * Загрузка изображения → S3 → возврат публичного URL
   */
  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException(`Недопустимый тип файла: ${file.mimetype}`), false);
        }
      },
    }),
  )
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('Файл не передан');
    }

    const userId = req.user?.id || req.user?._id || 'anonymous';

    try {
      const ext = this.getExtension(file.mimetype, file.originalname);
      const key = `uploads/image/${userId}/${uuidv4()}.${ext}`;

      const url = await this.storage.uploadBuffer(
        file.buffer,
        key,
        file.mimetype,
      );

      // Удаление через 1 час
      this.scheduleDelete(key, 60 * 60 * 1000);

      return {
        success: true,
        data: {
          url,
          key,
          size: file.size,
          mimetype: file.mimetype,
        },
      };
    } catch (error: any) {
      this.logger.error(`Image upload failed: ${error.message}`);
      throw new BadRequestException('Ошибка загрузки файла');
    }
  }

  private getExtension(mimetype: string, originalName?: string): string {
    const map: Record<string, string> = {
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav',
      'audio/wave': 'wav',
      'audio/x-wav': 'wav',
      'audio/ogg': 'ogg',
      'audio/webm': 'webm',
      'audio/mp4': 'mp4',
      'audio/aac': 'aac',
      'audio/flac': 'flac',
      'audio/x-m4a': 'm4a',
      'audio/m4a': 'm4a',
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };

    if (map[mimetype]) return map[mimetype];

    // Fallback: расширение из имени файла
    if (originalName) {
      const parts = originalName.split('.');
      if (parts.length > 1) return parts.pop()!.toLowerCase();
    }

    return 'bin';
  }

  private scheduleDelete(key: string, delayMs: number) {
    setTimeout(async () => {
      try {
        await this.storage.deleteFile(key);
        this.logger.log(`Auto-deleted temp file: ${key}`);
      } catch (e: any) {
        this.logger.error(`Auto-delete failed for ${key}: ${e.message}`);
      }
    }, delayMs);
  }
}