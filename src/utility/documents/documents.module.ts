import { Body, Controller, Get, Global, Module, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../platform/http/decorators';
import { AuditService } from '../audit/audit.service';
import { DocumentsService } from './documents.service';
import { Layout } from './pdf-renderer';

class TemplateDto extends createZodDto(z.object({ name: z.string().min(2), layout: z.object({ elements: z.array(z.record(z.unknown())) }).passthrough() })) {}

@ApiTags('documents')
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly docs: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  @Get('templates')
  @RequirePermission('config.read', 'config.manage')
  list() {
    return this.docs.listTemplates();
  }

  @Put('templates/:code')
  @RequirePermission('config.manage')
  async put(@Param('code') code: string, @Body() body: TemplateDto) {
    const t = await this.docs.upsertTemplate(code, body.name, body.layout as unknown as Layout);
    await this.audit.record({ action: 'document.template.update', subjectType: 'doc-template', subjectId: code, after: body.layout });
    return t;
  }
}

@Global()
@Module({ controllers: [DocumentsController], providers: [DocumentsService], exports: [DocumentsService] })
export class DocumentsModule {}
