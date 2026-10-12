import { Body, Controller, Get, Global, Module, Param, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../platform/http/decorators';
import { ReportingService } from './reporting.service';

class SaveReportDto extends createZodDto(z.object({ reportCode: z.string(), name: z.string().min(2).max(100), params: z.record(z.string()) })) {}

@ApiTags('reports')
@Controller('reports')
export class ReportingController {
  constructor(private readonly reports: ReportingService) {}

  @Get()
  @RequirePermission('reports.read')
  list() {
    return this.reports.list();
  }

  @Get('saved')
  @RequirePermission('reports.read')
  saved() {
    return this.reports.saved();
  }

  @Post('saved')
  @RequirePermission('reports.read')
  save(@Body() body: SaveReportDto) {
    return this.reports.save(body);
  }

  @Get(':code')
  @RequirePermission('reports.read')
  run(@Param('code') code: string, @Query() params: Record<string, string>) {
    return this.reports.run(code, params);
  }

  @Get(':code/csv')
  @RequirePermission('reports.read')
  async csv(@Param('code') code: string, @Query() params: Record<string, string>, @Res() res: Response) {
    const csv = await this.reports.csv(code, params);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${code}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  }
}

@Global()
@Module({ controllers: [ReportingController], providers: [ReportingService], exports: [ReportingService] })
export class ReportingModule {}
