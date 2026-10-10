import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { RequirePermission } from '../../platform/http/decorators';
import { FilteredPageQueryDto, pageArgs, pageOf } from '../../platform/http/pagination';

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('audit.read', 'orders.read')
  async list(@Query() q: FilteredPageQueryDto) {
    const where = {
      tenantId: requestContext.tenantId(),
      ...(q.subjectType ? { subjectType: String(q.subjectType) } : {}),
      ...(q.subjectId ? { subjectId: String(q.subjectId) } : {}),
      ...(q.actorId ? { actorId: String(q.actorId) } : {}),
      ...(q.action ? { action: { contains: String(q.action) } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.auditLog.count({ where }),
    ]);
    return pageOf(items, total, q);
  }
}
