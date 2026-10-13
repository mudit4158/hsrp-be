import { Body, Controller, Get, Global, Module, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { RequirePermission } from '../../platform/http/decorators';
import { FilteredPageQueryDto, pageArgs, pageOf } from '../../platform/http/pagination';
import { Problem } from '../../platform/http/problem';
import { ImportService } from './import.service';

@ApiTags('imports')
@Controller('imports')
export class ImportController {
  constructor(
    private readonly imports: ImportService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('profiles')
  @RequirePermission('imports.run')
  profiles() {
    return this.prisma.importProfile.findMany({ where: { tenantId: requestContext.tenantId() }, orderBy: { code: 'asc' } });
  }

  @Get('profiles/:code/template')
  @RequirePermission('imports.run')
  async template(@Param('code') code: string, @Res() res: Response) {
    const t = await this.imports.template(code);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${t.filename}"`);
    res.send(t.csv);
  }

  @Post()
  @RequirePermission('imports.run')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, profileCode: { type: 'string' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  start(@UploadedFile() file: Express.Multer.File | undefined, @Body('profileCode') profileCode: string, @Body('context') context?: string) {
    if (!file) throw Problem.badRequest('Attach the CSV in the "file" field');
    if (!profileCode) throw Problem.badRequest('profileCode is required');
    let ctx: Record<string, string> | undefined;
    if (context) {
      try {
        ctx = JSON.parse(context) as Record<string, string>;
      } catch {
        throw Problem.badRequest('context must be JSON');
      }
    }
    return this.imports.start({ profileCode, filename: file.originalname, data: file.buffer, context: ctx });
  }

  @Get()
  @RequirePermission('imports.run')
  async jobs(@Query() q: FilteredPageQueryDto) {
    const where = { tenantId: requestContext.tenantId(), ...(q.profileCode ? { profileCode: String(q.profileCode) } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.importJob.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.importJob.count({ where }),
    ]);
    return pageOf(items, total, q);
  }

  @Get(':id')
  @RequirePermission('imports.run')
  async job(@Param('id') id: string) {
    return { job: await this.imports.job(id), rows: await this.imports.rows(id) };
  }

  @Get(':id/error-report')
  @RequirePermission('imports.run')
  async errorReport(@Param('id') id: string, @Res() res: Response) {
    const csv = await this.imports.errorReport(id);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="import-${id}-errors.csv"`);
    res.send(csv);
  }
}

@Global()
@Module({ controllers: [ImportController], providers: [ImportService], exports: [ImportService] })
export class ImportExportModule {}
