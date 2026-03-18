// src/modules/storage/upload.controller.ts
import {
    Controller,
    Post,
    UseGuards,
    UseInterceptors,
    UploadedFile,
    BadRequestException,
    Get,
    Query,
    Res,
  } from '@nestjs/common';
  import { FileInterceptor } from '@nestjs/platform-express';
  import { ApiTags, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
  import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
  import { CurrentUser } from '@/common/decorators/current-user.decorator';
  import { StorageService } from './storage.service';
  import { memoryStorage } from 'multer';
  import { v4 as uuidv4 } from 'uuid';
  import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
  import { ConfigService } from '@nestjs/config';
  import type { Response } from 'express';
  
  // Локальный тип чтобы не зависеть от глобального namespace
  interface UploadedFileType {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  }
  
  @ApiTags('Upload')
  @Controller('upload')
  export class UploadController {
    private s3: S3Client;
    private bucket: string;
    private publicUrl: string;
  
    constructor(
      private storageService: StorageService,
      private config: ConfigService,
    ) {
      this.bucket = this.config.get('S3_BUCKET', 'ai-generations');
      this.publicUrl = this.config.get('S3_PUBLIC_URL', '');
  
      this.s3 = new S3Client({
        endpoint: this.config.get('S3_ENDPOINT', 'https://s3.timeweb.cloud'),
        region: this.config.get('S3_REGION', 'ru-1'),
        credentials: {
          accessKeyId: this.config.get('S3_ACCESS_KEY', ''),
          secretAccessKey: this.config.get('S3_SECRET_KEY', ''),
        },
        forcePathStyle: true,
      });
    }
  
    @Post('image')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiConsumes('multipart/form-data')
    @ApiBody({
      schema: {
        type: 'object',
        properties: {
          file: { type: 'string', format: 'binary' },
        },
      },
    })
    @UseInterceptors(
      FileInterceptor('file', {
        storage: memoryStorage(),
        limits: { fileSize: 10 * 1024 * 1024 },
        fileFilter: (_req, file, cb) => {
          if (!file.mimetype.match(/image\/(jpeg|png|webp)/)) {
            cb(new BadRequestException('Only JPEG, PNG, WebP allowed'), false);
            return;
          }
          cb(null, true);
        },
      }),
    )
    async uploadImage(
      @CurrentUser('sub') userId: string,
      @UploadedFile() file: UploadedFileType,
    ) {
      if (!file) {
        throw new BadRequestException('No file provided');
      }
  
      const ext = file.mimetype.split('/')[1].replace('jpeg', 'jpg');
      const key = `uploads/${userId}/${uuidv4()}.${ext}`;
  
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
          ACL: 'public-read',
        }),
      );
  
      const url = `${this.publicUrl}/${key}`;
  
      return {
        success: true,
        data: { url, key, size: file.size, mimetype: file.mimetype },
      };
    }

    @Get('download')
    async proxyDownload(
      @Query('url') url: string,
      @Query('filename') filename: string,
      @Res() res: any,
    ) {
      if (!url) throw new BadRequestException('url required');
  
      // Проверка домена
      const allowed = [
        'replicate.delivery', 'replicate.com', 'pbxt.replicate',
        'tjzk.replicate', 'oaidalleapiprodscus.blob', 'cdn.openai.com',
        'storage.googleapis.com', 'r2.cloudflarestorage.com',
        's3.timeweb.cloud', 'suno', 'kie', 'evolink',
      ];
  
      let hostname: string;
      try {
        hostname = new URL(url).hostname;
      } catch {
        throw new BadRequestException('Invalid URL');
      }
  
      if (!allowed.some((d) => hostname.includes(d))) {
        throw new BadRequestException('Domain not allowed');
      }
  
      const safeName = (filename || 'spichki_download').replace(/[^a-zA-Z0-9_.\-]/g, '_');
  
      const axios = require('axios');
      const response = await axios.get(url, {
        responseType: 'stream',
        timeout: 120000,
      });
  
      res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }
  
      response.data.pipe(res);
    }
  }