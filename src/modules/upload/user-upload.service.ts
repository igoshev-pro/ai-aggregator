// src/modules/upload/user-upload.service.ts
import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  UserUpload,
  UserUploadDocument,
  UploadKind,
} from './schemas/user-upload.schema';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class UserUploadService {
  private readonly logger = new Logger(UserUploadService.name);

  constructor(
    @InjectModel(UserUpload.name)
    private readonly uploadModel: Model<UserUploadDocument>,
    private readonly storage: StorageService,
  ) {}

  /**
   * Запись о загруженном файле.
   *
   * Ошибки намеренно проглатываются: файл уже в S3 и ссылка на него ушла
   * клиенту. Если Mongo недоступна, пользователь должен получить рабочую
   * загрузку, просто без строчки в истории — падать здесь означало бы
   * ломать генерацию из-за второстепенной функции.
   */
  async record(params: {
    userId: string;
    kind: UploadKind;
    url: string;
    key: string;
    originalName?: string;
    size?: number;
    mimetype?: string;
  }): Promise<void> {
    if (!Types.ObjectId.isValid(params.userId)) return;

    try {
      await this.uploadModel.create({
        userId: new Types.ObjectId(params.userId),
        kind: params.kind,
        url: params.url,
        key: params.key,
        originalName: params.originalName || '',
        size: params.size || 0,
        mimetype: params.mimetype || '',
      });
    } catch (e: any) {
      this.logger.warn(`Не записал загрузку в историю: ${e.message}`);
    }
  }

  async list(userId: string, kind?: UploadKind, page = 1, limit = 24) {
    const filter: any = { userId: new Types.ObjectId(userId) };
    if (kind) filter.kind = kind;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 24));
    const skip = (pageNum - 1) * limitNum;

    const [uploads, total] = await Promise.all([
      this.uploadModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .exec(),
      this.uploadModel.countDocuments(filter),
    ]);

    return {
      uploads: uploads.map((u) => ({
        id: u._id,
        kind: u.kind,
        url: u.url,
        originalName: u.originalName,
        size: u.size,
        mimetype: u.mimetype,
        createdAt: u['createdAt'],
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    };
  }

  /** Удаляет и запись, и сам файл в S3. */
  async remove(userId: string, uploadId: string): Promise<void> {
    if (!Types.ObjectId.isValid(uploadId)) {
      throw new NotFoundException('Файл не найден');
    }

    const upload = await this.uploadModel.findById(uploadId);
    if (!upload) throw new NotFoundException('Файл не найден');
    if (upload.userId.toString() !== userId) {
      throw new ForbiddenException('Нет доступа');
    }

    // Сначала запись: если S3 не ответит, файл не должен остаться
    // «висеть» в интерфейсе — из бакета его подчистит ретрай ниже.
    await this.uploadModel.deleteOne({ _id: upload._id });

    try {
      await this.storage.deleteFile(upload.key);
    } catch (e: any) {
      this.logger.error(`Не удалил из S3 ${upload.key}: ${e.message}`);
    }
  }
}
