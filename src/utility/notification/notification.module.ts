import { Body, Controller, Get, Global, Module, Param, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { RequirePermission } from '../../platform/http/decorators';
import { FilteredPageQueryDto, pageArgs, pageOf } from '../../platform/http/pagination';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from './notification.service';

class TemplatePatchDto extends createZodDto(
  z.object({ body: z.string().min(2).optional(), subject: z.string().optional(), senderId: z.string().optional(), dltTemplateId: z.string().optional(), active: z.boolean().optional() }),
) {}

@ApiTags('notification')
@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('messages')
  @RequirePermission('notifications.read')
  async messages(@Query() q: FilteredPageQueryDto) {
    const where = {
      tenantId: requestContext.tenantId(),
      ...(q.channel ? { channel: String(q.channel) } : {}),
      ...(q.recipient ? { recipient: { contains: String(q.recipient) } } : {}),
      ...(q.templateCode ? { templateCode: String(q.templateCode) } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.notifyMessage.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.notifyMessage.count({ where }),
    ]);
    return pageOf(items, total, q);
  }

  @Get('templates')
  @RequirePermission('notifications.read')
  templates() {
    return this.prisma.notifyTemplate.findMany({ where: { tenantId: requestContext.tenantId() }, orderBy: { code: 'asc' } });
  }

  @Patch('templates/:id')
  @RequirePermission('config.manage')
  async patchTemplate(@Param('id') id: string, @Body() body: TemplatePatchDto) {
    const before = await this.prisma.notifyTemplate.findFirstOrThrow({ where: { id, tenantId: requestContext.tenantId() } });
    const after = await this.prisma.notifyTemplate.update({ where: { id }, data: body });
    await this.audit.record({ action: 'notification.template.update', subjectType: 'notify-template', subjectId: id, before, after });
    return after;
  }
}

@Global()
@Module({ controllers: [NotificationController], providers: [NotificationService], exports: [NotificationService] })
export class NotificationModule {}
