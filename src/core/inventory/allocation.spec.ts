import { asSystem, resetDb, TEST_TENANT } from '../../../test/db';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { AuditService } from '../../utility/audit/audit.service';
import type { ImportService } from '../../utility/import-export/import.service';
import type { MastersService } from '../masters/masters.service';
import { InventoryService } from './inventory.service';

/** Plate allocation rules: box locks, one active allocation per laser code, history on switch and scrap. */
describe('plate allocation', () => {
  const prisma = new PrismaService();
  const inventory = new InventoryService(prisma, new AuditService(prisma), { registerTarget() {} } as unknown as ImportService, {} as MastersService);
  const asUser = <T>(userId: string, fn: () => Promise<T>) =>
    requestContext.run({ tenantId: TEST_TENANT, actor: { id: userId, type: 'user', roles: ['STATION_USER'], permissions: [] } }, fn);
  let stationId: string;

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDb(prisma);
    stationId = 'stn-1';
    for (const boxNo of ['BOX-A', 'BOX-B']) {
      const box = await prisma.plateBox.create({ data: { tenantId: TEST_TENANT, boxNo, stationId, productCode: '500X120', plateCount: 2 } });
      await prisma.plate.createMany({
        data: [1, 2].map((i) => ({ tenantId: TEST_TENANT, laserCode: `${boxNo === 'BOX-A' ? 'AA' : 'BB'}000000000${i}`, boxId: box.id, stationId, productCode: '500X120' })),
      });
    }
    await prisma.plateBox.create({ data: { tenantId: TEST_TENANT, boxNo: 'OTHER-STN', stationId: 'stn-2', productCode: '500X120', plateCount: 0 } });
  });

  const alloc = (userId: string, orderId: string, position: string, boxNos = ['BOX-A']) =>
    asUser(userId, () => prisma.tx((tx) => inventory.allocate(tx, { orderId, position, productCode: '500X120', stationId, boxNos })));

  it('refuses to allocate from a box the user has not locked', async () => {
    await expect(alloc('u1', 'o1', 'FRONT')).rejects.toMatchObject({ status: 409, code: 'box-not-locked' });
  });

  it('locks a box for one user at a time', async () => {
    await asUser('u1', () => inventory.lockBoxes(stationId, ['BOX-A']));
    await expect(asUser('u2', () => inventory.lockBoxes(stationId, ['BOX-A']))).rejects.toMatchObject({ code: 'box-locked' });
    await asUser('u1', () => inventory.releaseBoxes(['BOX-A']));
    await expect(asUser('u2', () => inventory.lockBoxes(stationId, ['BOX-A']))).resolves.toBeDefined();
  });

  it('refuses boxes of another station', async () => {
    await expect(asUser('u1', () => inventory.lockBoxes(stationId, ['OTHER-STN']))).rejects.toMatchObject({ code: 'box-station' });
  });

  it('allocates plates in box and laser-code order and moves to the next box when one runs out', async () => {
    await asUser('u1', () => inventory.lockBoxes(stationId, ['BOX-A', 'BOX-B']));
    const codes = [];
    for (const [o, p] of [['o1', 'FRONT'], ['o1', 'REAR'], ['o2', 'FRONT']]) codes.push((await alloc('u1', o, p, ['BOX-A', 'BOX-B'])).laserCode);
    expect(codes).toEqual(['AA0000000001', 'AA0000000002', 'BB0000000001']);
    expect((await prisma.plateBox.findFirstOrThrow({ where: { boxNo: 'BOX-A' } })).status).toBe('EXHAUSTED');
  });

  it('allows at most one active allocation per laser code (database rule)', async () => {
    await asUser('u1', () => inventory.lockBoxes(stationId, ['BOX-A']));
    const a = await alloc('u1', 'o1', 'FRONT');
    await expect(
      prisma.plateAllocation.create({ data: { tenantId: TEST_TENANT, plateId: a.plateId, laserCode: a.laserCode, orderId: 'o2', position: 'FRONT' } }),
    ).rejects.toThrow(/Unique constraint/);
  });

  it('allows at most one active allocation per order position', async () => {
    await asUser('u1', () => inventory.lockBoxes(stationId, ['BOX-A']));
    await alloc('u1', 'o1', 'FRONT');
    await expect(alloc('u1', 'o1', 'FRONT')).rejects.toThrow(/Unique constraint/);
  });

  it('switching a laser code closes the old allocation and opens a new one, keeping history', async () => {
    await asUser('u1', () => inventory.lockBoxes(stationId, ['BOX-A']));
    const first = await alloc('u1', 'o1', 'FRONT');
    await asUser('u1', () => prisma.tx((tx) => inventory.switchLaser(tx, { orderId: 'o1', position: 'FRONT', newLaserCode: 'BB0000000002', reason: 'Wrong plate picked', stationId, productCode: '500X120' })));
    const history = await asSystem(() => inventory.allocationHistory('o1'));
    expect(history.map((h) => [h.laserCode, h.status])).toEqual([
      [first.laserCode, 'CLOSED'],
      ['BB0000000002', 'ACTIVE'],
    ]);
    expect((await prisma.plate.findFirstOrThrow({ where: { laserCode: first.laserCode } })).status).toBe('AVAILABLE');
    // The freed plate can be allocated again; the switched-in plate cannot be taken twice.
    await expect(asUser('u1', () => prisma.tx((tx) => inventory.switchLaser(tx, { orderId: 'o2', position: 'FRONT', newLaserCode: 'BB0000000002', reason: 'x', stationId, productCode: '500X120' })))).rejects.toMatchObject({ code: 'laser-unavailable' });
  });

  it('scraps rejected plates and closes only the rejected positions', async () => {
    await asUser('u1', () => inventory.lockBoxes(stationId, ['BOX-A']));
    await alloc('u1', 'o1', 'FRONT');
    const rear = await alloc('u1', 'o1', 'REAR');
    await asSystem(() => prisma.tx((tx) => inventory.closePositions(tx, 'o1', ['REAR'], 'REJECTED', 'SCRAPPED')));
    const active = await asSystem(() => inventory.activeAllocations('o1'));
    expect(active.map((a) => a.position)).toEqual(['FRONT']);
    expect((await prisma.plate.findUniqueOrThrow({ where: { id: rear.plateId } })).status).toBe('SCRAPPED');
  });
});
