// src/modules/storage/storage.module.ts
import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { UploadController } from './upload.controller';
import { ConfigModule } from '@nestjs/config';

@Module({
    imports: [ConfigModule],
    providers: [StorageService],
    controllers: [UploadController],
    exports: [StorageService],
})
export class StorageModule { }