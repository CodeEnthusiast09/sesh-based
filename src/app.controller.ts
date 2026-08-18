import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ApiResponse } from './common/interfaces/api-response.interface';
import { successResponse } from './common/utils/response.helper';

@Controller()
export class AppController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get('health')
  async health(): Promise<ApiResponse<{ database: string }>> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException('Database is unreachable');
    }

    return successResponse('Service is healthy', { database: 'up' });
  }
}
