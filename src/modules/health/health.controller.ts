import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private connection: Connection) {}

  @Get()
  @ApiOperation({ summary: 'Health check' })
  async check() {
    const mongoStatus = this.connection.readyState === 1 ? 'connected' : 'disconnected';

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      mongo: mongoStatus,
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB',
        heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
      },
    };
  }
}