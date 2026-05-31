import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { StorageModule } from '../storage/storage.module';
import { DocumentParserService } from './document-parser.service';

@Module({
  imports: [StorageModule],
  controllers: [UploadController],
  providers: [DocumentParserService],
})
export class UploadModule {}