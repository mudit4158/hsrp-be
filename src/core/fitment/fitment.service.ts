import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { FitmentRequest } from '@hsrp/contracts';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { NonRetryableError, Problem } from '../../platform/http/problem';
import { SettingsService } from '../../utility/configuration/settings.service';
import { FileService } from '../../utility/file-storage/file.service';
import { CallLogService } from '../../utility/integration-hub/call-log.service';
import { DeliveredEvent, EventBus } from '../../utility/integration-hub/event-bus.service';
import { NotificationService } from '../../utility/notification/notification.service';
import { InventoryService } from '../inventory/inventory.service';
import { ScopeService } from '../masters/scope.service';
import { positionsOf } from '../order-intake/order-state-machine';
import { OrderService } from '../order-intake/order.service';
import { PLATE_READER, PlateReader } from '../ports/plate-reader.port';
import { VEHICLE_REGISTRY, VehicleRegistry } from '../ports/vehicle-registry.port';
import { judgePlate } from '../shared/plate-ocr';
import { istDate, istDmy, SUBJECT } from '../shared/subjects';
import { parseFitmentReply } from './vahan-reply';

export interface PhotoRules {
  front: boolean;
  rear: boolean;
  chassis: boolean;
}

export interface FitmentPhotos {
  front?: Express.Multer.File;
  rear?: Express.Multer.File;
  chassis?: Express.Multer.File;
}

/** Fitment record with photos and confirmed laser codes, then the VAHAN post from the outbox. */
@Injectable()
export class FitmentService implements OnModuleInit {
  private readonly log = new Logger('Fitment');
  private lastEodAlert = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
    private readonly inventory: InventoryService,
    private readonly scope: ScopeService,
    private readonly files: FileService,
    private readonly settings: SettingsService,
    private readonly notify: NotificationService,
    private readonly calls: CallLogService,
    private readonly bus: EventBus,
    @Inject(VEHICLE_REGISTRY) private readonly vahan: VehicleRegistry,
    @Inject(PLATE_READER) private readonly ocr: PlateReader,
  ) {}

  onModuleInit() {
    this.bus.subscribe('FitmentRecorded', 'fitment.vahan-post', (e) => this.postToVahan(e), { maxAttempts: 10 });
  }

  async photoRules(stateCode: string): Promise<PhotoRules> {
    return this.settings.getOr<PhotoRules>('fitment.photoRules', { front: true, rear: true, chassis: false }, [{ type: 'state', id: stateCode }]);
  }

  /** Dealer app search by registration number: the order, its laser codes and the photo rules. */
  async search(regnNo: string) {
    const s = await this.scope.current();
    const orders = await this.orders.find(
      { regnNo: regnNo.trim().toUpperCase(), ...(s.dealerId ? { dealerId: s.dealerId } : {}), status: { in: ['INWARDED', 'FITTED', 'COMPLETED', 'DISPATCHED'] } },
      { orderBy: { createdAt: 'desc' }, take: 5 },
    );
    return Promise.all(
      orders.map(async (o) => ({
        order: o,
        allocations: (await this.inventory.activeAllocations(o.id)).map((a) => ({ position: a.position, laserCode: a.laserCode })),
        photoRules: await this.photoRules(o.stateCode),
        fitment: await this.prisma.fitment.findUnique({ where: { orderId: o.id } }),
        canRecord: o.status === 'INWARDED',
      })),
    );
  }

  async record(input: FitmentRequest, photos: FitmentPhotos) {
    const order = await this.orders.getScoped(input.orderId);
    const s = await this.scope.current();
    if (!s.dealerId && !s.all) throw Problem.forbidden('Only the fitting dealer can record fitment');
    const existing = await this.prisma.fitment.findUnique({ where: { orderId: order.id } });
    if (existing) throw Problem.conflict(`Fitment for ${order.orderNo} was already recorded`, 'fitment-exists', { fitmentId: existing.id });
    if (order.status !== 'INWARDED') throw Problem.conflict(`${order.orderNo} is ${order.status}; fitment needs INWARDED plates`, 'not-inwarded');

    const allocs = await this.inventory.activeAllocations(order.id);
    const front = allocs.find((a) => a.position === 'FRONT');
    const rear = allocs.find((a) => a.position === 'REAR');
    if (front && input.frontLaserCode !== front.laserCode) throw Problem.unprocessable(`Front laser code does not match the allocated ${front.laserCode}`, 'laser-mismatch');
    if (rear && input.rearLaserCode !== rear.laserCode) throw Problem.unprocessable(`Rear laser code does not match the allocated ${rear.laserCode}`, 'laser-mismatch');

    const rules = await this.photoRules(order.stateCode);
    const positions = positionsOf(order.plateSet);
    const missing = [
      rules.front && positions.includes('FRONT') && !photos.front ? 'front plate photo' : null,
      rules.rear && positions.includes('REAR') && !photos.rear ? 'rear plate photo' : null,
      rules.chassis && !photos.chassis ? 'chassis photo' : null,
    ].filter(Boolean);
    if (missing.length) throw Problem.badRequest(`Missing ${missing.join(', ')}`, 'photos-required');
    if ((await this.settings.flag('mobileHoldBeforeFitment', [{ type: 'state', id: order.stateCode }])) && !order.mobile) {
      throw Problem.unprocessable('This state holds fitment until the owner mobile number is on the order', 'mobile-hold');
    }

    const fittedAt = input.fittedAt ? new Date(input.fittedAt) : new Date();
    if (fittedAt.getTime() > Date.now() + 5 * 60_000) throw Problem.badRequest('Fitment time is in the future', 'fitted-at');

    // OCR (D45): each plate photo must read the order's registration number, or the fitment is refused.
    const ocrOn = await this.settings.getOr('fitment.plateOcrRequired', true, [{ type: 'state', id: order.stateCode }]);
    const plates = (
      [
        ['FRONT', photos.front],
        ['REAR', photos.rear],
      ] as const
    ).filter(([pos, f]) => f && positions.includes(pos)) as Array<[ 'FRONT' | 'REAR', Express.Multer.File ]>;
    const checks = ocrOn ? await Promise.all(plates.map(async ([position, f]) => ({ position, reading: await this.ocr.read(f.buffer, f.mimetype) }))) : [];
    const judged = checks.map((c) => ({ ...c, ...judgePlate(order.regnNo, c.reading) }));
    const checkRow = (c: (typeof judged)[number], fileId: string | null, fitmentId: string | null) => ({
      tenantId: requestContext.tenantId(),
      orderId: order.id,
      fitmentId,
      position: c.position,
      fileId,
      expected: order.regnNo,
      readText: c.reading.text,
      confidence: c.reading.confidence,
      engine: c.reading.engine,
      result: c.result,
      reason: c.reason,
      actorId: requestContext.actorId(),
      deviceId: requestContext.get().deviceId,
    });
    const failed = judged.filter((c) => c.result === 'FAIL');
    if (failed.length) {
      // Keep the refused attempt (photos and readings) for the audit trail, then refuse the fitment.
      await this.prisma.tx(async (tx) => {
        for (const c of judged) {
          const f = c.position === 'FRONT' ? photos.front! : photos.rear!;
          const file = await this.files.upload(
            { data: f.buffer, filename: f.originalname || `${c.position.toLowerCase()}.jpg`, mimeType: f.mimetype, purpose: `fitment-refused-${c.position.toLowerCase()}`, ownerSubjectType: SUBJECT.order, ownerSubjectId: order.id, retentionDays: 3650 },
            tx,
          );
          await tx.fitmentPhotoCheck.create({ data: checkRow(c, file.id, null) });
        }
      });
      throw Problem.unprocessable(
        `Fitment refused: ${failed.map((c) => `${c.position.toLowerCase()} plate photo: ${c.reason}`).join('; ')}. Take the photos again.`,
        'plate-ocr-mismatch',
      );
    }

    const fitment = await this.prisma.tx(async (tx) => {
      const up = async (f: Express.Multer.File | undefined, kind: string) =>
        f ? (await this.files.upload({ data: f.buffer, filename: f.originalname || `${kind}.jpg`, mimeType: f.mimetype, purpose: `fitment-${kind}`, ownerSubjectType: SUBJECT.order, ownerSubjectId: order.id, retentionDays: 3650 }, tx)).id : null;
      const row = await tx.fitment.create({
        data: {
          tenantId: requestContext.tenantId(),
          orderId: order.id,
          dealerId: order.dealerId!,
          frontLaserCode: front?.laserCode,
          rearLaserCode: rear?.laserCode,
          frontPhotoId: await up(photos.front, 'front'),
          rearPhotoId: await up(photos.rear, 'rear'),
          chassisPhotoId: await up(photos.chassis, 'chassis'),
          fittedAt,
          recordedBy: requestContext.actorId(),
          deviceId: requestContext.get().deviceId,
          latitude: input.latitude,
          longitude: input.longitude,
        },
      });
      for (const c of judged) await tx.fitmentPhotoCheck.create({ data: checkRow(c, c.position === 'FRONT' ? row.frontPhotoId : row.rearPhotoId, row.id) });
      await this.inventory.markFitted(tx, order.id);
      await this.orders.transition(tx, order.id, 'FITTED', 'fitment-recorded');
      await this.bus.publish(tx, { type: 'FitmentRecorded', subjectType: SUBJECT.order, subjectId: order.id, payload: { orderId: order.id, orderNo: order.orderNo, fitmentId: row.id } });
      return row;
    });
    return { ...fitment, orderNo: order.orderNo, status: 'FITTED' };
  }

  /** Outbox subscriber: posts the fitment to VAHAN. Down → retry; known failure → manual queue; unknown text → retry then manual. */
  private async postToVahan(e: DeliveredEvent) {
    const f = await this.prisma.fitment.findUnique({ where: { id: String(e.payload.fitmentId) } });
    if (!f) throw new NonRetryableError('Fitment not found');
    if (f.vahanStatus === 'POSTED') return;
    const order = await this.orders.get(f.orderId);
    const req = {
      regnNO: order.regnNo,
      chasisNo: order.chassisNo,
      ordertype: order.orderType,
      hsrpFrontLaserCode: f.frontLaserCode ?? '',
      hsrpRearLaserCode: f.rearLaserCode ?? '',
      fixationdate: istDmy(f.fittedAt),
    };
    let reply: string;
    try {
      reply = await this.calls.track({ system: 'VAHAN', operation: 'recordFitment', subjectType: SUBJECT.order, subjectId: order.id, request: req }, () => this.vahan.recordFitment(req));
    } catch (err) {
      // VAHAN down or slow: keep the order FITTED and let the outbox retry with back-off.
      await this.prisma.fitment.update({ where: { id: f.id }, data: { vahanStatus: 'RETRYING', vahanReply: (err as Error).message } });
      throw err;
    }
    const outcome = parseFitmentReply(reply);
    if (outcome === 'FAILED') {
      await this.prisma.fitment.update({ where: { id: f.id }, data: { vahanStatus: 'MANUAL', vahanReply: reply } });
      throw new NonRetryableError(`VAHAN refused the fitment: ${reply}`);
    }
    if (outcome === 'UNKNOWN') {
      await this.prisma.fitment.update({ where: { id: f.id }, data: { vahanStatus: e.attempt >= 10 ? 'MANUAL' : 'RETRYING', vahanReply: reply } });
      throw new Error(`Unrecognised VAHAN reply: ${reply.slice(0, 200)}`);
    }
    await this.prisma.tx(async (tx) => {
      await tx.fitment.update({ where: { id: f.id }, data: { vahanStatus: 'POSTED', vahanReply: reply, postedAt: new Date() } });
      await this.orders.transition(tx, order.id, 'COMPLETED', 'vahan-posted', { completedAt: new Date() });
      await this.bus.publish(tx, { type: 'FitmentPosted', subjectType: SUBJECT.order, subjectId: order.id, payload: { orderId: order.id, orderNo: order.orderNo, reply } });
      if (order.mobile) {
        await this.notify.send({ templateCode: 'FITMENT_DONE', channel: 'SMS', recipient: order.mobile, variables: { regnNo: order.regnNo, orderNo: order.orderNo }, subjectType: SUBJECT.order, subjectId: order.id }, tx);
      }
    });
  }

  /** OCR readings of fitment photos, refused attempts included (order detail, reports). */
  photoChecks(orderIds: string[]) {
    return this.prisma.fitmentPhotoCheck.findMany({ where: { orderId: { in: orderIds } }, orderBy: { createdAt: 'asc' } });
  }

  forOrder(orderId: string) {
    return this.prisma.fitment.findUnique({ where: { orderId } });
  }

  forOrders(orderIds: string[]) {
    return this.prisma.fitment.findMany({ where: { orderId: { in: orderIds } } });
  }

  pendingVahan() {
    return this.prisma.fitment.findMany({ where: { tenantId: requestContext.tenantId(), vahanStatus: { not: 'POSTED' } }, orderBy: { fittedAt: 'asc' }, take: 500 });
  }

  async counts() {
    const tenantId = requestContext.tenantId();
    const today = new Date(`${istDate()}T00:00:00+05:30`);
    const [fittedToday, pendingVahan, manual] = await Promise.all([
      this.prisma.fitment.count({ where: { tenantId, fittedAt: { gte: today } } }),
      this.prisma.fitment.count({ where: { tenantId, vahanStatus: { in: ['PENDING', 'RETRYING'] } } }),
      this.prisma.fitment.count({ where: { tenantId, vahanStatus: 'MANUAL' } }),
    ]);
    return { fittedToday, pendingVahan, manual };
  }

  list(where: { dealerId?: string; from?: Date; to?: Date }) {
    return this.prisma.fitment.findMany({
      where: { tenantId: requestContext.tenantId(), ...(where.dealerId ? { dealerId: where.dealerId } : {}), ...(where.from || where.to ? { fittedAt: { gte: where.from, lte: where.to } } : {}) },
      orderBy: { fittedAt: 'desc' },
      take: 5000,
    });
  }

  /** End-of-day alert: VAHAN posts still not done after the configured hour (IST) go to operations by email. */
  async endOfDayAlert(force = false) {
    const now = new Date();
    const istHour = new Date(now.getTime() + 5.5 * 3600_000).getUTCHours();
    const hour = await this.settings.getOr<number>('alerts.vahanEodHourIst', 22);
    const today = istDate(now);
    if (!force && (istHour < hour || this.lastEodAlert === today)) return { sent: false };
    const pending = await this.pendingVahan();
    this.lastEodAlert = today;
    if (!pending.length) return { sent: false, pending: 0 };
    const to = await this.settings.getOr<string>('alerts.opsEmail', 'operations@hsrp-demo.invalid');
    await this.notify.send({ templateCode: 'VAHAN_PENDING_ALERT', channel: 'EMAIL', recipient: to, variables: { count: pending.length, date: today }, subjectType: 'hsrp.alert', subjectId: `vahan-eod-${today}` });
    this.log.warn(`End-of-day alert: ${pending.length} VAHAN posts still pending`);
    return { sent: true, pending: pending.length };
  }
}
