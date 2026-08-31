import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UploadController } from './upload.controller';
import { StorageModule } from '../storage/storage.module';
import { DocumentParserService } from './document-parser.service';
import { UserUploadService } from './user-upload.service';
import { UserUpload, UserUploadSchema } from './schemas/user-upload.schema';

@Module({
  imports: [
    StorageModule,
    MongooseModule.forFeature([
      { name: UserUpload.name, schema: UserUploadSchema },
    ]),
  ],
  controllers: [UploadController],
  providers: [DocumentParserService, UserUploadService],
  exports: [UserUploadService],
})
export class UploadModule {}
