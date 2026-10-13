import { Inject, Injectable } from '@nestjs/common';
import { Order } from '@prisma/client';
import type { IssuanceRequest, QcRequest } from '@hsrp/contracts';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { Problem } from '../../platform/http/problem';
import { AuditService } from '../../utility/audit/audit.service';
import { SettingsService } from '../../utility/configuration/settings.service';
import { DocumentsService } from '../../utility/documents/documents.service';
import { FileService } from '../../utility/file-storage/file.service';
import { EventBus } from '../../utility/integration-hub/event-bus.service';
import { InventoryService } from '../inventory/inventory.service';
import { MastersService } from '../masters/masters.service';
import { ScopeService } from '../masters/scope.service';
import { OrderService } from '../order-intake/order.service';
import { PLATE_READER, PlateReader } from '../ports/plate-reader.port';
import { RejectionService } from '../rejection/rejection.module';
import { judgePlate } from '../shared/plate-ocr';
import { istDate, SUBJECT } from '../shared/subjects';

type PlatePhoto = { buffer: Buffer; mimetype: string; originalname?: string };

/** Job cards, plate allocation from boxes, quality check and sticker printing. */
@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
    private readonly inventory: InventoryService,
    private readonly rejections: RejectionService,
    private readonly masters: MastersService,
    private readonly scope: ScopeService,
    private readonly docs: DocumentsService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
    private readonly files: FileService,
    private readonly settings: SettingsService,
    @Inject(PLATE_READER) private readonly ocr: PlateReader,
  ) {}

  /** The station's own id for station users; any station for staff. */
  async stationFor(requested?: string) {
    const s = await this.scope.current();
    if (s.stationId) {
      if (requested && requested !== s.stationId) throw Problem.forbidden('That is another station');
      return s.stationId;
    }
    if (!s.all) throw Problem.forbidden();
    if (!requested) throw Problem.badRequest('stationId is required', 'station-required');
    return requested;
  }

  async pending(q: { stationId?: string; dealerId?: string; date?: string; vehicleClass?: string; vehicleType?: string }) {
    const stationId = await this.stationFor(q.stationId);
    const until = q.date ? new Date(`${q.date}T23:59:59+05:30`) : undefined;
    const orders = await this.orders.find(
      {
        status: 'CONFIRMED',
        stationId,
        ...(q.dealerId ? { dealerId: q.dealerId } : {}),
        ...(q.vehicleClass ? { vehicleClass: q.vehicleClass } : {}),
        ...(q.vehicleType ? { vehicleType: q.vehicleType } : {}),
        ...(until ? { confirmedAt: { lte: until } } : {}),
      },
      { orderBy: { confirmedAt: 'asc' } },
    );
    const need = new Map<string, number>();
    for (const o of orders) for (const p of o.pendingPositions) {
      const code = (p === 'FRONT' ? o.frontProductCode : o.rearProductCode) ?? '?';
      need.set(code, (need.get(code) ?? 0) + 1);
    }
    return { stationId, orders, platesNeeded: [...need.entries()].map(([productCode, count]) => ({ productCode, count })) };
  }

  /** Allocates plates for the chosen orders from the given boxes and creates a job card. */
  async issue(req: IssuanceRequest) {
    const stationId = await this.stationFor(req.stationId);
    const jobCard = await this.prisma.tx(async (tx) => {
      const orders = await this.orders.byIds(req.orderIds, tx);
      if (orders.length !== req.orderIds.length) throw Problem.notFound('One or more orders');
      for (const o of orders) {
        if (o.status !== 'CONFIRMED') throw Problem.conflict(`${o.orderNo} is ${o.status}, not CONFIRMED`, 'not-confirmed');
        if (o.stationId !== stationId) throw Problem.unprocessable(`${o.orderNo} belongs to another station`, 'wrong-station');
        if (o.dealerId !== req.dealerId) throw Problem.unprocessable(`${o.orderNo} is for another dealer`, 'wrong-dealer');
      }
      await this.inventory.lockBoxes(stationId, req.boxNos, tx);
      const jobCardNo = await this.docs.nextNumber('job-card', tx);
      const card = await tx.jobCard.create({
        data: { tenantId: requestContext.tenantId(), jobCardNo, stationId, dealerId: req.dealerId, orderIds: req.orderIds, boxNos: req.boxNos, plateCount: 0, createdBy: requestContext.actorId() },
      });
      let plates = 0;
      for (const o of orders) {
        const allocated = [];
        for (const position of o.pendingPositions) {
          const productCode = position === 'FRONT' ? o.frontProductCode : o.rearProductCode;
          if (!productCode) throw Problem.unprocessable(`${o.orderNo} has no ${position} product`, 'no-product');
          allocated.push(await this.inventory.allocate(tx, { orderId: o.id, position, productCode, stationId, boxNos: req.boxNos, jobCardId: card.id }));
          plates++;
        }
        await this.orders.update(tx, o.id, { pendingPositions: [] });
        await this.orders.transition(tx, o.id, 'ISSUED', 'plates-allocated', {}, `Job card ${jobCardNo}`);
        await this.bus.publish(tx, {
          type: 'PlateIssued',
          subjectType: SUBJECT.order,
          subjectId: o.id,
          payload: { orderId: o.id, orderNo: o.orderNo, jobCardNo, laserCodes: allocated.map((a) => ({ position: a.position, laserCode: a.laserCode })) },
        });
      }
      await this.inventory.releaseBoxes(req.boxNos, tx);
      return tx.jobCard.update({ where: { id: card.id }, data: { plateCount: plates } });
    });
    return jobCard;
  }

  async jobCards(stationId?: string) {
    const sid = await this.stationFor(stationId).catch(() => stationId);
    return this.prisma.jobCard.findMany({ where: { tenantId: requestContext.tenantId(), ...(sid ? { stationId: sid } : {}) }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async jobCardPdf(id: string) {
    const card = await this.prisma.jobCard.findFirst({ where: { id, tenantId: requestContext.tenantId() } });
    if (!card) throw Problem.notFound('Job card');
    const [station, dealer, orders] = await Promise.all([this.masters.station(card.stationId), this.masters.dealer(card.dealerId), this.orders.byIds(card.orderIds)]);
    const lines = [];
    for (const o of orders) {
      const allocs = (await this.inventory.allocationHistory(o.id)).filter((a) => a.jobCardId === card.id);
      for (const a of allocs) lines.push({ orderNo: o.orderNo, regnNo: o.regnNo, vehicleClass: o.vehicleClass, position: a.position, laserCode: a.laserCode, product: a.position === 'FRONT' ? o.frontProductCode : o.rearProductCode });
    }
    return {
      filename: `${card.jobCardNo}.pdf`,
      pdf: await this.docs.render('job-card', { card: { ...card, date: istDate(card.createdAt), boxes: card.boxNos.join(', ') }, station, dealer, lines }),
    };
  }

  // ------------------------------------------------------------------ quality check

  async qcQueue(stationId?: string) {
    const sid = await this.stationFor(stationId);
    const orders = await this.orders.find({ status: 'ISSUED', stationId: sid });
    return Promise.all(
      orders.map(async (o) => {
        const allocations = await this.inventory.activeAllocations(o.id);
        return { ...o, allocations, photoChecks: await this.latestPhotoChecks(allocations.map((a) => a.id)) };
      }),
    );
  }

  // ------------------------------------------------------------------ plate photo check after embossing (OCR, D45)

  /** The newest OCR check of each given allocation, with a short-lived link to its photo. */
  private async latestPhotoChecks(allocationIds: string[]) {
    const rows = await this.prisma.platePhotoCheck.findMany({ where: { allocationId: { in: allocationIds } }, orderBy: { createdAt: 'desc' } });
    const latest = allocationIds.map((id) => rows.find((r) => r.allocationId === id)).filter(Boolean) as typeof rows;
    return latest.map((r) => ({ ...r, photoUrl: this.files.signedPath(r.fileId) }));
  }

  /** Every OCR check of the order's plates (order detail). */
  photoChecks(orderId: string) {
    return this.prisma.platePhotoCheck.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  }

  /** OCR checks of many orders (reports). */
  photoChecksFor(orderIds: string[]) {
    return this.prisma.platePhotoCheck.findMany({ where: { orderId: { in: orderIds } }, orderBy: { createdAt: 'asc' } });
  }

  /**
   * The station photographs each embossed plate; OCR must read the order's registration number on it. Every
   * attempt is kept. QC can pass the order only when each allocated plate has a passing check.
   */
  async checkPlatePhotos(orderId: string, photos: Partial<Record<'FRONT' | 'REAR', PlatePhoto>>) {
    const order = await this.orders.get(orderId);
    await this.stationFor(order.stationId ?? undefined);
    if (order.status !== 'ISSUED') throw Problem.conflict(`${order.orderNo} is ${order.status}; plate photos are checked after embossing, before QC`, 'not-issued');
    const active = await this.inventory.activeAllocations(orderId);
    const given = active.filter((a) => photos[a.position as 'FRONT' | 'REAR']);
    if (!given.length) throw Problem.badRequest('Attach a photo of each embossed plate (front, rear)', 'photos-required');
    // OCR before the transaction: it is local but takes a moment per photo.
    const read: Array<{ a: (typeof active)[number]; f: PlatePhoto; reading: Awaited<ReturnType<PlateReader['read']>>; judged: ReturnType<typeof judgePlate> }> = [];
    for (const a of given) {
      const f = photos[a.position as 'FRONT' | 'REAR']!;
      if (!/^image\//.test(f.mimetype)) throw Problem.badRequest(`The ${a.position.toLowerCase()} photo must be an image`, 'photo-type');
      const reading = await this.ocr.read(f.buffer, f.mimetype);
      read.push({ a, f, reading, judged: judgePlate(order.regnNo, reading) });
    }
    const tenantId = requestContext.tenantId();
    const rows = await this.prisma.tx(async (tx) => {
      const out = [];
      for (const r of read) {
        const kind = r.a.position.toLowerCase();
        const file = await this.files.upload(
          { data: r.f.buffer, filename: r.f.originalname || `${kind}.jpg`, mimeType: r.f.mimetype, purpose: `emboss-${kind}`, ownerSubjectType: SUBJECT.order, ownerSubjectId: order.id, retentionDays: 3650 },
          tx,
        );
        out.push(
          await tx.platePhotoCheck.create({
            data: {
              tenantId,
              orderId,
              allocationId: r.a.id,
              laserCode: r.a.laserCode,
              position: r.a.position,
              fileId: file.id,
              expected: order.regnNo,
              readText: r.reading.text,
              confidence: r.reading.confidence,
              engine: r.reading.engine,
              result: r.judged.result,
              reason: r.judged.reason,
              actorId: requestContext.actorId(),
            },
          }),
        );
      }
      await this.audit.record(
        { action: 'qc.plate-photos', subjectType: SUBJECT.order, subjectId: orderId, after: out.map((c) => ({ position: c.position, laserCode: c.laserCode, read: c.readText, result: c.result })) },
        tx,
      );
      await this.bus.publish(tx, {
        type: 'PlatePhotosChecked',
        subjectType: SUBJECT.order,
        subjectId: orderId,
        payload: { orderId, orderNo: order.orderNo, checks: out.map((c) => ({ position: c.position, result: c.result, read: c.readText })) },
      });
      return out;
    });
    return { orderNo: order.orderNo, regnNo: order.regnNo, checks: rows.map((r) => ({ ...r, photoUrl: this.files.signedPath(r.fileId) })) };
  }

  async qc(orderId: string, req: QcRequest) {
    const order = await this.orders.get(orderId);
    await this.stationFor(order.stationId ?? undefined);
    if (order.status !== 'ISSUED') throw Problem.conflict(`${order.orderNo} is ${order.status}; QC needs ISSUED`, 'not-issued');
    return this.prisma.tx(async (tx) => {
      const tenantId = requestContext.tenantId();
      if (req.result === 'PASS') {
        if (await this.settings.getOr('production.plateOcrRequired', true, [{ type: 'state', id: order.stateCode }])) {
          const active = await this.inventory.activeAllocations(orderId, tx);
          const passed = await tx.platePhotoCheck.findMany({ where: { allocationId: { in: active.map((a) => a.id) }, result: 'PASS' }, select: { allocationId: true } });
          const missing = active.filter((a) => !passed.some((p) => p.allocationId === a.id)).map((a) => a.position.toLowerCase());
          if (missing.length) {
            throw Problem.conflict(`Plate photo check (OCR) has not passed for the ${missing.join(' and ')} plate: upload a photo that reads ${order.regnNo}`, 'plate-ocr-required');
          }
        }
        await tx.qcRecord.create({ data: { tenantId, orderId, result: 'PASS', positions: [], actorId: requestContext.actorId() } });
        await this.orders.transition(tx, orderId, 'QC_PASSED', 'qc-pass');
        await this.bus.publish(tx, { type: 'QcPassed', subjectType: SUBJECT.order, subjectId: orderId, payload: { orderId, orderNo: order.orderNo } });
        if (!order.stickerRequired) return this.orders.transition(tx, orderId, 'STICKER_PRINTED', 'sticker-not-required');
        return this.orders.get(orderId, tx);
      }
      const positions = [...new Set(req.rejectPositions ?? [])];
      if (!positions.length) throw Problem.badRequest('Choose the rejected plate(s): FRONT, REAR or both', 'positions-required');
      if (!req.reason?.trim()) throw Problem.badRequest('A rejection reason is mandatory', 'reason-required');
      const active = await this.inventory.activeAllocations(orderId, tx);
      const missing = positions.filter((p) => !active.some((a) => a.position === p));
      if (missing.length) throw Problem.unprocessable(`No plate allocated for ${missing.join(', ')}`, 'position-not-allocated');
      await tx.qcRecord.create({ data: { tenantId, orderId, result: 'REJECT', positions, reason: req.reason, actorId: requestContext.actorId() } });
      await this.orders.transition(tx, orderId, 'REJECTION_REVIEW', 'qc-reject', {}, req.reason);
      await this.rejections.open(tx, { orderId, source: 'QC', positions, reason: req.reason, returnStatus: 'QC_PASSED' });
      await this.bus.publish(tx, { type: 'QcRejected', subjectType: SUBJECT.order, subjectId: orderId, payload: { orderId, orderNo: order.orderNo, positions, reason: req.reason } });
      return this.orders.get(orderId, tx);
    });
  }

  async switchLaser(orderId: string, input: { position: string; newLaserCode: string; reason: string }) {
    const order = await this.orders.get(orderId);
    const stationId = await this.stationFor(order.stationId ?? undefined);
    if (order.status !== 'ISSUED') throw Problem.conflict('Laser codes can be switched during QC only (status ISSUED)', 'not-issued');
    const productCode = input.position === 'FRONT' ? order.frontProductCode : order.rearProductCode;
    return this.prisma.tx((tx) => this.inventory.switchLaser(tx, { orderId, position: input.position, newLaserCode: input.newLaserCode, reason: input.reason, stationId, productCode: productCode! }));
  }

  // ------------------------------------------------------------------ stickers

  async stickerQueue(stationId?: string) {
    const sid = await this.stationFor(stationId);
    return this.orders.find({ status: 'QC_PASSED', stationId: sid, stickerRequired: true });
  }

  /** First print moves QC_PASSED → STICKER_PRINTED. Reprints need a first print and a reason; all are logged. */
  async printSticker(orderId: string, req: { reprint: boolean; reason?: string }) {
    const order = await this.orders.get(orderId);
    await this.stationFor(order.stationId ?? undefined);
    const printNo = await this.prisma.tx(async (tx) => {
      const prints = await tx.stickerPrint.count({ where: { orderId } });
      if (req.reprint) {
        if (prints === 0) throw Problem.conflict('Reprint is allowed only after the first print', 'no-first-print');
        if (!req.reason?.trim()) throw Problem.badRequest('Give a reason for the reprint', 'reason-required');
        if (order.status === 'QC_PASSED') throw Problem.conflict('This order has a new plate waiting for its first print; use Print, not Reprint', 'first-print-pending');
      } else if (order.status !== 'QC_PASSED') {
        throw Problem.conflict(`${order.orderNo} is ${order.status}; the first print needs QC_PASSED`, 'not-qc-passed');
      }
      await tx.stickerPrint.create({ data: { tenantId: requestContext.tenantId(), orderId, printNo: prints + 1, reprint: req.reprint, reason: req.reason, actorId: requestContext.actorId() } });
      if (!req.reprint) {
        await this.orders.transition(tx, orderId, 'STICKER_PRINTED', 'sticker-printed');
        await this.bus.publish(tx, { type: 'StickerPrinted', subjectType: SUBJECT.order, subjectId: orderId, payload: { orderId, orderNo: order.orderNo, printNo: prints + 1 } });
      } else {
        await this.audit.record({ action: 'sticker.reprint', subjectType: SUBJECT.order, subjectId: orderId, after: { printNo: prints + 1, reason: req.reason } }, tx);
      }
      return prints + 1;
    });
    return { filename: `sticker-${order.regnNo}-${printNo}.pdf`, pdf: await this.stickerPdf(order, printNo, req.reprint) };
  }

  private async stickerPdf(order: Order, printNo: number, reprint: boolean) {
    const allocs = await this.inventory.activeAllocations(order.id);
    const state = await this.masters.state(order.stateCode);
    return this.docs.render('sticker', {
      ...order,
      stateName: state.name,
      front: allocs.find((a) => a.position === 'FRONT')?.laserCode ?? '-',
      rear: allocs.find((a) => a.position === 'REAR')?.laserCode ?? '-',
      printLabel: reprint ? `REPRINT #${printNo}` : `PRINT #${printNo}`,
      fuelLabel: (order.fuel ?? '').toUpperCase(),
    });
  }

  stickerPrints(orderId: string) {
    return this.prisma.stickerPrint.findMany({ where: { orderId }, orderBy: { printNo: 'asc' } });
  }

  qcRecords(orderId: string) {
    return this.prisma.qcRecord.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  }

  qcRecordsFor(orderIds: string[]) {
    return this.prisma.qcRecord.findMany({ where: { orderId: { in: orderIds } }, orderBy: { createdAt: 'asc' } });
  }

  jobCardsByIds(ids: string[]) {
    return this.prisma.jobCard.findMany({ where: { id: { in: ids } }, select: { id: true, jobCardNo: true, createdAt: true } });
  }
}
