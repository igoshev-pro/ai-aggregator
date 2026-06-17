// src/modules/admin/category-covers.service.ts
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import {
  CategoryCover,
  CategoryCoverDocument,
  CategoryId,
} from './schemas/category-cover.schema';
import { StorageService } from '../storage/storage.service';

const ALLOWED_CATEGORIES: CategoryId[] = ['text', 'image', 'video', 'audio'];

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

@Injectable()
export class CategoryCoversService {
  private readonly logger = new Logger(CategoryCoversService.name);

  constructor(
    @InjectModel(CategoryCover.name)
    private readonly coverModel: Model<CategoryCoverDocument>,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Возвращает все 4 обложки.
   * Если в БД нет записи для какой-то категории — её просто не будет в результате
   * (фронт сам подставит fallback).
   */
  async listAll() {
    const docs = await this.coverModel.find().lean().exec();

    // Нормализуем в map { text: {...}, image: {...}, ... }
    const map: Record<string, any> = {};
    for (const cat of ALLOWED_CATEGORIES) {
      map[cat] = null;
    }
    for (const doc of docs) {
      if (ALLOWED_CATEGORIES.includes(doc.categoryId as CategoryId)) {
        map[doc.categoryId] = {
          categoryId: doc.categoryId,
          imageUrl: doc.imageUrl,
          updatedAt: (doc as any).updatedAt,
        };
      }
    }
    return map;
  }

  /**
   * Загружает новую картинку в S3 и обновляет/создаёт запись в БД.
   * Старый файл из S3 удаляется (если был).
   */
  async upload(
    adminId: string,
    categoryId: string,
    file: {
      mimetype: string;
      buffer: Buffer;
      size: number;
    },
  ) {
    // ─── Валидация categoryId ─────────────────────────────────
    if (!ALLOWED_CATEGORIES.includes(categoryId as CategoryId)) {
      throw new BadRequestException(
        `Invalid categoryId. Allowed: ${ALLOWED_CATEGORIES.join(', ')}`,
      );
    }

    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException('File is required');
    }

    // ─── Валидация mime ──────────────────────────────────────
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type "${file.mimetype}". Allowed: PNG, JPEG, WebP`,
      );
    }

    // ─── Валидация размера (10 MB) ──────────────────────────
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      throw new BadRequestException('File too large (max 10 MB)');
    }

    // ─── Загрузка в S3 ──────────────────────────────────────
    const ext = this.getExtension(file.mimetype);
    const key = `category-covers/${categoryId}/${uuidv4()}.${ext}`;

    const s3Url = await this.storageService.uploadBuffer(
      file.buffer,
      key,
      file.mimetype,
    );

    // ─── Получаем старый документ (чтобы удалить старый файл) ─
    const existing = await this.coverModel.findOne({ categoryId }).exec();
    const oldKey = existing?.s3Key;

    // ─── Сохраняем в БД (upsert) ────────────────────────────
    const updated = await this.coverModel
      .findOneAndUpdate(
        { categoryId },
        {
          $set: {
            imageUrl: s3Url,
            s3Key: key,
            updatedBy: new Types.ObjectId(adminId),
          },
          $setOnInsert: {
            categoryId: categoryId as CategoryId,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();

    this.logger.log(
      `Category cover updated: ${categoryId} → ${s3Url} by admin=${adminId}`,
    );

    // ─── Удаляем старый файл (best-effort, не блокирует) ────
    if (oldKey && oldKey !== key) {
      this.storageService.deleteFile(oldKey).catch((err) => {
        this.logger.warn(
          `Failed to delete old cover "${oldKey}": ${err?.message}`,
        );
      });
    }

    return {
      categoryId,
      imageUrl: s3Url,
      updatedAt: (updated as any).updatedAt,
    };
  }

  private getExtension(mime: string): string {
    const map: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/webp': 'webp',
    };
    return map[mime] || 'bin';
  }
}