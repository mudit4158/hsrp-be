import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { InwardRequest } from '@hsrp/contracts';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService, Tx } from '../../platform/database/prisma.service';
import { Problem } from '../../platform/http/problem';
import { DocumentsService } from '../../utility/documents/documents.service';
import { EventBus } from '../../utility/integration-hub/event-bus.service';
import { InventoryService } from '../inventory/inventory.service';
import { MastersService } from '../masters/masters.service';
import { ScopeService } from '../masters/scope.service';
import { OrderService } from '../order-intake/order.service';
import { RejectionService } from '../rejection/rejection.module';
import { istDate, SUBJECT } from '../shared/subjects';

/** Delivery challans and dealer inward. A challan holds one dealer's plates and cannot be edited after creation. */
@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
    private readonly inventory: InventoryService,
    private readonly rejections: RejectionService,
    private readonly masters: MastersService,
    private readonly scope: ScopeService,
    private readonly docs: DocumentsService,
    private readonly bus: EventBus,
  ) {}

  /** Allocations already on a live challan (not cancelled, not rejected) cannot be dispatched again. */
  private async liveLineAllocationIds(db: Tx | PrismaService, allocationIds: string[]) {
    const lines = await db.challanLine.findMany({ where: { allocationId: { in: allocationIds }, inwardStatus: { in: ['PENDING', 'ACCEPTED'] } } });
    if (!lines.length) return new Set<string>();
    const live = await db.challan.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.challanId))] }, status: { not: 'CANCELLED' } }, select: { id: true } });
    const liveIds = new Set(live.map((c) => c.id));
    return new Set(lines.filter((l) => liveIds.has(l.challanId)).map((l) => l.allocationId));
  }

  async ready(stationId: string, dealerId?: string) {
    const orders = await this.orders.find({ status: 'STICKER_PRINTED', stationId, ...(dealerId ? { dealerId } : {}) });
    const out = [];
    for (const o of orders) {
      const allocs = await this.inventory.activeAllocations(o.id);
      const onChallan = await this.liveLineAllocationIds(this.prisma, allocs.map((a) => a.id));
      out.push({ ...o, toDispatch: allocs.filter((a) => !onChallan.has(a.id)).map((a) => ({ position: a.position, laserCode: a.laserCode })) });
    }
    return out;
  }

  async create(req: { stationId: string; dealerId: string; orderIds: string[] }) {
    const challan = await this.prisma.tx(async (tx) => {
      const orders = await this.orders.byIds(req.orderIds, tx);
      if (orders.length !== req.orderIds.length) throw Problem.notFound('One or more orders');
      for (const o of orders) {
        if (o.dealerId !== req.dealerId) throw Problem.unprocessable(`${o.orderNo} is for another dealer; a challan holds one dealer's orders only`, 'mixed-dealers');
        if (o.stationId !== req.stationId) throw Problem.unprocessable(`${o.orderNo} belongs to another station`, 'wrong-station');
        if (o.status !== 'STICKER_PRINTED') throw Problem.conflict(`${o.orderNo} is ${o.status}; only STICKER_PRINTED orders can be dispatched`, 'not-ready');
      }
      const challanNo = await this.docs.nextNumber('challan', tx);
      const c = await tx.challan.create({ data: { tenantId: requestContext.tenantId(), challanNo, stationId: req.stationId, dealerId: req.dealerId, createdBy: requestContext.actorId() } });
      for (const o of orders) {
        const allocs = await this.inventory.activeAllocations(o.id, tx);
        const onChallan = await this.liveLineAllocationIds(tx, allocs.map((a) => a.id));
        const todo = allocs.filter((a) => !onChallan.has(a.id));
        if (!todo.length) throw Problem.conflict(`${o.orderNo} has no plates left to dispatch`, 'nothing-to-dispatch');
        await tx.challanLine.createMany({
          data: todo.map((a) => ({ tenantId: c.tenantId, challanId: c.id, orderId: o.id, allocationId: a.id, laserCode: a.laserCode, position: a.position })),
        });
        await this.orders.transition(tx, o.id, 'DISPATCHED', 'challan-created', {}, `Challan ${challanNo}`);
      }
      await this.bus.publish(tx, { type: 'ChallanCreated', subjectType: SUBJECT.challan, subjectId: c.id, payload: { challanId: c.id, challanNo, dealerId: req.dealerId, orderIds: req.orderIds } });
      return c;
    });
    return this.get(challan.id);
  }

  /** Cancel (and recreate) is the only way to change a challan. Orders go back to STICKER_PRINTED. */
  async cancel(id: string, reason: string) {
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM core_dsp_challan WHERE id = ${id} FOR UPDATE`;
      const c = await tx.challan.findFirst({ where: { id, tenantId: requestContext.tenantId() } });
      if (!c) throw Problem.notFound('Challan');
      if (c.status !== 'CREATED') throw Problem.conflict(`Challan is ${c.status}; only an un-inwarded challan can be cancelled`, 'challan-locked');
      await tx.challan.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date() } });
      const orderIds = [...new Set((await tx.challanLine.findMany({ where: { challanId: id } })).map((l) => l.orderId))];
      for (const oid of orderIds) await this.orders.transition(tx, oid, 'STICKER_PRINTED', 'challan-cancelled', {}, `${c.challanNo}: ${reason}`);
    });
    return this.get(id);
  }

  async list(filter: { status?: string; dealerId?: string; stationId?: string }) {
    const scope = await this.scope.where();
    const where: Prisma.ChallanWhereInput = {
      tenantId: requestContext.tenantId(),
      ...(filter.status ? { status: { in: filter.status.split(',') } } : {}),
      ...(filter.dealerId ? { dealerId: filter.dealerId } : {}),
      ...(filter.stationId ? { stationId: filter.stationId } : {}),
      ...(scope.dealerId ? { dealerId: scope.dealerId } : {}),
      ...(scope.stationId ? { stationId: scope.stationId } : {}),
    };
    const rows = await this.prisma.challan.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    const counts = await this.prisma.challanLine.groupBy({ by: ['challanId'], where: { challanId: { in: rows.map((r) => r.id) } }, _count: true });
    const dealers = await this.masters.dealers([...new Set(rows.map((r) => r.dealerId))]);
    return rows.map((r) => ({ ...r, plates: counts.find((c) => c.challanId === r.id)?._count ?? 0, dealerName: dealers.find((d) => d.id === r.dealerId)?.name }));
  }

  async get(id: string) {
    const scope = await this.scope.where();
    const c = await this.prisma.challan.findFirst({ where: { id, tenantId: requestContext.tenantId(), ...(scope.dealerId ? { dealerId: scope.dealerId } : {}), ...(scope.stationId ? { stationId: scope.stationId } : {}) } });
    if (!c) throw Problem.notFound('Challan');
    const lines = await this.prisma.challanLine.findMany({ where: { challanId: id }, orderBy: [{ orderId: 'asc' }, { position: 'asc' }] });
    const orders = await this.orders.byIds([...new Set(lines.map((l) => l.orderId))]);
    const byId = new Map(orders.map((o) => [o.id, o]));
    return {
      ...c,
      lines: lines.map((l) => ({ ...l, orderNo: byId.get(l.orderId)?.orderNo, regnNo: byId.get(l.orderId)?.regnNo, vehicleClass: byId.get(l.orderId)?.vehicleClass })),
    };
  }

  /** Dealer inward: every line accepted or rejected (reason mandatory). A challan can be inwarded once. */
  async inward(id: string, req: InwardRequest) {
    const challan = await this.get(id);
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM core_dsp_challan WHERE id = ${id} FOR UPDATE`;
      const c = await tx.challan.findUniqueOrThrow({ where: { id } });
      if (c.status === 'INWARDED') throw Problem.conflict(`Challan ${c.challanNo} was already inwarded`, 'already-inwarded');
      if (c.status !== 'CREATED') throw Problem.conflict(`Challan ${c.challanNo} is ${c.status}`, 'challan-cancelled');
      const lines = await tx.challanLine.findMany({ where: { challanId: id } });
      const decided = new Map(req.lines.map((l) => [l.lineId, l]));
      const missing = lines.filter((l) => !decided.has(l.id));
      if (missing.length) throw Problem.badRequest(`Decide every plate: ${missing.map((l) => l.laserCode).join(', ')} not decided`, 'lines-missing');
      const unknown = req.lines.filter((l) => !lines.some((x) => x.id === l.lineId));
      if (unknown.length) throw Problem.badRequest('Some lines are not on this challan', 'lines-unknown');
      for (const d of req.lines) if (d.decision === 'REJECT' && !d.reason?.trim()) throw Problem.badRequest('A reason is mandatory for each rejected plate', 'reason-required');

      for (const l of lines) {
        const d = decided.get(l.id)!;
        await tx.challanLine.update({ where: { id: l.id }, data: { inwardStatus: d.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED', rejectReason: d.decision === 'REJECT' ? d.reason : null } });
      }
      await tx.challan.update({ where: { id }, data: { status: 'INWARDED', inwardedAt: new Date(), inwardedBy: requestContext.actorId() } });

      for (const orderId of [...new Set(lines.map((l) => l.orderId))]) {
        const mine = lines.filter((l) => l.orderId === orderId);
        const rejected = mine.filter((l) => decided.get(l.id)!.decision === 'REJECT');
        if (!rejected.length) {
          await this.orders.transition(tx, orderId, 'INWARDED', 'dealer-inward', {}, `Challan ${c.challanNo}`);
        } else {
          const reason = rejected.map((l) => `${l.position}: ${decided.get(l.id)!.reason}`).join('; ');
          await this.orders.transition(tx, orderId, 'REJECTION_REVIEW', 'dealer-reject', {}, reason);
          await this.rejections.open(tx, { orderId, source: 'DEALER_INWARD', positions: rejected.map((l) => l.position), reason, returnStatus: 'INWARDED', challanId: id });
          await this.bus.publish(tx, { type: 'PlateRejectedByDealer', subjectType: SUBJECT.order, subjectId: orderId, payload: { orderId, challanId: id, positions: rejected.map((l) => l.position), reason } });
        }
      }
      await this.bus.publish(tx, { type: 'ChallanInwarded', subjectType: SUBJECT.challan, subjectId: id, payload: { challanId: id, challanNo: c.challanNo, dealerId: c.dealerId } });
    });
    return this.get(challan.id);
  }

  async pdf(id: string) {
    const c = await this.get(id);
    const [station, dealer] = await Promise.all([this.masters.station(c.stationId), this.masters.dealer(c.dealerId)]);
    return {
      filename: `${c.challanNo}.pdf`,
      pdf: await this.docs.render('challan', { challan: { ...c, date: istDate(c.createdAt), plateCount: c.lines.length }, station, dealer, lines: c.lines }),
    };
  }

  linesForOrder(orderId: string) {
    return this.prisma.challanLine.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  }

  challansByIds(ids: string[]) {
    return this.prisma.challan.findMany({ where: { id: { in: ids } } });
  }
}
