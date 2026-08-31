// src/modules/upload/schemas/user-upload.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserUploadDocument = UserUpload & Document;

export enum UploadKind {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  DOCUMENT = 'document',
}

/**
 * Файл, который пользователь загрузил сам (референс для генерации,
 * картинка в чат, документ). Нужен для вкладки «Загруженные»: без этой
 * записи файл лежит в S3, но найти его в интерфейсе невозможно — ссылка
 * известна только той сессии, где его загружали.
 *
 * Сам файл живёт в S3 постоянно и удаляется только по кнопке.
 */
@Schema({ timestamps: true })
export class UserUpload {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, enum: UploadKind })
  kind: UploadKind;

  /** Публичный URL в S3 — его подставляют в генерацию. */
  @Prop({ required: true })
  url: string;

  /** Ключ в бакете; нужен для удаления. */
  @Prop({ required: true })
  key: string;

  /** Имя файла у пользователя — показываем в списке. */
  @Prop({ default: '' })
  originalName: string;

  @Prop({ default: 0 })
  size: number;

  @Prop({ default: '' })
  mimetype: string;
}

export const UserUploadSchema = SchemaFactory.createForClass(UserUpload);

// Лента «Загруженные»: свежие сверху, с фильтром по типу.
UserUploadSchema.index({ userId: 1, createdAt: -1 });
UserUploadSchema.index({ userId: 1, kind: 1, createdAt: -1 });
