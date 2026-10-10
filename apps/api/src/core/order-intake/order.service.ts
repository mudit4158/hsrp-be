import { Injectable } from '@nestjs/common';
import { Order, Prisma } from '@prisma/client';
import type { CreateOrderRequest, OrderChannel, OrderStatus } from '@hsrp/contracts';
import { requestContext } from '../../platform/context/request-context';
import { Db, PrismaService, Tx } from '../../platform/database/prisma.service';
import { Problem } from '../../platform/http/problem';
import { AuditService } from '../../utility/audit/audit.service';
import { DocumentsService } from '../../utility/documents/documents.service';
import { FileService } from '../../utility/file-storage/file.service';
import { EventBus } from '../../utility/integration-hub/event-bus.service';
import { MastersService } from '../masters/masters.service';
import { ScopeService } from '../masters/scope.service';
import { SUBJECT } from '../shared/subjects';
import { assertTransition, FINAL_STATUSES, positionsOf, TransitionError } from './order-state-machine';

export interface NewOrder extends Partial<CreateOrderRequest> {
  regnNo: string;
  chassisNo: string;
  engineNo: string;
  channel: OrderChannel;
  orderType: 'NEW' | 'OLD' | 'REPLACEMENT';
  plateSet: 'BOTH' | 'FRONT' | 'REAR';
  dealerId?: string;
  oemId?: string;
  sourceRef?: string;
}

const STATUS_EVENTS: Partial<Record<OrderStatus, string>> = {
  VALIDATED: 'OrderValidated',
  REJECTED: 'OrderRejected',
  CONFIRMED: 'OrderConfirmed',
  CANCELLED: 'OrderCancelled',
  COMPLETED: 'OrderCompleted',
};

/** Order intake: one canonical order for every channel, and the owner of the order state machine. */
@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
    private readonly docs: DocumentsService,
    private readonly masters: MastersService,
    private readonly scope: ScopeService,
    private readonly files: FileService,
    private readonly audit: AuditService,
  ) {}

  /** Creates a RECEIVED order and publishes OrderReceived; validation runs from the outbox. */
  async create(input: NewOrder, tx: Tx): Promise<Order> {
    const tenantId = requestContext.tenantId();
    const dealer = input.dealerId ? await this.masters.dealer(input.dealerId, tx) : null;
    if (dealer && dealer.status !== 'ACTIVE') throw Problem.unprocessable(`Dealer ${dealer.code} is not active`, 'dealer-inactive');
    const stateCode = (input.stateCode ?? dealer?.stateCode ?? '').toUpperCase();
    if (!stateCode) throw Problem.badRequest('State is required', 'state-required');
    await this.masters.state(stateCode, tx);
    if (input.oemId && dealer && !(await this.masters.dealerServesOem(dealer.id, input.oemId, tx))) {
      throw Problem.unprocessable(`Dealer ${dealer.code} is not mapped to this OEM`, 'dealer-oem-mapping');
    }
    if (input.orderType === 'REPLACEMENT') {
      if (!input.replacementReason) throw Problem.badRequest('Replacement reason is required (DAMAGED or THEFT)', 'replacement-reason');
      if (!input.evidenceFileId) {
        throw Problem.badRequest(input.replacementReason === 'THEFT' ? 'Attach the police report' : 'Attach a photo of the damaged plate', 'evidence-required');
      }
    }
    const open = await tx.order.findFirst({ where: { tenantId, regnNo: input.regnNo, status: { notIn: [...FINAL_STATUSES] } } });
    if (open) throw Problem.conflict(`An open order ${open.orderNo} already exists for ${input.regnNo}`, 'order-exists', { orderId: open.id, orderNo: open.orderNo });

    const orderNo = await this.docs.nextNumber('order', tx, { STATE: stateCode });
    const order = await tx.order.create({
      data: {
        tenantId,
        orderNo,
        channel: input.channel,
        orderType: input.orderType,
        plateSet: input.plateSet,
        replacementReason: input.replacementReason,
        evidenceFileId: input.evidenceFileId,
        status: 'RECEIVED',
        stateCode,
        regnNo: input.regnNo,
        chassisNo: input.chassisNo,
        engineNo: input.engineNo,
        dealerId: dealer?.id,
        stationId: dealer?.stationId,
        oemId: input.oemId,
        sourceRef: input.sourceRef,
        pendingPositions: positionsOf(input.plateSet),
        ownerName: input.ownerName,
        mobile: input.mobile,
        email: input.email,
        remarks: input.remarks,
        createdBy: requestContext.actorId(),
      },
    });
    if (input.evidenceFileId) await this.files.attach(input.evidenceFileId, { subjectType: SUBJECT.order, subjectId: order.id, purpose: 'replacement-evidence' }, tx);
    await tx.orderStatusHistory.create({ data: { tenantId, orderId: order.id, toStatus: 'RECEIVED', trigger: `received:${input.channel}`, actorId: requestContext.actorId() } });
    await this.bus.publish(tx, { type: 'OrderReceived', subjectType: SUBJECT.order, subjectId: order.id, payload: { orderId: order.id, orderNo, channel: input.channel } });
    await this.audit.record({ action: 'order.create', subjectType: SUBJECT.order, subjectId: order.id, after: { orderNo, channel: input.channel, regnNo: input.regnNo, orderType: input.orderType } }, tx);
    return order;
  }

  /**
   * The only way an order changes status. Locks the row, checks the state machine, writes history,
   * and publishes OrderStatusChanged (plus the specific event for key statuses) in the same transaction.
   */
  async transition(tx: Tx, orderId: string, to: OrderStatus, trigger: string, patch: Prisma.OrderUpdateInput = {}, note?: string): Promise<Order> {
    await tx.$queryRaw`SELECT id FROM core_ord_order WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw Problem.notFound('Order');
    try {
      assertTransition(order.status as OrderStatus, to);
    } catch (e) {
      if (e instanceof TransitionError) throw Problem.conflict(`Order ${order.orderNo} is ${order.status}; it cannot move to ${to}`, 'invalid-transition');
      throw e;
    }
    const updated = await tx.order.update({ where: { id: orderId }, data: { ...patch, status: to } });
    await tx.orderStatusHistory.create({
      data: { tenantId: order.tenantId, orderId, fromStatus: order.status, toStatus: to, trigger, actorId: requestContext.actorId(), note },
    });
    const payload = { orderId, orderNo: order.orderNo, from: order.status, status: to, trigger, channel: order.channel, reason: note };
    await this.bus.publish(tx, { type: 'OrderStatusChanged', subjectType: SUBJECT.order, subjectId: orderId, payload });
    const specific = STATUS_EVENTS[to];
    if (specific) await this.bus.publish(tx, { type: specific, subjectType: SUBJECT.order, subjectId: orderId, payload });
    return updated;
  }

  /** Updates fields the order module owns on behalf of other modules (never the status). */
  update(tx: Tx, orderId: string, data: Pick<Prisma.OrderUpdateInput, 'pendingPositions' | 'paymentId' | 'walletHoldId' | 'approvalId' | 'remarks' | 'rejectionReason'>) {
    return tx.order.update({ where: { id: orderId }, data });
  }

  async get(id: string, db: Db = this.prisma) {
    const o = await db.order.findFirst({ where: { id, tenantId: requestContext.tenantId() } });
    if (!o) throw Problem.notFound('Order');
    return o;
  }

  /** Fetches an order the current actor may see. */
  async getScoped(id: string) {
    const where = await this.scope.where();
    const o = await this.prisma.order.findFirst({ where: { id, tenantId: requestContext.tenantId(), ...where } });
    if (!o) throw Problem.notFound('Order');
    return o;
  }

  byIds(ids: string[], db: Db = this.prisma) {
    return db.order.findMany({ where: { id: { in: ids }, tenantId: requestContext.tenantId() } });
  }

  async byOrderNo(orderNo: string) {
    const o = await this.prisma.order.findUnique({ where: { tenantId_orderNo: { tenantId: requestContext.tenantId(), orderNo } } });
    if (!o) throw Problem.notFound('Order');
    return o;
  }

  findBySourceRef(oemId: string, sourceRef: string) {
    return this.prisma.order.findUnique({ where: { tenantId_oemId_sourceRef: { tenantId: requestContext.tenantId(), oemId, sourceRef } } });
  }

  latestForVehicle(regnNo: string, chassisLast5: string) {
    return this.prisma.order.findFirst({
      where: { tenantId: requestContext.tenantId(), regnNo: regnNo.toUpperCase(), chassisNo: { endsWith: chassisLast5.toUpperCase() } },
      orderBy: { createdAt: 'desc' },
    });
  }

  find(where: Prisma.OrderWhereInput, opts: { take?: number; orderBy?: Prisma.OrderOrderByWithRelationInput } = {}) {
    return this.prisma.order.findMany({ where: { ...where, tenantId: requestContext.tenantId() }, orderBy: opts.orderBy ?? { createdAt: 'asc' }, take: opts.take ?? 500 });
  }

  async list(q: { page: number; pageSize: number; status?: string; channel?: string; dealerId?: string; stationId?: string; stateCode?: string; q?: string; from?: string; to?: string }) {
    const scopeWhere = await this.scope.where();
    const where: Prisma.OrderWhereInput = {
      tenantId: requestContext.tenantId(),
      ...(q.status ? { status: { in: q.status.split(',') } } : {}),
      ...(q.channel ? { channel: { in: q.channel.split(',') } } : {}),
      ...(q.dealerId ? { dealerId: q.dealerId } : {}),
      ...(q.stationId ? { stationId: q.stationId } : {}),
      ...(q.stateCode ? { stateCode: q.stateCode } : {}),
      ...(q.q ? { OR: [{ orderNo: { contains: q.q.toUpperCase() } }, { regnNo: { contains: q.q.toUpperCase() } }, { chassisNo: { contains: q.q.toUpperCase() } }] } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(`${q.to}T23:59:59+05:30`) } : {}) } } : {}),
      ...scopeWhere,
    };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.order.count({ where }),
    ]);
    const dealers = await this.masters.dealers([...new Set(items.map((i) => i.dealerId).filter(Boolean) as string[])]);
    const dealerName = new Map(dealers.map((d) => [d.id, `${d.code} · ${d.name}`]));
    return { items: items.map((o) => ({ ...o, dealerName: o.dealerId ? dealerName.get(o.dealerId) : null })), total, page: q.page, pageSize: q.pageSize };
  }

  history(orderId: string) {
    return this.prisma.orderStatusHistory.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  }

  validations(orderId: string) {
    return this.prisma.orderValidation.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  }

  async countByStatus(where: Prisma.OrderWhereInput = {}) {
    const rows = await this.prisma.order.groupBy({ by: ['status'], where: { tenantId: requestContext.tenantId(), ...where }, _count: true });
    return Object.fromEntries(rows.map((r) => [r.status, r._count]));
  }

  /** Open orders by age bucket (days since received). */
  async ageing(where: Prisma.OrderWhereInput = {}) {
    const rows = await this.prisma.order.findMany({
      where: { tenantId: requestContext.tenantId(), status: { notIn: [...FINAL_STATUSES] }, ...where },
      select: { createdAt: true, status: true },
    });
    const now = Date.now();
    const buckets = { '0-2 days': 0, '3-7 days': 0, '8-15 days': 0, '16+ days': 0 };
    for (const r of rows) {
      const d = (now - r.createdAt.getTime()) / 86400_000;
      if (d < 3) buckets['0-2 days']++;
      else if (d < 8) buckets['3-7 days']++;
      else if (d < 16) buckets['8-15 days']++;
      else buckets['16+ days']++;
    }
    return buckets;
  }

  rawQuery(where: Prisma.OrderWhereInput, select?: Prisma.OrderSelect) {
    return this.prisma.order.findMany({ where: { tenantId: requestContext.tenantId(), ...where }, ...(select ? { select } : {}), orderBy: { createdAt: 'desc' }, take: 5000 });
  }

  saveValidation(tx: Tx, orderId: string, step: string, outcome: 'PASS' | 'FAIL' | 'SKIP', message?: string, data?: unknown) {
    return tx.orderValidation.create({
      data: { tenantId: requestContext.tenantId(), orderId, step, outcome, message, data: (data ?? undefined) as Prisma.InputJsonValue | undefined },
    });
  }
}
