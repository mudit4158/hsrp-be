import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requestContext } from '../../platform/context/request-context';
import { Db, PrismaService } from '../../platform/database/prisma.service';
import { Problem } from '../../platform/http/problem';
import { DocumentsService } from '../documents/documents.service';
import { EventBus } from '../integration-hub/event-bus.service';

const DAY = 86400_000;

/** Ageing against the category's time limit. Pure, unit-tested. */
export function ageing(t: { createdAt: Date; dueAt: Date; status: string; resolvedAt?: Date | null }, now = new Date()) {
  const end = t.resolvedAt ?? now;
  const ageDays = Math.floor((end.getTime() - t.createdAt.getTime()) / DAY);
  const open = !['RESOLVED', 'CLOSED'].includes(t.status);
  const daysLeft = Math.ceil((t.dueAt.getTime() - now.getTime()) / DAY);
  return { ageDays, daysLeft: open ? daysLeft : null, overdue: open ? now > t.dueAt : (t.resolvedAt ?? now) > t.dueAt };
}

/** Tickets with a category, owner, time limit and history. */
@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docs: DocumentsService,
    private readonly bus: EventBus,
  ) {}

  async create(input: { categoryCode: string; title: string; description: string; raisedByName: string; raisedByContact: string; subjectType?: string; subjectId?: string }, db?: Db) {
    const run = async (tx: Db) => {
      const tenantId = requestContext.tenantId();
      const cat = await tx.ticketCategory.findUnique({ where: { tenantId_code: { tenantId, code: input.categoryCode } } });
      if (!cat) throw Problem.badRequest('Unknown complaint category', 'category-unknown');
      const ticketNo = await this.docs.nextNumber('ticket', tx);
      const t = await tx.ticket.create({
        data: { tenantId, ticketNo, ...input, dueAt: new Date(Date.now() + cat.slaDays * DAY) },
      });
      await tx.ticketEvent.create({ data: { tenantId, ticketId: t.id, kind: 'CREATED', message: input.description, toStatus: 'OPEN', actor: input.raisedByName, isPublic: true } });
      await this.bus.publish(tx, { type: 'TicketCreated', subjectType: 'ticket', subjectId: t.id, payload: { ticketId: t.id, ticketNo, contact: input.raisedByContact } });
      return t;
    };
    return db ? run(db) : this.prisma.tx(run);
  }

  async reply(ticketId: string, input: { message: string; status?: string; isPublic: boolean }) {
    return this.prisma.tx(async (tx) => {
      const t = await tx.ticket.findFirst({ where: { id: ticketId, tenantId: requestContext.tenantId() } });
      if (!t) throw Problem.notFound('Ticket');
      const status = input.status ?? (t.status === 'OPEN' ? 'IN_PROGRESS' : t.status);
      await tx.ticketEvent.create({
        data: { tenantId: t.tenantId, ticketId, kind: status !== t.status ? 'STATUS' : 'COMMENT', message: input.message, fromStatus: t.status, toStatus: status, actor: requestContext.actor()?.name ?? requestContext.actorId(), isPublic: input.isPublic },
      });
      const updated = await tx.ticket.update({
        where: { id: ticketId },
        data: { status, ownerUserId: t.ownerUserId ?? requestContext.actorId(), resolvedAt: ['RESOLVED', 'CLOSED'].includes(status) ? (t.resolvedAt ?? new Date()) : null },
      });
      await this.bus.publish(tx, { type: 'TicketUpdated', subjectType: 'ticket', subjectId: t.id, payload: { ticketId: t.id, ticketNo: t.ticketNo, status, contact: t.raisedByContact, isPublic: input.isPublic } });
      return updated;
    });
  }

  async byNumber(ticketNo: string, publicOnly: boolean) {
    const t = await this.prisma.ticket.findFirst({ where: { ticketNo, tenantId: requestContext.tenantId() } });
    if (!t) throw Problem.notFound('Ticket');
    const events = await this.prisma.ticketEvent.findMany({ where: { ticketId: t.id, ...(publicOnly ? { isPublic: true } : {}) }, orderBy: { createdAt: 'asc' } });
    return { ...t, ...ageing(t), events };
  }

  async get(id: string) {
    const t = await this.prisma.ticket.findFirst({ where: { id, tenantId: requestContext.tenantId() } });
    if (!t) throw Problem.notFound('Ticket');
    return this.byNumber(t.ticketNo, false);
  }

  async list(filter: { status?: string; overdue?: boolean; page: number; pageSize: number }) {
    const where: Prisma.TicketWhereInput = {
      tenantId: requestContext.tenantId(),
      ...(filter.status ? { status: { in: filter.status.split(',') } } : {}),
      ...(filter.overdue ? { dueAt: { lt: new Date() }, status: { notIn: ['RESOLVED', 'CLOSED'] } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.ticket.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (filter.page - 1) * filter.pageSize, take: filter.pageSize }),
      this.prisma.ticket.count({ where }),
    ]);
    return { items: items.map((t) => ({ ...t, ...ageing(t) })), total, page: filter.page, pageSize: filter.pageSize };
  }

  categories() {
    return this.prisma.ticketCategory.findMany({ where: { tenantId: requestContext.tenantId() }, orderBy: { name: 'asc' } });
  }
}
