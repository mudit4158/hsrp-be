import { randomInt } from 'node:crypto';
import type { PrismaService } from '../../platform/database/prisma.service';

/**
 * The new-vehicle demo batch: fresh fictional vehicles registered in mock VAHAN, a Kranti vehicle data file for
 * them, and a sheet saying which vehicle plays which part. The Simulator page uses DEFAULT_SPECS; the scripted
 * simulator (`pnpm sim`) sends one spec per vehicle its test cases need (docs/SIMULATION.md).
 */
export interface VehicleSpec {
  /** Unique within the batch; the scripted simulator uses "<case>.<name>", e.g. "TC-02.car". */
  role: string;
  title: string;
  expected: string;
  /** VAHAN category: 2WN (two-wheeler) or LMV (car). */
  category: string;
  /** Listed in Kranti's vehicle data file. */
  inOemFile: boolean;
  /** The order should be placed with a different engine number than the OEM's record. */
  engineMismatch?: boolean;
  /** Maker: KRANTI (default; in Kranti's vehicle data file) or ZENMO (in Zenmo's mock catalogue instead). */
  oem?: 'KRANTI' | 'ZENMO';
}

export const DEFAULT_SPECS: VehicleSpec[] = [
  { role: 'VALID', category: 'LMV', inOemFile: true, title: 'Valid order', expected: 'Passes OEM data and VAHAN, goes through production, inward and fitment to COMPLETED.' },
  { role: 'NOT_IN_OEM_DATA', category: '2WN', inOemFile: false, title: 'Chassis not in the OEM data', expected: 'Left out of the Kranti file on purpose: the order is REJECTED at the oem-vehicle-data step.' },
  { role: 'ENGINE_MISMATCH', category: 'LMV', inOemFile: true, engineMismatch: true, title: 'Chassis and engine do not match', expected: 'Order it with the "engine to type" number: REJECTED at the oem-vehicle-data step.' },
  { role: 'QC_REJECT', category: 'LMV', inOemFile: true, title: 'QC rejects a plate', expected: 'QC rejects the front plate; the station approves the rejection, re-issues it, QC passes; completes.' },
  { role: 'DEALER_REJECT', category: '2WN', inOemFile: true, title: 'Dealer rejects a plate at inward', expected: 'Dealer rejects the rear plate at inward; the station re-issues it on a new challan; completes.' },
  { role: 'VAHAN_DOWN', category: '2WN', inOemFile: true, title: 'VAHAN down at fitment', expected: 'Fitment is recorded while VAHAN is down; the post waits in the retry queue and completes after a replay.' },
  { role: 'CANCELLED', category: 'LMV', inOemFile: true, title: 'Cancelled after confirmation', expected: 'Operations cancel it before production; the wallet hold is released.' },
];

export interface DemoVehicle {
  no: number;
  role: string;
  title: string;
  expected: string;
  regnNo: string;
  chassisNo: string;
  engineNo: string;
  /** What to type as the engine number when placing the order (differs only when the spec asks for a mismatch). */
  orderEngineNo: string;
  vchCatg: string;
  model: string;
  inOemFile: boolean;
  invoiceNo: string;
  invoiceDate: string;
  oem: 'KRANTI' | 'ZENMO';
}

export interface DemoSheet {
  createdAt: string;
  oemCode: string;
  dealerCode: string;
  stateCode: string;
  vehicles: DemoVehicle[];
}

const ALNUM = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
const str = (n: number) => Array.from({ length: n }, () => ALNUM[randomInt(ALNUM.length)]).join('');
const dmy = (d: Date) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;

const MODELS: Record<string, string> = { LMV: 'Kranti Vista (fictional)', '2WN': 'Kranti Sprint 110 (fictional)' };
const ZENMO_MODELS: Record<string, string> = { LMV: 'Zenmo Aura (fictional)', '2WN': 'Zenmo Zip 125 (fictional)' };
const VEHICLE_TYPE: Record<string, string> = { LPV: 'TRANSPORT', '3WT': 'TRANSPORT', '2WT': 'TRANSPORT', HGV: 'TRANSPORT', TRL: 'TRANSPORT' };

export async function createDemoBatch(prisma: PrismaService, tenantId: string, specs: VehicleSpec[] = DEFAULT_SPECS): Promise<DemoSheet> {
  const vehicles: DemoVehicle[] = [];
  const now = Date.now();
  for (const [i, r] of specs.entries()) {
    let regnNo: string;
    do regnNo = `WB02K${'ABCDEFGHJ'[randomInt(9)]}${String(randomInt(1, 10_000)).padStart(4, '0')}`;
    while (await prisma.mockVahanVehicle.findUnique({ where: { regnNo } }));
    const oem = r.oem ?? 'KRANTI';
    const chassisNo = `${oem === 'ZENMO' ? 'MZ' : 'MK'}${str(10)}${randomInt(10_000, 100_000)}`;
    const engineNo = `K${str(4)}${randomInt(10_000, 100_000)}`;
    const registered = new Date(now - randomInt(2, 20) * 86_400_000);
    const invoiced = new Date(registered.getTime() - 3 * 86_400_000);
    await prisma.mockVahanVehicle.create({
      data: {
        tenantId,
        regnNo,
        chassisNo,
        engineNo,
        stateCd: 'WB',
        offCd: 'WB02',
        maker: oem === 'ZENMO' ? 'ZENMO MOTORS (FICTIONAL)' : 'KRANTI AUTOS (FICTIONAL)',
        fuel: 'PETROL',
        vchType: VEHICLE_TYPE[r.category] ?? 'NON TRANSPORT',
        vchCatg: r.category,
        norms: 'BHARAT STAGE VI',
        regnDate: dmy(registered),
        scenario: 'demo-batch',
      },
    });
    // Zenmo is API-integrated: its orders are checked against its (mock) catalogue, not a vehicle data file.
    if (oem === 'ZENMO') await prisma.mockOemCatalogue.create({ data: { tenantId, oemCode: 'ZENMO', chassisNo, model: ZENMO_MODELS[r.category] ?? 'Zenmo (fictional)' } });
    vehicles.push({
      no: i + 1,
      role: r.role,
      title: r.title,
      expected: r.expected,
      regnNo,
      chassisNo,
      engineNo,
      orderEngineNo: r.engineMismatch ? `K${str(4)}${randomInt(10_000, 100_000)}` : engineNo,
      vchCatg: r.category,
      model: (oem === 'ZENMO' ? ZENMO_MODELS : MODELS)[r.category] ?? 'Demo model (fictional)',
      inOemFile: oem === 'KRANTI' && r.inOemFile,
      oem,
      invoiceNo: `KRA-INV-${String(now).slice(-5)}${i + 1}`,
      invoiceDate: dmy(invoiced),
    });
  }
  return { createdAt: new Date(now).toISOString(), oemCode: 'KRANTI', dealerCode: 'WB01', stateCode: 'WB', vehicles };
}

/** Kranti's vehicle data file for the batch, plus two rows the import must refuse (error report). */
export function demoCsvRows(sheet: DemoSheet): Record<string, string>[] {
  const rows = sheet.vehicles
    .filter((v) => v.inOemFile)
    .map((v) => ({
      'Chassis No': v.chassisNo,
      'Engine No': v.engineNo,
      Model: v.model,
      Category: v.vchCatg,
      'Dealer Code': sheet.dealerCode,
      'Invoice No': v.invoiceNo,
      'Invoice Date': v.invoiceDate,
    }));
  const first = sheet.vehicles[0];
  rows.push({ 'Chassis No': '', 'Engine No': `K${str(4)}00001`, Model: first.model, Category: 'LMV', 'Dealer Code': sheet.dealerCode, 'Invoice No': 'KRA-INV-BAD1', 'Invoice Date': first.invoiceDate });
  rows.push({ 'Chassis No': `MK${str(10)}00002`, 'Engine No': `K${str(4)}00002`, Model: first.model, Category: 'LMV', 'Dealer Code': 'WB02', 'Invoice No': 'KRA-INV-BAD2', 'Invoice Date': first.invoiceDate });
  return rows;
}
