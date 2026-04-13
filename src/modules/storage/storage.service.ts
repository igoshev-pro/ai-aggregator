// src/modules/storage/storage.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private client: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor(private config: ConfigService) {
    this.bucket = this.config.get('S3_BUCKET', 'ai-generations');
    this.publicUrl = this.config.get('S3_PUBLIC_URL', '');

    this.client = new S3Client({
      endpoint: this.config.get('S3_ENDPOINT', 'https://s3.timeweb.cloud'),
      region: this.config.get('S3_REGION', 'ru-1'),
      credentials: {
        accessKeyId: this.config.get('S3_ACCESS_KEY', ''),
        secretAccessKey: this.config.get('S3_SECRET_KEY', ''),
      },
      forcePathStyle: true, // обязательно для Timeweb
    });

    this.checkBucket();
  }

  private async checkBucket() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`S3 bucket "${this.bucket}" is ready`);
    } catch (error: any) {
      this.logger.error(`S3 bucket check failed: ${error.message}`);
    }
  }

  // Скачать по URL и сохранить в S3
  async downloadAndSave(
    url: string,
    userId: string,
    type: 'image' | 'video' | 'audio' = 'image',
  ): Promise<{ s3Url: string; key: string; size: number }> {
    try {
      // base64
      if (url.startsWith('data:')) {
        return this.saveBase64(url, userId, type);
      }

      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 60000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });

      const buffer = Buffer.from(response.data);
      const contentType = response.headers['content-type'] || 'image/png';
      const ext = this.getExtension(contentType);
      const key = `${type}s/${userId}/${uuidv4()}.${ext}`;

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          ACL: 'public-read',
        }),
      );

      const s3Url = this.getPublicUrl(key);
      this.logger.debug(`Saved → ${s3Url}`);

      return { s3Url, key, size: buffer.length };
    } catch (error: any) {
      this.logger.error(`downloadAndSave failed: ${error.message}`);
      // Отдаём оригинальный URL если не смогли сохранить
      return { s3Url: url, key: '', size: 0 };
    }
  }

  private async saveBase64(
    dataUrl: string,
    userId: string,
    type: string,
  ): Promise<{ s3Url: string; key: string; size: number }> {
    const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
    if (!matches) throw new Error('Invalid base64 data URL');

    const contentType = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    const ext = this.getExtension(contentType);
    const key = `${type}s/${userId}/${uuidv4()}.${ext}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ACL: 'public-read',
      }),
    );

    return { s3Url: this.getPublicUrl(key), key, size: buffer.length };
  }

  async deleteFile(key: string): Promise<void> {
    if (!key) return;
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      this.logger.debug(`Deleted: ${key}`);
    } catch (error: any) {
      this.logger.error(`Delete failed: ${error.message}`);
    }
  }

  getPublicUrl(key: string): string {
    return `${this.publicUrl}/${key}`;
  }

  private getExtension(contentType: string): string {
    const map: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/ogg': 'ogg',
    };
    return map[contentType] || 'bin';
  }

  async uploadBuffer(
    buffer: Buffer,
    key: string,
    contentType: string,
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ACL: 'public-read',
      }),
    );

    const url = this.getPublicUrl(key);
    this.logger.debug(`Uploaded buffer → ${url} (${buffer.length} bytes)`);
    return url;
  }
}