import { Injectable, OnModuleInit } from '@nestjs/common';
import { Dealer, Oem, Station } from '@prisma/client';
import { z, ZodTypeAny } from 'zod';
import { requestContext } from '../../platform/context/request-context';
import { Db, PrismaService } from '../../platform/database/prisma.service';
import { Problem } from '../../platform/http/problem';
import { ApprovalsService } from '../../utility/approvals/approvals.service';
import { AuditService } from '../../utility/audit/audit.service';
import { IdentityService } from '../../utility/identity/identity.service';
import { EventBus } from '../../utility/integration-hub/event-bus.service';
import { SchedulingService } from '../../utility/scheduling/scheduling.service';
import { WalletService } from '../../utility/wallet/wallet.service';
import { APPROVAL, SUBJECT } from '../shared/subjects';
import { VEHICLE_CLASSES, VEHICLE_TYPES } from '@hsrp/contracts';

const code = z.string().trim().min(2).max(20).regex(/^[A-Z0-9_-]+$/i).transform((s) => s.toUpperCase());

/** Field schemas for the generic master screens. Keys are URL names; `model` is the Prisma delegate. */
export const MASTER_RESOURCES: Record<string, { model: string; label: string; create: ZodTypeAny; orderBy: string }> = {
  states: {
    model: 'state',
    label: 'States',
    orderBy: 'code',
    create: z.object({ code: z.string().length(2).toUpperCase(), name: z.string().min(2), rulePack: z.string().min(2), active: z.boolean().default(true) }),
  },
  companies: {
    model: 'company',
    label: 'Companies',
    orderBy: 'code',
    create: z.object({ code, name: z.string().min(2), address: z.string().optional(), gstin: z.string().optional() }),
  },
  stations: {
    model: 'station',
    label: 'Embossing stations',
    orderBy: 'code',
    create: z.object({ code, name: z.string().min(2), companyId: z.string(), stateCode: z.string().length(2), city: z.string().min(2), address: z.string().optional(), active: z.boolean().default(true) }),
  },
  oems: {
    model: 'oem',
    label: 'OEMs',
    orderBy: 'code',
    create: z.object({ code, name: z.string().min(2), integration: z.enum(['API', 'CSV']), requiresCatalogueCheck: z.boolean().default(false), importProfileCode: z.string().optional(), active: z.boolean().default(true) }),
  },
  dealers: {
    model: 'dealer',
    label: 'Dealers',
    orderBy: 'code',
    create: z.object({
      code,
      name: z.string().min(2),
      stateCode: z.string().length(2),
      city: z.string().min(2),
      address: z.string().optional(),
      mobile: z.string().optional(),
      email: z.string().email().optional(),
      stationId: z.string(),
      walletGroup: z.string().min(2),
      acceptsCustomerOrders: z.boolean().default(true),
    }),
  },
  'dealer-oems': {
    model: 'dealerOem',
    label: 'Dealer ↔ OEM mapping',
    orderBy: 'createdAt',
    create: z.object({ dealerId: z.string(), oemId: z.string() }),
  },
  products: {
    model: 'product',
    label: 'Products (plate sizes)',
    orderBy: 'code',
    create: z.object({ code, name: z.string().min(2), sizeMm: z.string().min(3), active: z.boolean().default(true) }),
  },
  'vehicle-categories': {
    model: 'vehicleCategory',
    label: 'Vehicle categories',
    orderBy: 'vahanCategory',
    create: z.object({
      vahanCategory: z.string().min(2).toUpperCase(),
      description: z.string().min(2),
      vehicleClass: z.enum(VEHICLE_CLASSES),
      vehicleType: z.enum(VEHICLE_TYPES),
      frontProductCode: z.string(),
      rearProductCode: z.string(),
      stickerRequired: z.boolean().default(false),
    }),
  },
};

type Delegate = {
  findMany(args: unknown): Promise<Record<string, unknown>[]>;
  findFirst(args: unknown): Promise<Record<string, unknown> | null>;
  create(args: unknown): Promise<Record<string, unknown>>;
  update(args: unknown): Promise<Record<string, unknown>>;
};

/** HSRP masters: states, company, stations, OEMs, dealers and mappings, products, vehicle categories. */
@Injectable()
export class MastersService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly identity: IdentityService,
    private readonly wallets: WalletService,
    private readonly scheduling: SchedulingService,
    private readonly approvals: ApprovalsService,
    private readonly bus: EventBus,
  ) {}

  onModuleInit() {
    this.bus.subscribe('ApprovalDecided', 'masters.dealer-onboarding', async (e) => {
      if (e.payload.approvalType !== APPROVAL.dealerOnboarding) return;
      const status = e.payload.decision === 'APPROVED' ? 'ACTIVE' : 'REJECTED';
      await this.prisma.dealer.update({ where: { id: String(e.payload.subjectId) }, data: { status } });
    });
  }

  private delegate(db: Db, resource: string): Delegate {
    const r = MASTER_RESOURCES[resource];
    if (!r) throw Problem.notFound('Master');
    return (db as unknown as Record<string, Delegate>)[r.model];
  }

  list(resource: string, q?: string) {
    const r = MASTER_RESOURCES[resource];
    if (!r) throw Problem.notFound('Master');
    const where: Record<string, unknown> = { tenantId: requestContext.tenantId() };
    if (q && ['states', 'companies', 'stations', 'oems', 'dealers', 'products'].includes(resource)) {
      where.OR = [{ code: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }];
    }
    return this.delegate(this.prisma, resource).findMany({ where, orderBy: { [r.orderBy]: 'asc' }, take: 500 });
  }

  async create(resource: string, body: unknown) {
    const r = MASTER_RESOURCES[resource];
    if (!r) throw Problem.notFound('Master');
    const data = r.create.parse(body) as Record<string, unknown>;
    return this.prisma.tx(async (tx) => {
      const row = resource === 'dealers' ? await this.createDealer(tx, data) : await this.delegate(tx, resource).create({ data: { tenantId: requestContext.tenantId(), ...data } });
      if (resource === 'stations') await this.ensureStationOrg(tx, row as unknown as Station);
      if (resource === 'oems') await this.ensureOemSetup(tx, row as unknown as Oem);
      await this.audit.record({ action: `master.${resource}.create`, subjectType: `hsrp.master.${resource}`, subjectId: String(row.id), after: row }, tx);
      return row;
    });
  }

  async update(resource: string, id: string, body: unknown) {
    const r = MASTER_RESOURCES[resource];
    if (!r) throw Problem.notFound('Master');
    const patch = (r.create as unknown as z.AnyZodObject).partial().parse(body) as Record<string, unknown>;
    return this.prisma.tx(async (tx) => {
      const d = this.delegate(tx, resource);
      const before = await d.findFirst({ where: { id, tenantId: requestContext.tenantId() } });
      if (!before) throw Problem.notFound('Record');
      const after = await d.update({ where: { id }, data: patch });
      await this.audit.record({ action: `master.${resource}.update`, subjectType: `hsrp.master.${resource}`, subjectId: id, before, after }, tx);
      return after;
    });
  }

  /** New dealers get an org node, a (possibly shared) wallet, a fitment calendar, and wait for onboarding approval. */
  private async createDealer(tx: Db, data: Record<string, unknown>) {
    const tenantId = requestContext.tenantId();
    const station = await tx.station.findFirst({ where: { id: String(data.stationId), tenantId } });
    if (!station) throw Problem.badRequest('Unknown station');
    const org = await this.identity.upsertOrg({ code: `DLR-${data.code}`, name: String(data.name), orgType: 'DEALER', parentId: station.orgId });
    const wallet = await this.wallets.openWallet({ ownerType: SUBJECT.walletGroup, ownerId: String(data.walletGroup), name: `Wallet ${data.walletGroup}` }, tx);
    const dealer = await tx.dealer.create({ data: { tenantId, ...(data as object), orgId: org.id, walletAccountId: wallet.id, status: 'PENDING' } as never });
    const res = await this.scheduling.upsertResource({ code: `fitment-${dealer.code}`, name: `Fitment bay ${dealer.name}`, subjectType: SUBJECT.dealer, subjectId: dealer.id }, tx);
    await this.scheduling.setCalendar(res.id, [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: '10:00', endTime: '17:00', slotMinutes: 60, capacity: 4 })), tx);
    await this.approvals.request(
      { type: APPROVAL.dealerOnboarding, subjectType: SUBJECT.dealer, subjectId: dealer.id, requiredRole: 'OPERATIONS', title: `Onboard dealer ${dealer.code} ${dealer.name}`, details: { city: dealer.city, stateCode: dealer.stateCode } },
      tx,
    );
    return dealer as unknown as Record<string, unknown>;
  }

  private async ensureStationOrg(tx: Db, station: Station) {
    const org = await this.identity.upsertOrg({ code: `STN-${station.code}`, name: station.name, orgType: 'STATION' });
    await tx.station.update({ where: { id: station.id }, data: { orgId: org.id } });
  }

  private async ensureOemSetup(tx: Db, oem: Oem) {
    const org = await this.identity.upsertOrg({ code: `OEM-${oem.code}`, name: oem.name, orgType: 'OEM' });
    const wallet = await this.wallets.openWallet({ ownerType: SUBJECT.oem, ownerId: oem.code, name: `OEM ${oem.name}`, creditLimitPaise: 50_000_000 }, tx);
    await tx.oem.update({ where: { id: oem.id }, data: { orgId: org.id, walletAccountId: wallet.id } });
  }

  // ---------------------------------------------------------------- lookups used by other core modules

  async dealerByCode(code: string, db: Db = this.prisma) {
    const d = await db.dealer.findUnique({ where: { tenantId_code: { tenantId: requestContext.tenantId(), code: code.toUpperCase() } } });
    if (!d) throw Problem.unprocessable(`Unknown dealer ${code}`, 'dealer-unknown');
    return d;
  }

  async dealer(id: string, db: Db = this.prisma): Promise<Dealer> {
    const d = await db.dealer.findFirst({ where: { id, tenantId: requestContext.tenantId() } });
    if (!d) throw Problem.notFound('Dealer');
    return d;
  }

  dealers(ids: string[]) {
    return this.prisma.dealer.findMany({ where: { id: { in: ids } } });
  }

  dealerForOrg(orgId: string | null | undefined, db: Db = this.prisma) {
    if (!orgId) return Promise.resolve(null);
    return db.dealer.findFirst({ where: { orgId, tenantId: requestContext.tenantId() } });
  }

  stationForOrg(orgId: string | null | undefined, db: Db = this.prisma) {
    if (!orgId) return Promise.resolve(null);
    return db.station.findFirst({ where: { orgId, tenantId: requestContext.tenantId() } });
  }

  oemForOrg(orgId: string | null | undefined) {
    if (!orgId) return Promise.resolve(null);
    return this.prisma.oem.findFirst({ where: { orgId, tenantId: requestContext.tenantId() } });
  }

  async station(id: string, db: Db = this.prisma) {
    const s = await db.station.findFirst({ where: { id, tenantId: requestContext.tenantId() } });
    if (!s) throw Problem.notFound('Station');
    return s;
  }

  async stationByCode(code: string, db: Db = this.prisma) {
    const s = await db.station.findUnique({ where: { tenantId_code: { tenantId: requestContext.tenantId(), code: code.toUpperCase() } } });
    if (!s) throw Problem.badRequest(`Unknown station ${code}`);
    return s;
  }

  async productByCode(code: string, db: Db = this.prisma) {
    const p = await db.product.findUnique({ where: { tenantId_code: { tenantId: requestContext.tenantId(), code: code.toUpperCase() } } });
    if (!p) throw Problem.badRequest(`Unknown product ${code}`);
    return p;
  }

  stations() {
    return this.prisma.station.findMany({ where: { tenantId: requestContext.tenantId() }, orderBy: { code: 'asc' } });
  }

  async oemByCode(code: string, db: Db = this.prisma) {
    const o = await db.oem.findUnique({ where: { tenantId_code: { tenantId: requestContext.tenantId(), code: code.toUpperCase() } } });
    if (!o) throw Problem.unprocessable(`Unknown OEM ${code}`, 'oem-unknown');
    return o;
  }

  oem(id: string, db: Db = this.prisma) {
    return db.oem.findFirst({ where: { id, tenantId: requestContext.tenantId() } });
  }

  oems() {
    return this.prisma.oem.findMany({ where: { tenantId: requestContext.tenantId() }, orderBy: { code: 'asc' } });
  }

  /** Dealers mapped to an OEM (the OEM × dealer pairs billing is configured for). */
  async dealersForOem(oemId: string) {
    const links = await this.prisma.dealerOem.findMany({ where: { oemId } });
    return this.prisma.dealer.findMany({ where: { id: { in: links.map((l) => l.dealerId) } }, orderBy: { code: 'asc' } });
  }

  async dealerServesOem(dealerId: string, oemId: string, db: Db = this.prisma) {
    return Boolean(await db.dealerOem.findUnique({ where: { dealerId_oemId: { dealerId, oemId } } }));
  }

  async state(code: string, db: Db = this.prisma) {
    const s = await db.state.findUnique({ where: { tenantId_code: { tenantId: requestContext.tenantId(), code } } });
    if (!s?.active) throw Problem.unprocessable(`State ${code} is not served`, 'state-not-served');
    return s;
  }

  vehicleCategory(vahanCategory: string, db: Db = this.prisma) {
    return db.vehicleCategory.findUnique({ where: { tenantId_vahanCategory: { tenantId: requestContext.tenantId(), vahanCategory: vahanCategory.toUpperCase() } } });
  }

  /** Dealers that fit plates for customers, optionally in one city. */
  fitmentCentres(stateCode: string, city?: string) {
    return this.prisma.dealer.findMany({
      where: { tenantId: requestContext.tenantId(), stateCode, status: 'ACTIVE', acceptsCustomerOrders: true, ...(city ? { city: { equals: city, mode: 'insensitive' } } : {}) },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, city: true, address: true, stateCode: true },
    });
  }

  async cities(stateCode: string) {
    const rows = await this.prisma.dealer.findMany({
      where: { tenantId: requestContext.tenantId(), stateCode, status: 'ACTIVE', acceptsCustomerOrders: true },
      distinct: ['city'],
      select: { city: true },
      orderBy: { city: 'asc' },
    });
    return rows.map((r) => r.city);
  }

  activeStates() {
    return this.prisma.state.findMany({ where: { tenantId: requestContext.tenantId(), active: true }, orderBy: { name: 'asc' } });
  }
}
