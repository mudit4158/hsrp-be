import { Controller, Get, Injectable, Module, OnModuleInit, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService, Tx } from '../../platform/database/prisma.service';
import { NonRetryableError } from '../../platform/http/problem';
import { RequirePermission } from '../../platform/http/decorators';
import { ApprovalsService } from '../../utility/approvals/approvals.service';
import { DeliveredEvent, EventBus } from '../../utility/integration-hub/event-bus.service';
import { InventoryModule } from '../inventory/inventory.module';
import { InventoryService } from '../inventory/inventory.service';
import { MastersModule } from '../masters/masters.module';
import { MastersService } from '../masters/masters.service';
import { ScopeService } from '../masters/scope.service';
import { OrderIntakeModule } from '../order-intake/order-intake.module';
import { OrderService } from '../order-intake/order.service';
import { APPROVAL, SUBJECT } from '../shared/subjects';

/**
 * Rejection cases from QC or dealer inward. The station decides through the Approvals utility
 * (remarks mandatory). Approve: rejected plates are scrapped, only those positions are re-issued.
 * Disapprove: the order returns to the stage it would have reached.
 */
@Injectable()
export class RejectionService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
    private readonly inventory: InventoryService,
    private readonly masters: MastersService,
    private readonly approvals: ApprovalsService,
    private readonly bus: EventBus,
  ) {}

  onModuleInit() {
    this.bus.subscribe('ApprovalDecided', 'rejection.decided', (e) => this.onDecided(e));
  }

  async open(tx: Tx, input: { orderId: string; source: 'QC' | 'DEALER_INWARD'; positions: string[]; reason: string; returnStatus: 'QC_PASSED' | 'INWARDED'; challanId?: string }) {
    const order = await this.orders.get(input.orderId, tx);
    const station = order.stationId ? await this.masters.station(order.stationId, tx) : null;
    const c = await tx.rejectionCase.create({
      data: { tenantId: requestContext.tenantId(), orderId: order.id, stationId: order.stationId, source: input.source, positions: input.positions, reason: input.reason, returnStatus: input.returnStatus, challanId: input.challanId },
    });
    const allocations = await this.inventory.activeAllocations(order.id, tx);
    const appr = await this.approvals.request(
      {
        type: APPROVAL.plateRejection,
        subjectType: SUBJECT.rejection,
        subjectId: c.id,
        requiredRole: 'STATION_USER',
        scopeOrgId: station?.orgId,
        title: `${input.source === 'QC' ? 'QC' : 'Dealer'} rejection · ${order.orderNo} · ${input.positions.join(' + ')}`,
        details: {
          orderId: order.id,
          orderNo: order.orderNo,
          regnNo: order.regnNo,
          source: input.source,
          positions: input.positions,
          reason: input.reason,
          laserCodes: allocations.filter((a) => input.positions.includes(a.position)).map((a) => `${a.position}: ${a.laserCode}`),
        },
      },
      tx,
    );
    await tx.rejectionCase.update({ where: { id: c.id }, data: { approvalId: appr.id } });
    return c;
  }

  private async onDecided(e: DeliveredEvent) {
    if (e.payload.approvalType !== APPROVAL.plateRejection) return;
    const c = await this.prisma.rejectionCase.findUnique({ where: { id: String(e.payload.subjectId) } });
    if (!c) throw new NonRetryableError('Rejection case not found');
    if (c.status !== 'PENDING') return;
    const approved = e.payload.decision === 'APPROVED';
    await this.prisma.tx(async (tx) => {
      await tx.rejectionCase.update({
        where: { id: c.id },
        data: { status: approved ? 'APPROVED' : 'DISAPPROVED', decidedBy: String(e.payload.decidedBy), remarks: String(e.payload.remarks), decidedAt: new Date() },
      });
      const order = await this.orders.get(c.orderId, tx);
      if (approved) {
        const closed = await this.inventory.closePositions(tx, c.orderId, c.positions, `REJECTED (${c.source}): ${c.reason}`, 'SCRAPPED');
        await this.orders.update(tx, c.orderId, { pendingPositions: c.positions });
        await this.orders.transition(tx, c.orderId, 'CONFIRMED', 'rejection-approved', {}, `Re-issue ${c.positions.join(' + ')}: ${e.payload.remarks}`);
        await this.bus.publish(tx, {
          type: 'RejectionApproved',
          subjectType: SUBJECT.order,
          subjectId: c.orderId,
          payload: { orderId: c.orderId, orderNo: order.orderNo, caseId: c.id, positions: c.positions, scrapped: closed.map((a) => a.laserCode) },
        });
      } else {
        await this.orders.transition(tx, c.orderId, c.returnStatus as 'QC_PASSED' | 'INWARDED', 'rejection-disapproved', {}, String(e.payload.remarks));
        if (c.returnStatus === 'QC_PASSED' && !order.stickerRequired) {
          await this.orders.transition(tx, c.orderId, 'STICKER_PRINTED', 'sticker-not-required');
        }
        await this.bus.publish(tx, { type: 'RejectionDisapproved', subjectType: SUBJECT.order, subjectId: c.orderId, payload: { orderId: c.orderId, orderNo: order.orderNo, caseId: c.id } });
      }
    });
  }

  list(where: Prisma.RejectionCaseWhereInput) {
    return this.prisma.rejectionCase.findMany({ where: { tenantId: requestContext.tenantId(), ...where }, orderBy: { createdAt: 'desc' }, take: 300 });
  }

  forOrder(orderId: string) {
    return this.prisma.rejectionCase.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  }
}

@ApiTags('rejections')
@Controller('rejections')
export class RejectionController {
  constructor(
    private readonly rejections: RejectionService,
    private readonly scope: ScopeService,
    private readonly orders: OrderService,
  ) {}

  /** Rejection approval queue, enriched with the order. Decide through POST /approvals/:approvalId/decision. */
  @Get()
  @RequirePermission('approvals.read', 'station.operate')
  async list(@Query('status') status?: string) {
    const s = await this.scope.current();
    const cases = await this.rejections.list({ ...(status ? { status } : {}), ...(s.stationId ? { stationId: s.stationId } : {}) });
    const orders = await this.orders.byIds([...new Set(cases.map((c) => c.orderId))]);
    const byId = new Map(orders.map((o) => [o.id, o]));
    return cases.map((c) => ({ ...c, orderNo: byId.get(c.orderId)?.orderNo, regnNo: byId.get(c.orderId)?.regnNo, orderStatus: byId.get(c.orderId)?.status }));
  }
}

@Module({
  imports: [MastersModule, InventoryModule, OrderIntakeModule],
  controllers: [RejectionController],
  providers: [RejectionService],
  exports: [RejectionService],
})
export class RejectionModule {}
