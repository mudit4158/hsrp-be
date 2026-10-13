import '../platform/config/env';
import { Prisma } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { requestContext } from '../platform/context/request-context';
import { SettingsService } from '../utility/configuration/settings.service';
import { PrismaService } from '../platform/database/prisma.service';
import { AuditService } from '../utility/audit/audit.service';
import { hashKey } from '../utility/identity/api-client.service';
import { hashPassword } from '../utility/identity/password';
import { WalletService } from '../utility/wallet/wallet.service';
import {
  BASE_PRICE, COMPANY, DEALERS, DOC_TEMPLATES, IMPORT_PROFILES, NOTIFY_TEMPLATES, OEMS, ORDER_TYPE_FACTOR, PLATE_SET_FACTOR, PRODUCTS, ROLES,
  BILL_EMAIL, BILL_TEMPLATE, BILLING_SETTINGS, STANDARD_OEM_PROFILES, KRANTI_STEPS, krantiModel, SEQUENCES, SETTINGS, STATE_FACTOR, STATES, STATIONS, TENANT, TICKET_CATEGORIES, VEHICLE_CATEGORIES, WALLETS,
} from './fixtures';
import { generateVehicles, NEW_POOLS, rng, SeedVehicle } from './vehicles';

const log = (m: string) => console.log(`[seed] ${m}`);
const DAY = 86400_000;
const r = rng(7);

// A 1×1 grey PNG used as the photo of every seeded (historical) fitment.
const PLACEHOLDER_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

export function priceRupees(stateCode: string, vehicleClass: string, orderType: string, plateSet: string) {
  return Math.round(BASE_PRICE[vehicleClass] * ORDER_TYPE_FACTOR[orderType] * PLATE_SET_FACTOR[plateSet] * STATE_FACTOR[stateCode]);
}

async function truncateAll(prisma: PrismaService) {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

async function main() {
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 8) {
    console.error('[seed] SEED_PASSWORD must be set (8+ characters) in .env. It becomes the password of every demo user.');
    process.exit(1);
  }
  const prisma = new PrismaService();
  await prisma.$connect();
  const existing = await prisma.tenant.findUnique({ where: { id: TENANT.id } });
  if (existing && process.env.SEED_RESET !== 'true') {
    log('Seed data already present; applying upgrades only (set SEED_RESET=true to wipe and reseed).');
    await requestContext.runAsSystem(TENANT.id, () => upgrade(prisma));
    await prisma.$disconnect();
    return;
  }
  if (existing) {
    log('SEED_RESET=true: wiping all tables');
    await truncateAll(prisma);
  }
  const started = Date.now();
  await requestContext.runAsSystem(TENANT.id, () => seed(prisma, password));
  log(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  await prisma.$disconnect();
}

async function seed(prisma: PrismaService, password: string) {
  const tenantId = TENANT.id;
  const audit = new AuditService(prisma);
  const wallets = new WalletService(prisma, audit);
  const now = Date.now();

  await prisma.tenant.create({ data: { id: tenantId, tenantId, name: TENANT.name } });
  for (const role of ROLES) await prisma.iamRole.create({ data: { tenantId, ...role } });

  // ---------------------------------------------------------------- organisations and masters
  const companyOrg = await prisma.iamOrg.create({ data: { tenantId, code: `CMP-${COMPANY.code}`, name: COMPANY.name, orgType: 'COMPANY' } });
  const company = await prisma.company.create({ data: { tenantId, code: COMPANY.code, name: COMPANY.name, address: COMPANY.address, gstin: COMPANY.gstin } });
  for (const s of STATES) await prisma.state.create({ data: { tenantId, ...s } });
  const stations: Record<string, { id: string; orgId: string; laserPrefix: string; code: string }> = {};
  for (const s of STATIONS) {
    const org = await prisma.iamOrg.create({ data: { tenantId, code: `STN-${s.code}`, name: s.name, orgType: 'STATION', parentId: companyOrg.id } });
    const row = await prisma.station.create({ data: { tenantId, code: s.code, name: s.name, companyId: company.id, stateCode: s.stateCode, city: s.city, address: s.address, orgId: org.id } });
    stations[s.code] = { id: row.id, orgId: org.id, laserPrefix: s.laserPrefix, code: s.code };
  }
  for (const p of PRODUCTS) await prisma.product.create({ data: { tenantId, ...p } });
  for (const c of VEHICLE_CATEGORIES) await prisma.vehicleCategory.create({ data: { tenantId, ...c } });

  const oems: Record<string, { id: string; walletId: string; orgId: string }> = {};
  for (const o of OEMS) {
    const org = await prisma.iamOrg.create({ data: { tenantId, code: `OEM-${o.code}`, name: o.name, orgType: 'OEM' } });
    const w = await wallets.openWallet({ ownerType: 'hsrp.oem', ownerId: o.code, name: `OEM ${o.name}`, creditLimitPaise: 50_000_000 });
    const row = await prisma.oem.create({
      data: { tenantId, code: o.code, name: o.name, integration: o.integration, requiresCatalogueCheck: o.requiresCatalogueCheck, orgId: org.id, walletAccountId: w.id, importProfileCode: o.importProfileCode },
    });
    oems[o.code] = { id: row.id, walletId: w.id, orgId: org.id };
  }

  const walletIds: Record<string, string> = {};
  for (const [group, cfg] of Object.entries(WALLETS)) {
    const w = await wallets.openWallet({ ownerType: 'hsrp.wallet-group', ownerId: group, name: `Wallet ${group}`, creditLimitPaise: cfg.credit * 100 });
    await wallets.topUp(w.id, cfg.topUp * 100, `SEED-OPENING-${group}`);
    walletIds[group] = w.id;
  }

  const dealers: Record<string, { id: string; code: string; stateCode: string; stationCode: string; walletId: string; oems: string[]; orgId: string; resourceId: string }> = {};
  for (const d of DEALERS) {
    const st = stations[d.station];
    const org = await prisma.iamOrg.create({ data: { tenantId, code: `DLR-${d.code}`, name: d.name, orgType: 'DEALER', parentId: st.orgId } });
    const row = await prisma.dealer.create({
      data: {
        tenantId, code: d.code, name: d.name, stateCode: d.stateCode, city: d.city, address: `${r.int(1, 99)} Demo Road, ${d.city}`, mobile: `90000${String(10000 + Object.keys(dealers).length).slice(-5)}`,
        email: `${d.code.toLowerCase()}@dealer.example.invalid`, stationId: st.id, orgId: org.id, walletGroup: d.walletGroup, walletAccountId: walletIds[d.walletGroup], acceptsCustomerOrders: true, status: 'ACTIVE',
      },
    });
    for (const oc of d.oems) await prisma.dealerOem.create({ data: { tenantId, dealerId: row.id, oemId: oems[oc].id } });
    const res = await prisma.schedResource.create({ data: { tenantId, code: `fitment-${d.code}`, name: `Fitment bay ${d.name}`, subjectType: 'hsrp.dealer', subjectId: row.id } });
    await prisma.schedCalendarRule.createMany({ data: [1, 2, 3, 4, 5, 6].map((weekday) => ({ tenantId, resourceId: res.id, weekday, startTime: '10:00', endTime: '17:00', slotMinutes: 60, capacity: 4 })) });
    dealers[d.code] = { id: row.id, code: d.code, stateCode: d.stateCode, stationCode: d.station, walletId: walletIds[d.walletGroup], oems: d.oems, orgId: org.id, resourceId: res.id };
  }
  log(`Masters: ${STATES.length} states, ${STATIONS.length} stations, ${OEMS.length} OEMs, ${DEALERS.length} dealers, ${Object.keys(WALLETS).length} dealer wallets (2 shared)`);

  // ---------------------------------------------------------------- users and API clients
  const hash = await hashPassword(password);
  const users = [
    { username: 'admin', displayName: 'Asha Admin (demo)', roles: ['ADMIN'], orgId: companyOrg.id },
    { username: 'ops', displayName: 'Omkar Operations (demo)', roles: ['OPERATIONS'], orgId: companyOrg.id },
    { username: 'station.kol', displayName: 'Kolkata Station User (demo)', roles: ['STATION_USER'], orgId: stations.KOL1.orgId },
    { username: 'station.bbs', displayName: 'Bhubaneswar Station User (demo)', roles: ['STATION_USER'], orgId: stations.BBS1.orgId },
    { username: 'dealer.wb01', displayName: 'Howrah Wheels Desk (demo)', roles: ['DEALER'], orgId: dealers.WB01.orgId },
    { username: 'dealer.od02', displayName: 'Kalinga Motors Desk (demo)', roles: ['DEALER'], orgId: dealers.OD02.orgId },
  ];
  for (const u of users) await prisma.iamUser.create({ data: { tenantId, ...u, passwordHash: hash, email: `${u.username}@hsrp-demo.invalid` } });
  const zenmoKey = `hk_demo_${randomBytes(12).toString('base64url')}`;
  const zenmoSecret = randomBytes(24).toString('base64url');
  await prisma.iamApiClient.create({ data: { tenantId, orgId: oems.ZENMO.orgId, name: 'Zenmo order system (demo)', roles: ['OEM_CLIENT'], keyHash: hashKey(zenmoKey), secret: zenmoSecret } });
  log(`Users: ${users.map((u) => u.username).join(', ')} (password = SEED_PASSWORD from .env)`);

  // ---------------------------------------------------------------- configuration, templates, sequences
  for (const s of SETTINGS) await prisma.configSetting.create({ data: { tenantId, ...s, value: s.value as Prisma.InputJsonValue, effectiveFrom: new Date('2024-01-01T00:00:00Z') } });
  for (const s of SEQUENCES) await prisma.docSequence.create({ data: { tenantId, ...s } });
  for (const t of NOTIFY_TEMPLATES) await prisma.notifyTemplate.create({ data: { tenantId, ...t } });
  for (const t of DOC_TEMPLATES) await prisma.docTemplate.create({ data: { tenantId, code: t.code, name: t.name, layout: t.layout as unknown as Prisma.InputJsonValue } });
  for (const p of IMPORT_PROFILES) await prisma.importProfile.create({ data: { tenantId, ...p, mapping: p.mapping as Prisma.InputJsonValue } });
  for (const c of TICKET_CATEGORIES) await prisma.ticketCategory.create({ data: { tenantId, ...c } });

  // ---------------------------------------------------------------- prices
  const effectiveFrom = new Date('2024-04-01T00:00:00+05:30');
  const priceRows: Prisma.PriceRuleCreateManyInput[] = [];
  for (const s of STATES)
    for (const cls of Object.keys(BASE_PRICE))
      for (const ot of ['NEW', 'OLD', 'REPLACEMENT'])
        for (const ps of ['BOTH', 'FRONT', 'REAR'])
          priceRows.push({ tenantId, stateCode: s.code, vehicleClass: cls, orderType: ot, plateSet: ps, amountPaise: priceRupees(s.code, cls, ot, ps) * 100, published: s.code === 'OD', effectiveFrom });
  priceRows.push({ tenantId, stateCode: 'WB', vehicleClass: 'LMV', oemCode: 'ZENMO', orderType: 'NEW', plateSet: 'BOTH', amountPaise: 74000, effectiveFrom });
  await prisma.priceRule.createMany({ data: priceRows });
  await prisma.extraCharge.createMany({
    data: [
      { tenantId, code: 'GREEN_STRIP', name: 'BS-VI green strip sticker', amountPaise: 2500, conditions: { greenStrip: true }, effectiveFrom },
      { tenantId, code: 'PORTAL_FEE', name: 'Online booking fee', amountPaise: 2000, conditions: { channel: 'CUSTOMER_PORTAL' }, effectiveFrom },
    ],
  });
  log(`Prices: ${priceRows.length} rules, 2 extra charges`);

  // ---------------------------------------------------------------- plate inventory: 40 boxes × 50 plates
  const boxPlan: Record<string, number> = { '285X45': 4, '200X100': 6, '500X120': 6, '340X200': 4 };
  const stock: Record<string, Array<{ id: string; laserCode: string; boxNo: string }>> = {};
  let boxCount = 0;
  for (const st of Object.values(stations)) {
    let boxSeq = 0;
    for (const [productCode, boxes] of Object.entries(boxPlan)) {
      const pIndex = PRODUCTS.findIndex((p) => p.code === productCode) + 1;
      for (let b = 0; b < boxes; b++) {
        boxSeq++;
        boxCount++;
        const boxNo = `BX-${st.code}-${String(boxSeq).padStart(3, '0')}`;
        const box = await prisma.plateBox.create({ data: { tenantId, boxNo, stationId: st.id, productCode, plateCount: 50, receivedAt: new Date(now - 40 * DAY) } });
        const plates = Array.from({ length: 50 }, (_, i) => ({
          tenantId,
          laserCode: `${st.laserPrefix}${String(pIndex).padStart(2, '0')}${String(boxSeq).padStart(3, '0')}${String(i + 1).padStart(5, '0')}`,
          boxId: box.id,
          stationId: st.id,
          productCode,
        }));
        await prisma.plate.createMany({ data: plates });
        const created = await prisma.plate.findMany({ where: { boxId: box.id }, orderBy: { laserCode: 'asc' }, select: { id: true, laserCode: true } });
        (stock[`${st.code}|${productCode}`] ??= []).push(...created.map((p) => ({ ...p, boxNo })));
      }
    }
  }
  log(`Inventory: ${boxCount} boxes, ${boxCount * 50} plates`);

  // ---------------------------------------------------------------- mock VAHAN and OEM catalogue
  const vehicles = generateVehicles();
  await prisma.mockVahanVehicle.createMany({ data: vehicles.map((v) => ({ tenantId, ...v })) });
  const zenmo = vehicles.filter((v) => v.maker.startsWith('ZENMO'));
  await prisma.mockOemCatalogue.createMany({ data: zenmo.map((v) => ({ tenantId, oemCode: 'ZENMO', chassisNo: v.chassisNo, model: v.vchCatg === '2WN' ? 'Zenmo Zip 125 (fictional)' : 'Zenmo Aura (fictional)' })) });
  const sample = (pool: string, state?: string) => vehicles.filter((v) => v.scenario === pool && (!state || v.stateCd === state)).map((v) => v.regnNo);
  await prisma.mockSetting.createMany({
    data: [
      { key: 'vahan.mode', tenantId, value: 'normal' },
      {
        key: 'oem.demo',
        tenantId,
        value: [
          { oemCode: 'ZENMO', apiKey: zenmoKey, secret: zenmoSecret, dealerCodes: ['WB01', 'WB02'], sampleRegnNos: sample('oem-zenmo-sample', 'WB') },
          { oemCode: 'KRANTI', csvProfileCode: 'OEM_KRANTI_CSV', dealerCodes: ['OD01', 'OD02'], sampleRegnNos: sample('oem-kranti-sample', 'OD') },
        ],
      },
    ],
  });
  const krantiData = await seedKrantiVehicleData(prisma, oems.KRANTI.id, vehicles);
  log(`Mock VAHAN: ${vehicles.length} vehicles; Zenmo catalogue: ${zenmo.length} chassis; Kranti vehicle data: ${krantiData} chassis`);

  // ---------------------------------------------------------------- 200 orders across every status
  const placeholder = await prisma.fileObject.create({
    data: { tenantId, filename: 'seed-placeholder.png', mimeType: 'image/png', sizeBytes: PLACEHOLDER_PNG.length, sha256: 'seed', storageKey: `${tenantId}/seed-placeholder`, purpose: 'seed' },
  });
  await prisma.fileBlob.create({ data: { key: `${tenantId}/seed-placeholder`, tenantId, data: PLACEHOLDER_PNG } });
  await seedOrders(prisma, wallets, { tenantId, now, dealers, oems, stations, stock, vehicles, placeholderId: placeholder.id });
  await seedTickets(prisma, tenantId, now);
  await audit.record({ action: 'seed.run', subjectType: 'system', subjectId: 'seed', after: { vehicles: vehicles.length } });
}

/** Kranti's vehicle data for every new Kranti vehicle in mock VAHAN (no dealer: the dealer check is skipped for these). */
async function seedKrantiVehicleData(prisma: PrismaService, oemId: string, vehicles: Array<Pick<SeedVehicle, 'maker' | 'scenario' | 'chassisNo' | 'engineNo' | 'vchCatg'>>) {
  const rows = vehicles.filter((v) => v.maker.startsWith('KRANTI') && NEW_POOLS.includes(v.scenario));
  const res = await prisma.oemVehicle.createMany({
    data: rows.map((v) => ({ tenantId: TENANT.id, oemId, chassisNo: v.chassisNo, engineNo: v.engineNo, model: krantiModel(v.vchCatg), vahanCategory: v.vchCatg, source: 'SEED' })),
    skipDuplicates: true,
  });
  return res.count;
}

/**
 * Additive changes for a database seeded by an earlier version. Each block checks its own marker, so a restart
 * applies it once; existing data is never removed.
 */
async function upgrade(prisma: PrismaService) {
  const tenantId = TENANT.id;
  // D42: OEM vehicle data file and the oem-vehicle-data validation step for Kranti.
  const profile = IMPORT_PROFILES.find((p) => p.code === 'OEM_KRANTI_VEHICLES')!;
  if (!(await prisma.importProfile.findUnique({ where: { tenantId_code: { tenantId, code: profile.code } } }))) {
    await prisma.importProfile.create({ data: { tenantId, ...profile, mapping: profile.mapping as Prisma.InputJsonValue } });
    await new SettingsService(prisma, new AuditService(prisma)).set({ key: 'order.validationSteps', scopeType: 'oem', scopeId: 'KRANTI', value: KRANTI_STEPS });
    const kranti = await prisma.oem.findUniqueOrThrow({ where: { tenantId_code: { tenantId, code: 'KRANTI' } } });
    const vehicles = await prisma.mockVahanVehicle.findMany({ where: { tenantId }, select: { maker: true, scenario: true, chassisNo: true, engineNo: true, vchCatg: true } });
    const n = await seedKrantiVehicleData(prisma, kranti.id, vehicles.map((v) => ({ ...v, scenario: v.scenario as SeedVehicle['scenario'] })));
    log(`Upgrade D42: import profile ${profile.code}, Kranti validation steps, ${n} Kranti vehicle data rows`);
  }
  // D47: standard OEM bulk-upload profiles. System-owned, so they are kept equal to the fixture on every start.
  for (const p of STANDARD_OEM_PROFILES) {
    const existing = await prisma.importProfile.findUnique({ where: { tenantId_code: { tenantId, code: p.code } } });
    if (!existing) await prisma.importProfile.create({ data: { tenantId, ...p, mapping: p.mapping as Prisma.InputJsonValue } });
    else if (JSON.stringify(existing.mapping) !== JSON.stringify(JSON.parse(JSON.stringify(p.mapping)))) {
      await prisma.importProfile.update({ where: { id: existing.id }, data: { name: p.name, sourceName: p.sourceName, mapping: p.mapping as Prisma.InputJsonValue } });
      log(`Upgrade D47: import profile ${p.code} refreshed`);
    }
  }
  // D46: postpaid billing settings, the bill sequence, e-mail template, PDF layout and permissions.
  if (!(await prisma.docTemplate.findFirst({ where: { tenantId, code: BILL_TEMPLATE.code } }))) {
    const settings = new SettingsService(prisma, new AuditService(prisma));
    for (const s of BILLING_SETTINGS) await settings.set({ key: s.key, scopeType: s.scopeType, scopeId: s.scopeId, value: s.value });
    if (!(await prisma.docSequence.findFirst({ where: { tenantId, name: 'bill' } }))) await prisma.docSequence.create({ data: { tenantId, name: 'bill', prefix: 'BL{YY}{MM}-', padding: 5 } });
    await prisma.notifyTemplate.create({ data: { tenantId, ...BILL_EMAIL } });
    await prisma.docTemplate.create({ data: { tenantId, code: BILL_TEMPLATE.code, name: BILL_TEMPLATE.name, layout: BILL_TEMPLATE.layout as unknown as Prisma.InputJsonValue } });
    const ops = await prisma.iamRole.findUnique({ where: { tenantId_code: { tenantId, code: 'OPERATIONS' } } });
    if (ops) await prisma.iamRole.update({ where: { id: ops.id }, data: { permissions: [...new Set([...ops.permissions, 'billing.read', 'billing.manage'])] } });
    log('Upgrade D46: billing settings (Zenmo postpaid monthly, Kranti prepaid), bill sequence, template, layout, permissions');
  }
}

// =====================================================================================================

const MAIN = ['RECEIVED', 'VALIDATED', 'CONFIRMED', 'ISSUED', 'QC_PASSED', 'STICKER_PRINTED', 'DISPATCHED', 'INWARDED', 'FITTED', 'COMPLETED'];
const PLAN: Array<[string, number]> = [
  ['RECEIVED', 4], ['VALIDATED', 3], ['AWAITING_APPROVAL', 4], ['AWAITING_PAYMENT', 5], ['CONFIRMED', 22], ['ISSUED', 12], ['QC_PASSED', 6],
  ['STICKER_PRINTED', 10], ['DISPATCHED', 15], ['INWARDED', 15], ['FITTED', 8], ['COMPLETED', 72], ['REJECTION_REVIEW', 6], ['REJECTED', 10], ['CANCELLED', 8],
];
const AGE: Record<string, [number, number]> = {
  RECEIVED: [0, 0], VALIDATED: [0, 1], AWAITING_APPROVAL: [0, 2], AWAITING_PAYMENT: [0, 2], CONFIRMED: [1, 4], ISSUED: [2, 5], QC_PASSED: [2, 5],
  STICKER_PRINTED: [3, 6], DISPATCHED: [3, 7], INWARDED: [4, 9], FITTED: [2, 4], COMPLETED: [8, 30], REJECTION_REVIEW: [2, 6], REJECTED: [1, 20], CANCELLED: [1, 15],
};
const CATEGORY = Object.fromEntries(VEHICLE_CATEGORIES.map((c) => [c.vahanCategory, c]));

interface Ctx {
  tenantId: string;
  now: number;
  dealers: Record<string, { id: string; code: string; stateCode: string; stationCode: string; walletId: string; oems: string[]; orgId: string; resourceId: string }>;
  oems: Record<string, { id: string; walletId: string; orgId: string }>;
  stations: Record<string, { id: string; orgId: string; laserPrefix: string; code: string }>;
  stock: Record<string, Array<{ id: string; laserCode: string; boxNo: string }>>;
  vehicles: SeedVehicle[];
  placeholderId: string;
}

async function seedOrders(prisma: PrismaService, wallets: WalletService, c: Ctx) {
  const { tenantId, now } = c;
  const usedVehicles = new Set<string>();
  const take = (pool: string, state: string, pred: (v: SeedVehicle) => boolean = () => true) => {
    const v = c.vehicles.find((x) => x.scenario === pool && x.stateCd === state && !usedVehicles.has(x.regnNo) && pred(x)) ??
      c.vehicles.find((x) => x.scenario === pool && !usedVehicles.has(x.regnNo) && pred(x));
    if (!v) throw new Error(`Seed ran out of ${pool} vehicles`);
    usedVehicles.add(v.regnNo);
    return v;
  };
  const stockPtr: Record<string, number> = {};
  const nextPlate = (stationCode: string, productCode: string) => {
    const key = `${stationCode}|${productCode}`;
    const i = (stockPtr[key] = (stockPtr[key] ?? -1) + 1);
    const p = c.stock[key][i];
    if (!p) throw new Error(`Seed ran out of ${productCode} plates at ${stationCode}`);
    return p;
  };
  const seqNo: Record<string, number> = {};
  const nextNo = (name: string, prefix: string, pad: number) => `${prefix}${String((seqNo[name] = (seqNo[name] ?? 0) + 1)).padStart(pad, '0')}`;
  const jobCards = new Map<string, { id: string; no: string; stationId: string; dealerId: string; orderIds: string[]; boxNos: Set<string>; plates: number; at: Date }>();
  const challans = new Map<string, { id: string; no: string; stationId: string; dealerId: string; at: Date; inwardedAt?: Date; lines: Prisma.ChallanLineCreateManyInput[] }>();
  const approvalsByUser = { ops: 'seed-ops', station: 'seed-station' };
  let mobileSeq = 0;
  let ordersMade = 0;

  for (const [target, count] of PLAN) {
    for (let i = 0; i < count; i++) {
      const state = r.next() < 0.55 ? 'WB' : 'OD';
      // ------------------------------------------------ decide kind, channel and vehicle
      let channel = 'DEALER_APP';
      let orderType = 'NEW';
      let path: string[];
      let rejectionReason: string | undefined;
      let rejectSource: 'QC' | 'DEALER_INWARD' | undefined;
      let cancelAfter: string | undefined;
      let vehicle: SeedVehicle;
      let dealerCode: string | undefined;

      const pickDealer = (st: string, pred: (d: Ctx['dealers'][string]) => boolean = () => true) => r.pick(Object.values(c.dealers).filter((d) => d.stateCode === st && pred(d))).code;

      if (target === 'AWAITING_PAYMENT') {
        channel = 'CUSTOMER_PORTAL';
        orderType = 'OLD';
        vehicle = take('seed-old', state);
        path = ['RECEIVED', 'VALIDATED', 'AWAITING_PAYMENT'];
      } else if (target === 'AWAITING_APPROVAL') {
        channel = i % 2 ? 'CUSTOMER_PORTAL' : 'DEALER_APP';
        orderType = 'REPLACEMENT';
        vehicle = take('seed-repl', state);
        path = ['RECEIVED', 'VALIDATED', 'AWAITING_APPROVAL'];
      } else if (target === 'VALIDATED') {
        vehicle = take('seed-new', 'OD', (v) => CATEGORY[v.vchCatg]?.vehicleClass === 'LMV');
        dealerCode = 'OD03';
        path = ['RECEIVED', 'VALIDATED'];
      } else if (target === 'REJECTED') {
        if (i < 6) {
          vehicle = take('seed-new', state);
          rejectionReason = r.pick([
            'VAHAN: Vehicle details not found',
            'VAHAN: Chassis number or engine number does not match',
            `Registered before the new-vehicle cut-off 2019-04-01; this is an old-vehicle order`,
            'Vehicle is registered in another state',
          ]);
          path = ['RECEIVED', 'REJECTED'];
        } else {
          orderType = 'REPLACEMENT';
          channel = 'CUSTOMER_PORTAL';
          vehicle = take('seed-repl', state);
          rejectionReason = 'Replacement rejected: police report is not legible, please re-apply';
          path = ['RECEIVED', 'VALIDATED', 'AWAITING_APPROVAL', 'REJECTED'];
        }
      } else if (target === 'CANCELLED') {
        if (i < 4) {
          channel = 'CUSTOMER_PORTAL';
          orderType = 'OLD';
          vehicle = take('seed-old', state);
          path = ['RECEIVED', 'VALIDATED', 'AWAITING_PAYMENT', 'CANCELLED'];
        } else {
          vehicle = take('seed-new', state);
          cancelAfter = 'CONFIRMED';
          path = ['RECEIVED', 'VALIDATED', 'CONFIRMED', 'CANCELLED'];
        }
      } else if (target === 'REJECTION_REVIEW') {
        rejectSource = i < 3 ? 'QC' : 'DEALER_INWARD';
        vehicle = take('seed-new', state);
        path = rejectSource === 'QC' ? [...MAIN.slice(0, MAIN.indexOf('ISSUED') + 1), 'REJECTION_REVIEW'] : [...MAIN.slice(0, MAIN.indexOf('DISPATCHED') + 1), 'REJECTION_REVIEW'];
      } else {
        // main path: CONFIRMED .. COMPLETED, plus RECEIVED
        const roll = r.next();
        if (target !== 'RECEIVED' && target !== 'QC_PASSED' && roll < 0.05) {
          orderType = 'REPLACEMENT';
          channel = r.next() < 0.5 ? 'CUSTOMER_PORTAL' : 'DEALER_APP';
          vehicle = take('seed-repl', state);
        } else if (target !== 'RECEIVED' && roll < 0.24) {
          orderType = 'OLD';
          channel = 'CUSTOMER_PORTAL';
          vehicle = take('seed-old', state, (v) => target !== 'QC_PASSED' || CATEGORY[v.vchCatg]?.stickerRequired);
        } else {
          channel = r.weighted<string>([['DEALER_APP', 50], ['OEM_API', 20], ['OEM_FILE', 20], ['STAFF_WEB', 10]]);
          const makerPred = (v: SeedVehicle) =>
            (channel === 'OEM_API' ? v.maker.startsWith('ZENMO') : channel === 'OEM_FILE' ? v.maker.startsWith('KRANTI') : true) &&
            (target !== 'QC_PASSED' || CATEGORY[v.vchCatg]?.stickerRequired) &&
            Boolean(CATEGORY[v.vchCatg]);
          vehicle = take('seed-new', state, makerPred);
        }
        const base = MAIN.slice(0, MAIN.indexOf(target) + 1);
        path = orderType === 'REPLACEMENT' ? ['RECEIVED', 'VALIDATED', 'AWAITING_APPROVAL', ...(channel === 'CUSTOMER_PORTAL' ? ['AWAITING_PAYMENT'] : []), ...base.slice(2)] : orderType === 'OLD' ? ['RECEIVED', 'VALIDATED', 'AWAITING_PAYMENT', ...base.slice(2)] : base;
        if (target === 'RECEIVED') path = ['RECEIVED'];
      }
      if (!CATEGORY[vehicle!.vchCatg]) vehicle = take('seed-new', state);
      const v = vehicle!;
      const st = v.stateCd;
      const oemCode = channel === 'OEM_API' ? 'ZENMO' : channel === 'OEM_FILE' ? 'KRANTI' : undefined;
      dealerCode ??= oemCode ? pickDealer(st, (d) => d.oems.includes(oemCode) && d.code !== 'OD03') : pickDealer(st, (d) => d.code !== 'OD03');
      const dealer = c.dealers[dealerCode];
      const station = c.stations[dealer.stationCode];
      const cat = CATEGORY[v.vchCatg];
      const greenStrip = /VI/.test(v.norms);
      const plateSet = orderType === 'REPLACEMENT' ? r.pick(['BOTH', 'FRONT', 'REAR']) : 'BOTH';
      const positions = plateSet === 'BOTH' ? ['FRONT', 'REAR'] : [plateSet];
      const basePaise = priceRupees(st, cat.vehicleClass, orderType, plateSet) * 100;
      const extras = [...(greenStrip ? [{ code: 'GREEN_STRIP', name: 'BS-VI green strip sticker', amountPaise: 2500 }] : []), ...(channel === 'CUSTOMER_PORTAL' ? [{ code: 'PORTAL_FEE', name: 'Online booking fee', amountPaise: 2000 }] : [])];
      const amountPaise = basePaise + extras.reduce((s, x) => s + x.amountPaise, 0);
      const isCustomer = channel === 'CUSTOMER_PORTAL';
      const mobile = isCustomer || st === 'OD' || r.next() < 0.6 ? `90000${String(10000 + ++mobileSeq).slice(-5)}` : null;

      // ------------------------------------------------ timeline
      const [minAge, maxAge] = AGE[target];
      const createdAt = new Date(now - (minAge + r.next() * (maxAge - minAge)) * DAY - r.int(1, 8) * 3600_000);
      const span = Math.max(3600_000, now - createdAt.getTime() - 1800_000);
      const times = path.map((_, k) => new Date(createdAt.getTime() + Math.round((span * k) / Math.max(1, path.length - 1)) * (k === 0 ? 0 : 1)));
      const at = (s: string) => times[path.lastIndexOf(s)] ?? createdAt;
      const reached = (s: string) => path.includes(s);
      const finalStatus = path[path.length - 1];

      const orderNo = `HS${st}${String(createdAt.getFullYear()).slice(-2)}${String(createdAt.getMonth() + 1).padStart(2, '0')}${String(90000 + ++ordersMade).slice(-5)}`;
      const vahanReply = {
        message: 'Success', fuel: v.fuel, maker: v.maker, vchType: v.vchType, norms: v.norms, vchCatg: v.vchCatg, regnDate: v.regnDate,
        hsrpFrontLaserCode: v.hsrpFrontLaserCode ?? '', hsrpRearLaserCode: v.hsrpRearLaserCode ?? '', stateCd: v.stateCd, offCd: v.offCd,
      };
      const quote = { ruleId: 'seed', basePaise, extras, totalPaise: amountPaise };
      const validated = reached('VALIDATED');
      const confirmed = reached('CONFIRMED');
      const issued = reached('ISSUED');

      const order = await prisma.order.create({
        data: {
          tenantId, orderNo, channel, orderType, plateSet, status: finalStatus, stateCode: st, regnNo: v.regnNo,
          chassisNo: isCustomer ? v.chassisNo.slice(-5) : v.chassisNo, engineNo: isCustomer ? v.engineNo.slice(-5) : v.engineNo,
          replacementReason: orderType === 'REPLACEMENT' ? r.pick(['DAMAGED', 'THEFT']) : null,
          evidenceFileId: orderType === 'REPLACEMENT' ? c.placeholderId : null,
          oemId: oemCode ? c.oems[oemCode].id : null, dealerId: dealer.id, stationId: station.id,
          sourceRef: oemCode ? `${oemCode}-${channel === 'OEM_API' ? 'PO' : 'INV'}-${String(700000 + ordersMade)}` : null,
          ...(validated
            ? { vehicleClass: cat.vehicleClass, vehicleType: cat.vehicleType, vahanCategory: cat.vahanCategory, fuel: v.fuel, maker: v.maker, norms: v.norms, regnDate: v.regnDate, greenStrip, stickerRequired: cat.stickerRequired, frontProductCode: cat.frontProductCode, rearProductCode: cat.rearProductCode, amountPaise }
            : {}),
          pendingPositions: issued && finalStatus !== 'CANCELLED' ? [] : positions,
          ownerName: `Demo Owner ${String(ordersMade).padStart(3, '0')}`, mobile, email: isCustomer ? `owner${ordersMade}@example.invalid` : null,
          priceSnapshot: confirmed ? (quote as Prisma.InputJsonValue) : undefined, vahanSnapshot: confirmed ? (vahanReply as Prisma.InputJsonValue) : undefined,
          rejectionReason: finalStatus === 'REJECTED' ? rejectionReason : null,
          cancelReason: finalStatus === 'CANCELLED' ? r.pick(['Customer changed mind', 'Duplicate order placed by mistake', 'Vehicle sold before fitment']) : null,
          remarks: target === 'VALIDATED' ? 'Waiting for wallet funds: wallet balance is not enough' : null,
          confirmedAt: confirmed ? at('CONFIRMED') : null, completedAt: reached('COMPLETED') ? at('COMPLETED') : null,
          createdBy: 'seed', createdAt, updatedAt: times[times.length - 1],
        },
      });

      // ------------------------------------------------ history and validations
      await prisma.orderStatusHistory.createMany({
        data: path.map((s, k) => ({ tenantId, orderId: order.id, fromStatus: k ? path[k - 1] : null, toStatus: s, trigger: k ? `seed:${s.toLowerCase()}` : `received:${channel}`, actorId: 'seed', createdAt: times[k], note: s === 'REJECTED' ? rejectionReason : null })),
      });
      if (validated) {
        await prisma.orderValidation.createMany({
          data: [
            { tenantId, orderId: order.id, step: 'vahan-check', outcome: 'PASS', message: `${v.maker} · ${v.vchCatg} · ${v.norms}`, data: vahanReply, createdAt: at('VALIDATED') },
            { tenantId, orderId: order.id, step: 'state-eligibility-rules', outcome: 'PASS', message: 'Eligible', createdAt: at('VALIDATED') },
            { tenantId, orderId: order.id, step: 'pricing', outcome: 'PASS', message: `₹${(amountPaise / 100).toFixed(2)}`, data: quote, createdAt: at('VALIDATED') },
          ],
        });
      } else if (finalStatus === 'REJECTED') {
        await prisma.orderValidation.create({ data: { tenantId, orderId: order.id, step: 'vahan-check', outcome: 'FAIL', message: rejectionReason, createdAt: times[1] } });
      }

      // ------------------------------------------------ money: wallet or payment
      if (!isCustomer && (confirmed || reached('AWAITING_APPROVAL'))) {
        const walletId = oemCode ? c.oems[oemCode].walletId : dealer.walletId;
        const hold = await wallets.hold(walletId, amountPaise, { subjectType: 'hsrp.order', subjectId: order.id });
        if (confirmed) await wallets.capture(hold.id);
        if (finalStatus === 'CANCELLED') await wallets.refundCaptured(hold.id);
        if (finalStatus === 'REJECTED') await wallets.release(hold.id);
        await prisma.order.update({ where: { id: order.id }, data: { walletHoldId: hold.id } });
      }
      if (isCustomer && (reached('AWAITING_PAYMENT') || confirmed)) {
        const paid = confirmed;
        const p = await prisma.payment.create({
          data: {
            tenantId, txnId: `TXNSEED${String(ordersMade).padStart(5, '0')}`, provider: 'payu', amountPaise, productInfo: `HSRP ${orderNo}`,
            payer: { name: `Demo Owner ${ordersMade}`, mobile }, subjectType: 'hsrp.order', subjectId: order.id,
            status: paid ? 'SUCCESS' : finalStatus === 'CANCELLED' ? 'CANCELLED' : 'CREATED', returnUrl: 'http://localhost:8080/portal/payment-return',
            providerRef: paid ? String(r.int(100000000, 999999999)) : null, succeededAt: paid ? at('CONFIRMED') : null, createdAt: at('AWAITING_PAYMENT'),
          },
        });
        await prisma.order.update({ where: { id: order.id }, data: { paymentId: p.id } });
        const slotDate = new Date(createdAt.getTime() + 3 * DAY).toISOString().slice(0, 10);
        const slotStart = r.pick(['10:00', '11:00', '12:00', '14:00', '15:00', '16:00']);
        const sb = await prisma.schedBooking.create({ data: { tenantId, resourceId: dealer.resourceId, date: slotDate, slotStart, subjectType: 'hsrp.order', subjectId: order.id, status: finalStatus === 'CANCELLED' ? 'CANCELLED' : 'BOOKED' } });
        await prisma.booking.create({ data: { tenantId, orderId: order.id, dealerId: dealer.id, schedBookingId: sb.id, slotDate, slotStart, status: finalStatus === 'CANCELLED' ? 'CANCELLED' : 'BOOKED' } });
      }

      // ------------------------------------------------ approvals
      if (reached('AWAITING_APPROVAL')) {
        const decided = finalStatus !== 'AWAITING_APPROVAL';
        const appr = await prisma.approvalRequest.create({
          data: {
            tenantId, type: 'replacement-order', subjectType: 'hsrp.order', subjectId: order.id, requiredRole: 'OPERATIONS',
            title: `Replacement ${orderNo} · ${v.regnNo} · ${order.replacementReason}`, details: { orderNo, regnNo: v.regnNo, reason: order.replacementReason, evidenceFileId: c.placeholderId, plateSet },
            status: !decided ? 'PENDING' : finalStatus === 'REJECTED' ? 'REJECTED' : 'APPROVED', requestedBy: 'seed',
            decidedBy: decided ? approvalsByUser.ops : null, remarks: decided ? (finalStatus === 'REJECTED' ? rejectionReason : 'Evidence checked, replacement approved') : null,
            decidedAt: decided ? times[path.indexOf('AWAITING_APPROVAL') + 1] : null, createdAt: at('AWAITING_APPROVAL'),
          },
        });
        await prisma.order.update({ where: { id: order.id }, data: { approvalId: appr.id } });
      }

      // ------------------------------------------------ production: allocation, job card, QC, sticker
      const allocations: Array<{ id: string; position: string; laserCode: string }> = [];
      if (issued) {
        const issueAt = at('ISSUED');
        const jcKey = `${dealer.id}|${issueAt.toISOString().slice(0, 10)}`;
        let jc = jobCards.get(jcKey);
        if (!jc) {
          jc = { id: randomUUID(), no: nextNo('jc', `JC${String(issueAt.getFullYear()).slice(-2)}${String(issueAt.getMonth() + 1).padStart(2, '0')}-`, 5), stationId: station.id, dealerId: dealer.id, orderIds: [], boxNos: new Set(), plates: 0, at: issueAt };
          jobCards.set(jcKey, jc);
        }
        jc.orderIds.push(order.id);
        const fitted = reached('FITTED');
        for (const pos of positions) {
          const product = pos === 'FRONT' ? cat.frontProductCode : cat.rearProductCode;
          const plate = nextPlate(station.code, product);
          jc.boxNos.add(plate.boxNo);
          jc.plates++;
          const a = await prisma.plateAllocation.create({ data: { tenantId, plateId: plate.id, laserCode: plate.laserCode, orderId: order.id, position: pos, jobCardId: jc.id, createdAt: issueAt } });
          await prisma.plate.update({ where: { id: plate.id }, data: { status: fitted ? 'FITTED' : 'ALLOCATED' } });
          allocations.push({ id: a.id, position: pos, laserCode: plate.laserCode });
        }
        if (reached('QC_PASSED')) await prisma.qcRecord.create({ data: { tenantId, orderId: order.id, result: 'PASS', positions: [], actorId: approvalsByUser.station, createdAt: at('QC_PASSED') } });
        if (reached('STICKER_PRINTED') && cat.stickerRequired) await prisma.stickerPrint.create({ data: { tenantId, orderId: order.id, printNo: 1, reprint: false, actorId: approvalsByUser.station, createdAt: at('STICKER_PRINTED') } });
      }

      // ------------------------------------------------ dispatch and inward
      if (reached('DISPATCHED')) {
        const dispAt = at('DISPATCHED');
        const inwarded = reached('INWARDED') || rejectSource === 'DEALER_INWARD';
        const key = `${dealer.id}|${dispAt.toISOString().slice(0, 10)}|${inwarded}`;
        let ch = challans.get(key);
        if (!ch) {
          ch = { id: randomUUID(), no: nextNo('dc', `DC${String(dispAt.getFullYear()).slice(-2)}${String(dispAt.getMonth() + 1).padStart(2, '0')}-`, 5), stationId: station.id, dealerId: dealer.id, at: dispAt, inwardedAt: inwarded ? at(reached('INWARDED') ? 'INWARDED' : 'REJECTION_REVIEW') : undefined, lines: [] };
          challans.set(key, ch);
        }
        for (const a of allocations) {
          const rejected = rejectSource === 'DEALER_INWARD' && a.position === 'REAR';
          ch.lines.push({
            tenantId, challanId: ch.id, orderId: order.id, allocationId: a.id, laserCode: a.laserCode, position: a.position,
            inwardStatus: !inwarded ? 'PENDING' : rejected ? 'REJECTED' : 'ACCEPTED', rejectReason: rejected ? 'Plate edge chipped in transit' : null,
          });
        }
      }

      // ------------------------------------------------ rejection review
      if (rejectSource) {
        const positionsRejected = rejectSource === 'QC' ? [positions[0]] : positions.includes('REAR') ? ['REAR'] : [positions[0]];
        const reason = rejectSource === 'QC' ? 'Embossing uneven on hologram area' : 'REAR: Plate edge chipped in transit';
        if (rejectSource === 'QC') await prisma.qcRecord.create({ data: { tenantId, orderId: order.id, result: 'REJECT', positions: positionsRejected, reason, actorId: approvalsByUser.station, createdAt: at('REJECTION_REVIEW') } });
        const rc = await prisma.rejectionCase.create({
          data: { tenantId, orderId: order.id, stationId: station.id, source: rejectSource, positions: positionsRejected, reason, returnStatus: rejectSource === 'QC' ? 'QC_PASSED' : 'INWARDED', createdAt: at('REJECTION_REVIEW') },
        });
        const appr = await prisma.approvalRequest.create({
          data: {
            tenantId, type: 'plate-rejection', subjectType: 'hsrp.rejection', subjectId: rc.id, requiredRole: 'STATION_USER', scopeOrgId: station.orgId,
            title: `${rejectSource === 'QC' ? 'QC' : 'Dealer'} rejection · ${orderNo} · ${positionsRejected.join(' + ')}`,
            details: { orderId: order.id, orderNo, regnNo: v.regnNo, source: rejectSource, positions: positionsRejected, reason, laserCodes: allocations.filter((a) => positionsRejected.includes(a.position)).map((a) => `${a.position}: ${a.laserCode}`) },
            requestedBy: 'seed', createdAt: at('REJECTION_REVIEW'),
          },
        });
        await prisma.rejectionCase.update({ where: { id: rc.id }, data: { approvalId: appr.id } });
      }

      // ------------------------------------------------ fitment and VAHAN
      if (reached('FITTED')) {
        const fittedAt = at('FITTED');
        const completed = reached('COMPLETED');
        const front = allocations.find((a) => a.position === 'FRONT')?.laserCode ?? null;
        const rear = allocations.find((a) => a.position === 'REAR')?.laserCode ?? null;
        const garbled = !completed && r.next() < 0.5;
        const f = await prisma.fitment.create({
          data: {
            tenantId, orderId: order.id, dealerId: dealer.id, frontLaserCode: front, rearLaserCode: rear, frontPhotoId: front ? c.placeholderId : null, rearPhotoId: rear ? c.placeholderId : null,
            fittedAt, recordedBy: 'seed', vahanStatus: completed ? 'POSTED' : 'MANUAL', postedAt: completed ? at('COMPLETED') : null,
            vahanReply: completed ? `HSRP details updated successfully for ${v.regnNo}` : garbled ? 'ERR#5503 <html>Gateway Timeout</html>' : 'VAHAN not reachable (timeout after 30 s)',
            createdAt: fittedAt,
          },
        });
        if (completed) {
          await prisma.mockVahanVehicle.update({ where: { regnNo: v.regnNo }, data: { hsrpFrontLaserCode: front ?? v.hsrpFrontLaserCode, hsrpRearLaserCode: rear ?? v.hsrpRearLaserCode } });
        } else {
          // Historical post that exhausted its retries: it sits in the manual queue; "Replay" on the integration monitor posts it.
          const ev = await prisma.outboxEvent.create({ data: { tenantId, eventType: 'FitmentRecorded', subjectType: 'hsrp.order', subjectId: order.id, payload: { orderId: order.id, orderNo, fitmentId: f.id }, occurredAt: fittedAt, dispatchedAt: fittedAt } });
          await prisma.outboxDelivery.create({
            data: { tenantId, eventId: ev.id, eventType: 'FitmentRecorded', subscriber: 'fitment.vahan-post', status: 'DEAD', attempts: 10, maxAttempts: 10, lastError: garbled ? 'Unrecognised VAHAN reply: ERR#5503 <html>Gateway Timeout</html>' : 'VAHAN not reachable (timeout after 30 s)', nextAttemptAt: fittedAt },
          });
        }
      }

      // RECEIVED orders: their validation is in the retry queue (VAHAN timed out); replay or wait to process them.
      if (finalStatus === 'RECEIVED') {
        const ev = await prisma.outboxEvent.create({ data: { tenantId, eventType: 'OrderReceived', subjectType: 'hsrp.order', subjectId: order.id, payload: { orderId: order.id, orderNo, channel }, occurredAt: createdAt, dispatchedAt: createdAt } });
        await prisma.outboxDelivery.create({
          data: { tenantId, eventId: ev.id, eventType: 'OrderReceived', subscriber: 'orders.validate', status: 'FAILED', attempts: 3, maxAttempts: 10, lastError: 'VAHAN not reachable (timeout after 30 s)', nextAttemptAt: new Date(now + 6 * 3600_000) },
        });
      }
    }
  }

  for (const jc of jobCards.values()) {
    await prisma.jobCard.create({ data: { id: jc.id, tenantId, jobCardNo: jc.no, stationId: jc.stationId, dealerId: jc.dealerId, orderIds: jc.orderIds, boxNos: [...jc.boxNos], plateCount: jc.plates, createdBy: 'seed', createdAt: jc.at } });
  }
  for (const ch of challans.values()) {
    await prisma.challan.create({ data: { id: ch.id, tenantId, challanNo: ch.no, stationId: ch.stationId, dealerId: ch.dealerId, status: ch.inwardedAt ? 'INWARDED' : 'CREATED', createdBy: 'seed', inwardedAt: ch.inwardedAt, inwardedBy: ch.inwardedAt ? 'seed' : null, createdAt: ch.at } });
    await prisma.challanLine.createMany({ data: ch.lines });
  }
  // Sequences continue after the seeded numbers.
  await prisma.docSequence.updateMany({ where: { tenantId, name: 'job-card' }, data: { nextValue: (seqNo.jc ?? 0) + 1 } });
  await prisma.docSequence.updateMany({ where: { tenantId, name: 'challan' }, data: { nextValue: (seqNo.dc ?? 0) + 1 } });
  await prisma.docSequence.updateMany({ where: { tenantId, name: 'order' }, data: { nextValue: 1 } });
  log(`Orders: ${ordersMade} across ${PLAN.length} statuses; ${jobCards.size} job cards; ${challans.size} challans`);
}

async function seedTickets(prisma: PrismaService, tenantId: string, now: number) {
  const rows = [
    { cat: 'PLATE_DELAY', title: 'Plates not received after 10 days', status: 'OPEN', age: 18 },
    { cat: 'FITMENT_ISSUE', title: 'Rear plate loose after fitment', status: 'IN_PROGRESS', age: 9 },
    { cat: 'PAYMENT', title: 'Paid twice for one order', status: 'RESOLVED', age: 12 },
    { cat: 'WRONG_DETAILS', title: 'Wrong engine number on sticker', status: 'IN_PROGRESS', age: 16 },
    { cat: 'OTHER', title: 'Cannot find fitment centre in my town', status: 'OPEN', age: 2 },
    { cat: 'PLATE_DELAY', title: 'Appointment missed by the centre', status: 'CLOSED', age: 25 },
    { cat: 'PAYMENT', title: 'Refund not received for cancelled order', status: 'OPEN', age: 6 },
    { cat: 'FITMENT_ISSUE', title: 'Front plate scratched', status: 'OPEN', age: 1 },
  ];
  let n = 0;
  for (const t of rows) {
    n++;
    const createdAt = new Date(now - t.age * DAY);
    const resolved = ['RESOLVED', 'CLOSED'].includes(t.status);
    const ticket = await prisma.ticket.create({
      data: {
        tenantId, ticketNo: `CMP-SEED-${String(n).padStart(3, '0')}`, categoryCode: t.cat, title: t.title, description: `${t.title}. (Fictional complaint created by the seed.)`,
        status: t.status, raisedByName: `Demo Complainant ${n}`, raisedByContact: `90001${String(10000 + n).slice(-5)}`, dueAt: new Date(createdAt.getTime() + 15 * DAY),
        resolvedAt: resolved ? new Date(createdAt.getTime() + 5 * DAY) : null, createdAt,
      },
    });
    await prisma.ticketEvent.create({ data: { tenantId, ticketId: ticket.id, kind: 'CREATED', message: ticket.description, toStatus: 'OPEN', actor: ticket.raisedByName, createdAt } });
    if (t.status !== 'OPEN') {
      await prisma.ticketEvent.create({ data: { tenantId, ticketId: ticket.id, kind: 'STATUS', message: resolved ? 'Checked with the centre and fixed.' : 'We are checking with the fitment centre.', fromStatus: 'OPEN', toStatus: t.status, actor: 'Omkar Operations (demo)', createdAt: new Date(createdAt.getTime() + 2 * DAY) } });
    }
  }
  log(`Tickets: ${rows.length} (some past the 15-day limit)`);
}

main().catch((e) => {
  console.error('[seed] failed:', e);
  process.exit(1);
});
