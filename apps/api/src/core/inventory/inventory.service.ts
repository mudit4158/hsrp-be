import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requestContext } from '../../platform/context/request-context';
import { Db, PrismaService, Tx } from '../../platform/database/prisma.service';
import { Problem } from '../../platform/http/problem';
import { AuditService } from '../../utility/audit/audit.service';
import { ImportService } from '../../utility/import-export/import.service';
import { MastersService } from '../masters/masters.service';

const LOCK_MINUTES = 10;
export const LASER_CODE = /^[A-Z]{2}\d{10}$/;

/** Boxes and plates by laser code, stock per station, box locks and the allocation history. */
@Injectable()
export class InventoryService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly imports: ImportService,
    private readonly masters: MastersService,
  ) {}

  onModuleInit() {
    // Stock receipt upload: one row per plate (box, station, product, laser code).
    this.imports.registerTarget('hsrp.stock-receipt', {
      processRow: async (row) => {
        const laserCode = (row.laserCode ?? '').toUpperCase();
        if (!LASER_CODE.test(laserCode)) throw Problem.badRequest('Laser code must be two letters and ten digits');
        const tenantId = requestContext.tenantId();
        const station = await this.masters.stationByCode(String(row.stationCode));
        const product = await this.masters.productByCode(String(row.productCode));
        return this.prisma.tx(async (tx) => {
          const box = await tx.plateBox.upsert({
            where: { tenantId_boxNo: { tenantId, boxNo: row.boxNo } },
            create: { tenantId, boxNo: row.boxNo, stationId: station.id, productCode: product.code, plateCount: 0 },
            update: {},
          });
          if (box.stationId !== station.id || box.productCode !== product.code) throw Problem.badRequest(`Box ${row.boxNo} belongs to another station or product`);
          const exists = await tx.plate.findUnique({ where: { tenantId_laserCode: { tenantId, laserCode } } });
          if (exists) throw Problem.badRequest(`Laser code ${laserCode} already in stock`);
          const plate = await tx.plate.create({ data: { tenantId, laserCode, boxId: box.id, stationId: station.id, productCode: product.code } });
          await tx.plateBox.update({ where: { id: box.id }, data: { plateCount: { increment: 1 }, status: 'OPEN' } });
          return { ref: plate.id };
        });
      },
    });
  }

  /** Locks boxes for the current user so nobody else allocates from them meanwhile. */
  async lockBoxes(stationId: string, boxNos: string[], db?: Tx) {
    const userId = requestContext.actorId() ?? 'system';
    const run = async (tx: Tx) => {
      const tenantId = requestContext.tenantId();
      const boxes = await tx.plateBox.findMany({ where: { tenantId, boxNo: { in: boxNos } } });
      const missing = boxNos.filter((b) => !boxes.some((x) => x.boxNo === b));
      if (missing.length) throw Problem.unprocessable(`Unknown box(es): ${missing.join(', ')}`, 'box-unknown');
      const elsewhere = boxes.filter((b) => b.stationId !== stationId);
      if (elsewhere.length) throw Problem.unprocessable(`Box(es) belong to another station: ${elsewhere.map((b) => b.boxNo).join(', ')}`, 'box-station');
      const until = new Date(Date.now() + LOCK_MINUTES * 60_000);
      for (const b of boxes) {
        const n = await tx.$executeRaw`
          UPDATE core_inv_box SET locked_by = ${userId}, locked_until = ${until}, updated_at = now()
          WHERE id = ${b.id} AND (locked_by IS NULL OR locked_by = ${userId} OR locked_until < now())`;
        if (n === 0) throw Problem.conflict(`Box ${b.boxNo} is locked by another user`, 'box-locked');
      }
      return this.boxSummary(tx, boxes.map((b) => b.id));
    };
    return db ? run(db) : this.prisma.tx(run);
  }

  async releaseBoxes(boxNos: string[], db: Db = this.prisma) {
    const userId = requestContext.actorId() ?? 'system';
    await db.plateBox.updateMany({ where: { tenantId: requestContext.tenantId(), boxNo: { in: boxNos }, lockedBy: userId }, data: { lockedBy: null, lockedUntil: null } });
  }

  private async boxSummary(db: Db, boxIds: string[]) {
    const boxes = await db.plateBox.findMany({ where: { id: { in: boxIds } }, orderBy: { boxNo: 'asc' } });
    const counts = await db.plate.groupBy({ by: ['boxId'], where: { boxId: { in: boxIds }, status: 'AVAILABLE' }, _count: true });
    return boxes.map((b) => ({ ...b, available: counts.find((c) => c.boxId === b.id)?._count ?? 0 }));
  }

  /**
   * Allocates the next available plate of `productCode` from the given (locked) boxes to an order position.
   * The partial unique index guarantees one ACTIVE allocation per laser code and per order position.
   */
  async allocate(tx: Tx, input: { orderId: string; position: string; productCode: string; stationId: string; boxNos: string[]; jobCardId?: string }) {
    const tenantId = requestContext.tenantId();
    const userId = requestContext.actorId() ?? 'system';
    const boxes = await tx.plateBox.findMany({ where: { tenantId, boxNo: { in: input.boxNos }, stationId: input.stationId, productCode: input.productCode } });
    const notLocked = boxes.filter((b) => b.lockedBy !== userId || !b.lockedUntil || b.lockedUntil < new Date());
    if (notLocked.length) throw Problem.conflict(`Lock box(es) ${notLocked.map((b) => b.boxNo).join(', ')} before allocating`, 'box-not-locked');
    const order = new Map(input.boxNos.map((b, i) => [b, i]));
    const sorted = boxes.sort((a, b) => (order.get(a.boxNo) ?? 0) - (order.get(b.boxNo) ?? 0));
    for (const box of sorted) {
      const [plate] = await tx.$queryRaw<Array<{ id: string; laser_code: string }>>`
        SELECT id, laser_code FROM core_inv_plate WHERE box_id = ${box.id} AND status = 'AVAILABLE'
        ORDER BY laser_code LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!plate) {
        await tx.plateBox.update({ where: { id: box.id }, data: { status: 'EXHAUSTED' } });
        continue;
      }
      await tx.plate.update({ where: { id: plate.id }, data: { status: 'ALLOCATED' } });
      return tx.plateAllocation.create({
        data: { tenantId, plateId: plate.id, laserCode: plate.laser_code, orderId: input.orderId, position: input.position, jobCardId: input.jobCardId },
      });
    }
    throw Problem.unprocessable(`No ${input.productCode} plates left in boxes ${input.boxNos.join(', ')}`, 'no-plates');
  }

  activeAllocations(orderId: string, db: Db = this.prisma) {
    return db.plateAllocation.findMany({ where: { orderId, status: 'ACTIVE' }, orderBy: { position: 'asc' } });
  }

  allocationHistory(orderId: string) {
    return this.prisma.plateAllocation.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  }

  allocationsByIds(ids: string[], db: Db = this.prisma) {
    return db.plateAllocation.findMany({ where: { id: { in: ids } } });
  }

  /** Closes the active allocation of each position (history kept) and sets the plate's new status. */
  async closePositions(tx: Tx, orderId: string, positions: string[], reason: string, plateStatus: 'AVAILABLE' | 'SCRAPPED') {
    const rows = await tx.plateAllocation.findMany({ where: { orderId, status: 'ACTIVE', position: { in: positions } } });
    for (const a of rows) {
      await tx.plateAllocation.update({ where: { id: a.id }, data: { status: 'CLOSED', closedAt: new Date(), closeReason: reason } });
      await tx.plate.update({ where: { id: a.plateId }, data: { status: plateStatus } });
    }
    return rows;
  }

  /** QC "switch laser code": closes the current allocation and allocates a specific plate instead. */
  async switchLaser(tx: Tx, input: { orderId: string; position: string; newLaserCode: string; reason: string; stationId: string; productCode: string }) {
    const tenantId = requestContext.tenantId();
    const plate = await tx.plate.findUnique({ where: { tenantId_laserCode: { tenantId, laserCode: input.newLaserCode } } });
    if (!plate) throw Problem.unprocessable(`Laser code ${input.newLaserCode} is not in stock`, 'laser-unknown');
    if (plate.status !== 'AVAILABLE') throw Problem.conflict(`Laser code ${input.newLaserCode} is ${plate.status.toLowerCase()}`, 'laser-unavailable');
    if (plate.stationId !== input.stationId) throw Problem.unprocessable('That plate belongs to another station', 'laser-station');
    if (plate.productCode !== input.productCode) throw Problem.unprocessable(`That plate is ${plate.productCode}; ${input.productCode} is needed`, 'laser-product');
    const [closed] = await this.closePositions(tx, input.orderId, [input.position], `SWITCHED: ${input.reason}`, 'AVAILABLE');
    await tx.plate.update({ where: { id: plate.id }, data: { status: 'ALLOCATED' } });
    const created = await tx.plateAllocation.create({
      data: { tenantId, plateId: plate.id, laserCode: plate.laserCode, orderId: input.orderId, position: input.position, jobCardId: closed?.jobCardId },
    });
    await this.audit.record({ action: 'inventory.laser-switch', subjectType: 'hsrp.order', subjectId: input.orderId, before: closed?.laserCode, after: plate.laserCode }, tx);
    return created;
  }

  async markFitted(tx: Tx, orderId: string) {
    const rows = await this.activeAllocations(orderId, tx);
    await tx.plate.updateMany({ where: { id: { in: rows.map((r) => r.plateId) } }, data: { status: 'FITTED' } });
  }

  async stockByStation() {
    const tenantId = requestContext.tenantId();
    const rows = await this.prisma.plate.groupBy({ by: ['stationId', 'productCode', 'status'], where: { tenantId }, _count: true });
    const stations = await this.masters.stations();
    return stations.map((s) => {
      const mine = rows.filter((r) => r.stationId === s.id);
      const products = [...new Set(mine.map((r) => r.productCode))].sort();
      return {
        stationId: s.id,
        stationCode: s.code,
        stationName: s.name,
        totals: Object.fromEntries(['AVAILABLE', 'ALLOCATED', 'FITTED', 'SCRAPPED'].map((st) => [st, mine.filter((r) => r.status === st).reduce((n, r) => n + r._count, 0)])),
        products: products.map((p) => ({
          productCode: p,
          ...Object.fromEntries(['AVAILABLE', 'ALLOCATED', 'FITTED', 'SCRAPPED'].map((st) => [st, mine.find((r) => r.productCode === p && r.status === st)?._count ?? 0])),
        })),
      };
    });
  }

  async boxes(filter: { stationId?: string; status?: string; q?: string }) {
    const tenantId = requestContext.tenantId();
    const boxes = await this.prisma.plateBox.findMany({
      where: { tenantId, ...(filter.stationId ? { stationId: filter.stationId } : {}), ...(filter.status ? { status: filter.status } : {}), ...(filter.q ? { boxNo: { contains: filter.q.toUpperCase() } } : {}) },
      orderBy: { boxNo: 'asc' },
      take: 500,
    });
    const counts = await this.prisma.plate.groupBy({ by: ['boxId', 'status'], where: { boxId: { in: boxes.map((b) => b.id) } }, _count: true });
    return boxes.map((b) => ({
      ...b,
      available: counts.find((c) => c.boxId === b.id && c.status === 'AVAILABLE')?._count ?? 0,
      used: counts.filter((c) => c.boxId === b.id && c.status !== 'AVAILABLE').reduce((n, c) => n + c._count, 0),
    }));
  }

  async plates(filter: { boxNo?: string; laserCode?: string; status?: string }) {
    const tenantId = requestContext.tenantId();
    const where: Prisma.PlateWhereInput = { tenantId };
    if (filter.laserCode) where.laserCode = { contains: filter.laserCode.toUpperCase() };
    if (filter.status) where.status = filter.status;
    if (filter.boxNo) {
      const box = await this.prisma.plateBox.findUnique({ where: { tenantId_boxNo: { tenantId, boxNo: filter.boxNo } } });
      if (!box) return [];
      where.boxId = box.id;
    }
    return this.prisma.plate.findMany({ where, orderBy: { laserCode: 'asc' }, take: 300 });
  }

  async plateHistory(laserCode: string) {
    const tenantId = requestContext.tenantId();
    const plate = await this.prisma.plate.findUnique({ where: { tenantId_laserCode: { tenantId, laserCode: laserCode.toUpperCase() } } });
    if (!plate) throw Problem.notFound('Plate');
    const allocations = await this.prisma.plateAllocation.findMany({ where: { laserCode: plate.laserCode }, orderBy: { createdAt: 'asc' } });
    return { plate, allocations };
  }
}
