// src/modules/admin/category-covers.controller.ts
import {
  Controller,
  Get,
  Put,
  Param,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { UserRole } from '@/common/interfaces';
import { CategoryCoversService } from './category-covers.service';

// Локальный тип (как в storage/upload.controller.ts)
interface UploadedFileType {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('Admin / Category Covers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin/category-covers')
export class CategoryCoversController {
  constructor(private readonly service: CategoryCoversService) {}

  @Get()
  @ApiOperation({ summary: 'Get all 4 category covers' })
  async list() {
    const data = await this.service.listAll();
    return { success: true, data };
  }

  @Put(':categoryId')
  @ApiOperation({ summary: 'Upload new cover image for a category' })
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
        if (!file.mimetype.match(/image\/(jpeg|jpg|png|webp)/)) {
          cb(new BadRequestException('Only JPEG, PNG, WebP allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async upload(
    @CurrentUser('sub') adminId: string,
    @Param('categoryId') categoryId: string,
    @UploadedFile() file: UploadedFileType,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    const data = await this.service.upload(adminId, categoryId, file);
    return { success: true, data };
  }
}