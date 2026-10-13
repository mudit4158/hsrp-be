import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OemVehicleRecord } from '@hsrp/contracts';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { pageArgs, pageOf } from '../../platform/http/pagination';
import { Problem } from '../../platform/http/problem';
import { ImportService } from '../../utility/import-export/import.service';
import { MastersService } from '../masters/masters.service';
import type { OemVehicleFacts } from './validation-steps';

/**
 * OEM vehicle data: the vehicles an OEM reports as built and supplied to its dealers, loaded from the OEM's
 * vehicle data file (Import utility, one mapping profile per OEM). New-vehicle orders are checked against it.
 */
@Injectable()
export class OemVehicleDataService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masters: MastersService,
    private readonly imports: ImportService,
  ) {}

  onModuleInit() {
    this.imports.registerTarget('hsrp.oem-vehicle', {
      processRow: async (row, ctx) => {
        const oemCode = ctx.context.oemCode;
        if (!oemCode) throw new Error('Import profile has no oemCode in its context');
        const parsed = OemVehicleRecord.safeParse(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === '' ? undefined : v])));
        if (!parsed.success) throw Problem.badRequest(parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '));
        const rec = await this.record(oemCode, parsed.data, ctx.jobId);
        return { ref: rec.id };
      },
    });
  }

  /** Adds or refreshes one vehicle. A chassis already on file with a different engine is refused, not overwritten. */
  async record(oemCode: string, r: OemVehicleRecord, importJobId?: string) {
    const tenantId = requestContext.tenantId();
    const oem = await this.masters.oemByCode(oemCode);
    const dealer = await this.masters.dealerByCode(r.dealerCode);
    if (!(await this.masters.dealerServesOem(dealer.id, oem.id))) throw Problem.badRequest(`Dealer ${r.dealerCode} is not a ${oem.name} dealer`);
    const existing = await this.prisma.oemVehicle.findUnique({ where: { tenantId_oemId_chassisNo: { tenantId, oemId: oem.id, chassisNo: r.chassisNo } } });
    if (existing && existing.engineNo !== r.engineNo) {
      throw Problem.conflict(`Chassis ${r.chassisNo} is already on file with engine ending ${existing.engineNo.slice(-5)}; correct it with the OEM`);
    }
    const data = {
      engineNo: r.engineNo,
      model: r.model,
      vahanCategory: r.vahanCategory,
      dealerId: dealer.id,
      invoiceNo: r.invoiceNo,
      invoiceDate: r.invoiceDate,
      source: 'FILE',
      importJobId,
    };
    return existing
      ? this.prisma.oemVehicle.update({ where: { id: existing.id }, data })
      : this.prisma.oemVehicle.create({ data: { tenantId, oemId: oem.id, chassisNo: r.chassisNo, ...data } });
  }

  /** The OEM's record for a chassis, in the form the validation step judges. Any OEM when `oemId` is not given. */
  async facts(chassisNo: string, oemId?: string | null): Promise<OemVehicleFacts | null> {
    const row = await this.prisma.oemVehicle.findFirst({
      where: { tenantId: requestContext.tenantId(), chassisNo: chassisNo.toUpperCase(), ...(oemId ? { oemId } : {}) },
      orderBy: { updatedAt: 'desc' },
    });
    if (!row) return null;
    const [oem, dealer] = await Promise.all([this.masters.oem(row.oemId), row.dealerId ? this.masters.dealer(row.dealerId) : null]);
    return { oemName: oem?.name ?? 'OEM', model: row.model, engineNo: row.engineNo, dealerCode: dealer?.code ?? null, invoiceDate: row.invoiceDate };
  }

  async list(q: { page: number; pageSize: number; oemCode?: string; q?: string; importJobId?: string }) {
    const where: Prisma.OemVehicleWhereInput = { tenantId: requestContext.tenantId() };
    if (q.oemCode) where.oemId = (await this.masters.oemByCode(q.oemCode)).id;
    if (q.importJobId) where.importJobId = q.importJobId;
    if (q.q) where.OR = [{ chassisNo: { contains: q.q.toUpperCase() } }, { engineNo: { contains: q.q.toUpperCase() } }, { model: { contains: q.q, mode: 'insensitive' } }];
    const [rows, total] = await Promise.all([
      this.prisma.oemVehicle.findMany({ where, orderBy: { updatedAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.oemVehicle.count({ where }),
    ]);
    const [oems, dealers] = await Promise.all([
      Promise.all([...new Set(rows.map((r) => r.oemId))].map((id) => this.masters.oem(id))),
      this.masters.dealers([...new Set(rows.map((r) => r.dealerId).filter(Boolean) as string[])]),
    ]);
    const items = rows.map((r) => ({
      ...r,
      oemCode: oems.find((o) => o?.id === r.oemId)?.code,
      dealerCode: dealers.find((d) => d.id === r.dealerId)?.code ?? null,
    }));
    return pageOf(items, total, q);
  }

  /** Records per OEM and per import job, for the OEM history report. */
  async countsByJob(jobIds: string[]) {
    if (!jobIds.length) return {};
    const rows = await this.prisma.oemVehicle.groupBy({ by: ['importJobId'], where: { tenantId: requestContext.tenantId(), importJobId: { in: jobIds } }, _count: true });
    return Object.fromEntries(rows.map((r) => [r.importJobId, r._count]));
  }
}
