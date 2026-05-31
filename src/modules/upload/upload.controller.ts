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
import { DocumentParserService } from './document-parser.service';
import { v4 as uuidv4 } from 'uuid';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

const MAX_SIZE = 10 * 1024 * 1024;          // 10 MB (audio/image)
const MAX_DOC_SIZE = 20 * 1024 * 1024;      // 20 MB (документы)

const ALLOWED_AUDIO_MIMES = [
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
  'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/flac',
  'audio/x-m4a', 'audio/m4a',
];

const ALLOWED_IMAGE_MIMES = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
];

const ALLOWED_DOC_MIMES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
];

const ALLOWED_DOC_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv'];

@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(
    private readonly storage: StorageService,
    private readonly documentParser: DocumentParserService,
  ) {}

  // ─────────────────────────────────────────────────────
  // AUDIO
  // ─────────────────────────────────────────────────────
  @Post('audio')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_AUDIO_MIMES.includes(file.mimetype)) cb(null, true);
        else cb(new BadRequestException(`Недопустимый тип файла: ${file.mimetype}`), false);
      },
    }),
  )
  async uploadAudio(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) throw new BadRequestException('Файл не передан');

    const userId = req.user?.sub || req.user?.id || req.user?._id || 'anonymous';
    try {
      const ext = this.getExtension(file.mimetype, file.originalname);
      const key = `uploads/audio/${userId}/${uuidv4()}.${ext}`;
      const url = await this.storage.uploadBuffer(file.buffer, key, file.mimetype);
      this.scheduleDelete(key, 60 * 60 * 1000);
      return {
        success: true,
        data: { url, key, size: file.size, mimetype: file.mimetype, originalName: file.originalname },
      };
    } catch (error: any) {
      this.logger.error(`Audio upload failed: ${error.message}`);
      throw new BadRequestException('Ошибка загрузки файла');
    }
  }

  // ─────────────────────────────────────────────────────
  // IMAGE
  // ─────────────────────────────────────────────────────
  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_SIZE },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_IMAGE_MIMES.includes(file.mimetype)) cb(null, true);
        else cb(new BadRequestException(`Недопустимый тип файла: ${file.mimetype}`), false);
      },
    }),
  )
  async uploadImage(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) throw new BadRequestException('Файл не передан');
    const userId = req.user?.sub || req.user?.id || req.user?._id || 'anonymous';
    try {
      const ext = this.getExtension(file.mimetype, file.originalname);
      const key = `uploads/image/${userId}/${uuidv4()}.${ext}`;
      const url = await this.storage.uploadBuffer(file.buffer, key, file.mimetype);
      this.scheduleDelete(key, 60 * 60 * 1000);
      return {
        success: true,
        data: { url, key, size: file.size, mimetype: file.mimetype },
      };
    } catch (error: any) {
      this.logger.error(`Image upload failed: ${error.message}`);
      throw new BadRequestException('Ошибка загрузки файла');
    }
  }

  // ─────────────────────────────────────────────────────
  // 🆕 DOCUMENT (PDF / Word / Excel / TXT / CSV)
  // ─────────────────────────────────────────────────────
  @Post('document')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_DOC_SIZE },
      fileFilter: (_req, file, cb) => {
        const ext = (file.originalname.split('.').pop() || '').toLowerCase();
        if (ALLOWED_DOC_MIMES.includes(file.mimetype) || ALLOWED_DOC_EXT.includes(ext)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Поддерживаются: PDF, Word, Excel, TXT, CSV'), false);
        }
      },
    }),
  )
  async uploadDocument(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) throw new BadRequestException('Файл не передан');

    const userId = req.user?.sub || req.user?.id || req.user?._id || 'anonymous';
    this.logger.log(`Document upload: ${file.originalname} (${file.size} bytes) by ${userId}`);

    try {
      const ext = this.getExtension(file.mimetype, file.originalname);
      const key = `uploads/document/${userId}/${uuidv4()}.${ext}`;

      // 1. S3
      const url = await this.storage.uploadBuffer(file.buffer, key, file.mimetype);

      // 2. Извлекаем текст
      const extractedText = await this.documentParser.extractText(
        file.buffer,
        file.originalname,
        file.mimetype,
      );

      // Документ может понадобиться дольше изображений → удаляем через 2 часа
      this.scheduleDelete(key, 2 * 60 * 60 * 1000);

      return {
        success: true,
        data: {
          url,
          key,
          filename: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
          hasText: extractedText.length > 0,
          textLength: extractedText.length,
          extractedText,
        },
      };
    } catch (error: any) {
      this.logger.error(`Document upload failed: ${error.message}`);
      throw new BadRequestException('Ошибка загрузки документа');
    }
  }

  // ─────────────────────────────────────────────────────
  private getExtension(mimetype: string, originalName?: string): string {
    const map: Record<string, string> = {
      'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav',
      'audio/wave': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg',
      'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/aac': 'aac',
      'audio/flac': 'flac', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a',
      'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg',
      'image/webp': 'webp', 'image/gif': 'gif',
      'application/pdf': 'pdf',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'text/plain': 'txt',
      'text/csv': 'csv',
    };
    if (map[mimetype]) return map[mimetype];
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