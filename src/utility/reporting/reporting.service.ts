import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { Problem } from '../../platform/http/problem';
import { toCsv } from '../import-export/csv';

export interface ReportParam {
  name: string;
  label: string;
  type: 'date' | 'text' | 'select';
  options?: string[];
}

export interface ReportDefinition {
  code: string;
  name: string;
  description: string;
  params: ReportParam[];
  columns: Array<{ key: string; label: string }>;
  /** Read-only query. Receives validated string params; returns plain rows. */
  run(params: Record<string, string>): Promise<Record<string, unknown>[]>;
}

/** Registry of read-only reports, saved parameter sets and CSV export. Report content comes from consumers. */
@Injectable()
export class ReportingService {
  private readonly defs = new Map<string, ReportDefinition>();

  constructor(private readonly prisma: PrismaService) {}

  register(def: ReportDefinition) {
    this.defs.set(def.code, def);
  }

  list() {
    return [...this.defs.values()].map(({ run: _run, ...d }) => d);
  }

  async run(code: string, params: Record<string, string>) {
    const def = this.defs.get(code);
    if (!def) throw Problem.notFound('Report');
    const clean = Object.fromEntries(def.params.filter((p) => params[p.name]).map((p) => [p.name, String(params[p.name])]));
    const rows = await def.run(clean);
    return { code, name: def.name, columns: def.columns, rows };
  }

  async csv(code: string, params: Record<string, string>) {
    const r = await this.run(code, params);
    return toCsv(r.rows, r.columns);
  }

  saved() {
    return this.prisma.savedReport.findMany({ where: { tenantId: requestContext.tenantId() }, orderBy: { name: 'asc' } });
  }

  save(input: { reportCode: string; name: string; params: Record<string, string> }) {
    if (!this.defs.has(input.reportCode)) throw Problem.notFound('Report');
    return this.prisma.savedReport.create({
      data: { tenantId: requestContext.tenantId(), reportCode: input.reportCode, name: input.name, params: input.params as Prisma.InputJsonValue, ownerUserId: requestContext.actorId() },
    });
  }
}
