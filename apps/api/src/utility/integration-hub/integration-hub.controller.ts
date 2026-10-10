import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { RequirePermission } from '../../platform/http/decorators';
import { FilteredPageQueryDto, pageArgs, pageOf } from '../../platform/http/pagination';
import { Problem } from '../../platform/http/problem';
import { AuditService } from '../audit/audit.service';
import { EventBus } from './event-bus.service';

@ApiTags('integration-monitor')
@Controller('integration')
export class IntegrationHubController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
    private readonly audit: AuditService,
  ) {}

  @Get('summary')
  @RequirePermission('integration.monitor')
  async summary() {
    const tenantId = requestContext.tenantId();
    const byStatus = await this.prisma.outboxDelivery.groupBy({ by: ['status'], where: { tenantId }, _count: true });
    const open = await this.prisma.outboxDelivery.groupBy({
      by: ['subscriber', 'status'],
      where: { tenantId, status: { in: ['PENDING', 'FAILED', 'RUNNING', 'DEAD'] } },
      _count: true,
    });
    const undispatched = await this.prisma.outboxEvent.count({ where: { tenantId, dispatchedAt: null } });
    return {
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
      open: open.map((r) => ({ subscriber: r.subscriber, status: r.status, count: r._count })),
      undispatchedEvents: undispatched,
      subscriptions: this.bus.subscriptions(),
    };
  }

  @Get('deliveries')
  @RequirePermission('integration.monitor')
  async deliveries(@Query() q: FilteredPageQueryDto) {
    const where = {
      tenantId: requestContext.tenantId(),
      ...(q.status ? { status: { in: String(q.status).split(',') } } : {}),
      ...(q.subscriber ? { subscriber: { contains: String(q.subscriber) } } : {}),
      ...(q.eventType ? { eventType: String(q.eventType) } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.outboxDelivery.findMany({ where, orderBy: { updatedAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.outboxDelivery.count({ where }),
    ]);
    const events = await this.prisma.outboxEvent.findMany({ where: { id: { in: items.map((i) => i.eventId) } } });
    const byId = new Map(events.map((e) => [e.id, e]));
    return pageOf(
      items.map((d) => ({ ...d, subjectType: byId.get(d.eventId)?.subjectType, subjectId: byId.get(d.eventId)?.subjectId, payload: byId.get(d.eventId)?.payload })),
      total,
      q,
    );
  }

  @Post('deliveries/:id/replay')
  @RequirePermission('integration.replay')
  async replay(@Param('id') id: string) {
    const d = await this.prisma.outboxDelivery.findFirst({ where: { id, tenantId: requestContext.tenantId() } });
    if (!d) throw Problem.notFound('Delivery');
    if (d.status === 'DONE' || d.status === 'RUNNING') throw Problem.conflict(`Delivery is ${d.status}; nothing to replay`);
    const updated = await this.prisma.tx(async (tx) => {
      const u = await tx.outboxDelivery.update({
        where: { id },
        data: { status: 'PENDING', nextAttemptAt: new Date(), attempts: d.status === 'DEAD' ? 0 : d.attempts },
      });
      await this.audit.record({ action: 'integration.replay', subjectType: 'outbox-delivery', subjectId: id, before: { status: d.status }, after: { status: 'PENDING' } }, tx);
      return u;
    });
    return updated;
  }

  @Get('events')
  @RequirePermission('integration.monitor', 'orders.read')
  async events(@Query() q: FilteredPageQueryDto) {
    const where = {
      tenantId: requestContext.tenantId(),
      ...(q.subjectType ? { subjectType: String(q.subjectType) } : {}),
      ...(q.subjectId ? { subjectId: String(q.subjectId) } : {}),
      ...(q.eventType ? { eventType: String(q.eventType) } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.outboxEvent.findMany({ where, orderBy: { seq: 'desc' }, ...pageArgs(q) }),
      this.prisma.outboxEvent.count({ where }),
    ]);
    return pageOf(items, total, q);
  }

  @Get('calls')
  @RequirePermission('integration.monitor')
  async calls(@Query() q: FilteredPageQueryDto) {
    const where = {
      tenantId: requestContext.tenantId(),
      ...(q.system ? { system: String(q.system) } : {}),
      ...(q.outcome ? { outcome: String(q.outcome) } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.callLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.callLog.count({ where }),
    ]);
    return pageOf(items, total, q);
  }
}
