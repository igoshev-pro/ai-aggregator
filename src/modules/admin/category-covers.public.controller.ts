// src/modules/admin/category-covers.public.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CategoryCoversService } from './category-covers.service';

@ApiTags('Category Covers (Public)')
@Controller('categories/covers')
export class CategoryCoversPublicController {
  constructor(private readonly service: CategoryCoversService) {}

  @Get()
  @ApiOperation({ summary: 'Get all category covers (public, no auth)' })
  async list() {
    const data = await this.service.listAll();
    return { success: true, data };
  }
}