import { Injectable } from '@nestjs/common';
import { Problem } from '../../platform/http/problem';
import { ApprovalsService } from '../../utility/approvals/approvals.service';
import { AuditService } from '../../utility/audit/audit.service';
import { FileService } from '../../utility/file-storage/file.service';
import { IdentityService } from '../../utility/identity/identity.service';
import { ImportService } from '../../utility/import-export/import.service';
import { CallLogService } from '../../utility/integration-hub/call-log.service';
import { EventBus } from '../../utility/integration-hub/event-bus.service';
import { PaymentsService } from '../../utility/payments/payments.service';
import { TicketsService } from '../../utility/tickets/tickets.service';
import { WalletService } from '../../utility/wallet/wallet.service';
import { BookingService } from '../booking/booking.module';
import { DispatchService } from '../dispatch/dispatch.service';
import { FitmentService } from '../fitment/fitment.service';
import { InventoryService } from '../inventory/inventory.service';
import { MastersService } from '../masters/masters.service';
import { ScopeService } from '../masters/scope.service';
import { BillingService } from '../billing/billing.service';
import { OemVehicleDataService } from '../order-intake/oem-vehicle-data.service';
import { OrderService } from '../order-intake/order.service';
import { ProductionService } from '../production/production.service';
import { RejectionService } from '../rejection/rejection.module';
import { istDate, SUBJECT } from '../shared/subjects';

/** Read-side composition across core modules: dashboard, order detail and dealer home. Owns no tables. */
@Injectable()
export class OversightService {
  constructor(
    readonly orders: OrderService,
    readonly inventory: InventoryService,
    readonly fitment: FitmentService,
    readonly dispatch: DispatchService,
    readonly production: ProductionService,
    readonly rejections: RejectionService,
    readonly booking: BookingService,
    readonly masters: MastersService,
    readonly scope: ScopeService,
    readonly approvals: ApprovalsService,
    readonly payments: PaymentsService,
    readonly tickets: TicketsService,
    readonly wallets: WalletService,
    readonly files: FileService,
    readonly audit: AuditService,
    readonly bus: EventBus,
    readonly oemData: OemVehicleDataService,
    readonly imports: ImportService,
    readonly calls: CallLogService,
    readonly identity: IdentityService,
    readonly billing: BillingService,
  ) {}

  async dashboard() {
    const s = await this.scope.current();
    const where = s.stationId ? { stationId: s.stationId } : s.dealerId ? { dealerId: s.dealerId } : {};
    const today = new Date(`${istDate()}T00:00:00+05:30`);
    const [byStatus, ageing, fit, stock, tickets, overdue, deliveries, approvals, ordersToday] = await Promise.all([
      this.orders.countByStatus(where),
      this.orders.ageing(where),
      this.fitment.counts(),
      this.inventory.stockByStation(),
      this.tickets.list({ status: 'OPEN,IN_PROGRESS', page: 1, pageSize: 1 }),
      this.tickets.list({ overdue: true, page: 1, pageSize: 1 }),
      this.bus.stats(),
      this.approvals.list({ status: 'PENDING', pageSize: 500 }),
      this.orders.rawQuery({ ...where, createdAt: { gte: today } }, { id: true }),
    ]);
    return {
      ordersByStatus: byStatus,
      ordersToday: ordersToday.length,
      ordersOpen: Object.entries(byStatus).filter(([k]) => !['COMPLETED', 'REJECTED', 'CANCELLED'].includes(k)).reduce((n, [, v]) => n + v, 0),
      ageing,
      fitments: fit,
      stock: stock.filter((x) => !s.stationId || x.stationId === s.stationId).map((x) => ({ station: `${x.stationCode} · ${x.stationName}`, ...x.totals })),
      complaints: { open: tickets.total, overdue: overdue.total },
      approvalsPending: approvals.reduce<Record<string, number>>((m, a) => ({ ...m, [a.type]: (m[a.type] ?? 0) + 1 }), {}),
      integration: deliveries,
    };
  }

  async orderDetail(id: string) {
    const order = await this.orders.getScoped(id);
    const [history, validations, allocations, lines, fitment, qc, prints, rejections, approvals, payments, booking, audit, events, files] = await Promise.all([
      this.orders.history(id),
      this.orders.validations(id),
      this.inventory.allocationHistory(id),
      this.dispatch.linesForOrder(id),
      this.fitment.forOrder(id),
      this.production.qcRecords(id),
      this.production.stickerPrints(id),
      this.rejections.forOrder(id),
      this.approvals.forSubject(SUBJECT.order, id),
      this.payments.forSubject(SUBJECT.order, id),
      this.booking.forOrder(id),
      this.audit.forSubject(SUBJECT.order, id),
      this.bus.eventsFor(SUBJECT.order, id),
      this.files.listFor(SUBJECT.order, id),
    ]);
    const rejectionApprovals = (await Promise.all(rejections.map((r) => this.approvals.forSubject(SUBJECT.rejection, r.id)))).flat();
    const [embossChecks, fitmentChecks, billing] = await Promise.all([this.production.photoChecks(id), this.fitment.photoChecks([id]), this.billing.forOrder(id)]);
    const challans = await this.dispatch.challansByIds([...new Set(lines.map((l) => l.challanId))]);
    const dealer = order.dealerId ? await this.masters.dealer(order.dealerId) : null;
    const station = order.stationId ? await this.masters.station(order.stationId) : null;
    const link = (fid?: string | null) => (fid ? this.files.signedPath(fid) : null);
    return {
      order,
      dealer: dealer && { id: dealer.id, code: dealer.code, name: dealer.name, city: dealer.city },
      station: station && { id: station.id, code: station.code, name: station.name },
      history,
      validations,
      allocations,
      challanLines: lines.map((l) => ({ ...l, challanNo: challans.find((c) => c.id === l.challanId)?.challanNo, challanStatus: challans.find((c) => c.id === l.challanId)?.status })),
      fitment: fitment && { ...fitment, frontPhotoUrl: link(fitment.frontPhotoId), rearPhotoUrl: link(fitment.rearPhotoId), chassisPhotoUrl: link(fitment.chassisPhotoId) },
      qc,
      // OCR of plate photos (D45): after embossing (station) and at fitment (dealer), refused attempts included.
      plateChecks: [
        ...embossChecks.map((c) => ({ ...c, stage: 'EMBOSSING', photoUrl: link(c.fileId) })),
        ...fitmentChecks.map((c) => ({ ...c, stage: 'FITMENT', laserCode: null, photoUrl: link(c.fileId) })),
      ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      stickerPrints: prints,
      // Postpaid OEM orders (D46): the charge and the bill that took it.
      billing,
      rejections,
      approvals: [...approvals, ...rejectionApprovals],
      payments,
      booking,
      files: files.map((f) => ({ id: f.id, filename: f.filename, purpose: f.purpose, mimeType: f.mimeType, url: link(f.id) })),
      audit,
      events: events.map((e) => ({ id: e.id, type: e.eventType, at: e.occurredAt, payload: e.payload })),
    };
  }

  async dealerHome() {
    const dealerId = await this.scope.dealerId();
    const dealer = await this.masters.dealer(dealerId);
    const [byStatus, challans, appointments, wallet] = await Promise.all([
      this.orders.countByStatus({ dealerId }),
      this.dispatch.list({ status: 'CREATED' }),
      this.booking.appointments(dealerId, istDate()),
      dealer.walletAccountId ? this.wallets.summary(dealer.walletAccountId) : null,
    ]);
    return {
      dealer: { id: dealer.id, code: dealer.code, name: dealer.name, city: dealer.city, stateCode: dealer.stateCode },
      counts: {
        toInward: challans.length,
        toFit: byStatus.INWARDED ?? 0,
        awaitingVahan: byStatus.FITTED ?? 0,
        inProduction: ['CONFIRMED', 'ISSUED', 'QC_PASSED', 'STICKER_PRINTED', 'DISPATCHED'].reduce((n, k) => n + (byStatus[k] ?? 0), 0),
        rejectionReview: byStatus.REJECTION_REVIEW ?? 0,
        completed: byStatus.COMPLETED ?? 0,
      },
      ordersByStatus: byStatus,
      appointments,
      wallet,
    };
  }

  async dealerWallet() {
    const dealer = await this.masters.dealer(await this.scope.dealerId());
    if (!dealer.walletAccountId) throw Problem.notFound('Wallet');
    return { summary: await this.wallets.summary(dealer.walletAccountId), statement: await this.wallets.statement(dealer.walletAccountId, 1, 30) };
  }
}
