import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FavoritesService } from './favorites.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Favorites')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Post('toggle')
  @ApiOperation({ summary: 'Toggle favorite' })
  async toggle(
    @CurrentUser('sub') userId: string,
    @Body() body: {
      type: string;
      itemId: string;
      title?: string;
      previewUrl?: string;
    },
  ) {
    const result = await this.favoritesService.toggleFavorite(
      userId,
      body.type,
      body.itemId,
      body,
    );
    return { success: true, data: result };
  }

  @Get()
  @ApiOperation({ summary: 'Get favorites' })
  async getFavorites(
    @CurrentUser('sub') userId: string,
    @Query('type') type?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const result = await this.favoritesService.getFavorites(userId, type, page, limit);
    return { success: true, data: result };
  }
}