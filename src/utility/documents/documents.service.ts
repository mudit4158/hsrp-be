import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requestContext } from '../../platform/context/request-context';
import { Db, PrismaService } from '../../platform/database/prisma.service';
import { Problem } from '../../platform/http/problem';
import { Layout, renderPdf } from './pdf-renderer';

/** Prefix tokens: {YYYY} {YY} {MM} {DD}, plus any {name} passed in `vars`. */
export function formatNumber(prefix: string, value: number, padding: number, now: Date, vars: Record<string, string> = {}) {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const tokens: Record<string, string> = {
    YYYY: String(ist.getUTCFullYear()),
    YY: String(ist.getUTCFullYear()).slice(-2),
    MM: String(ist.getUTCMonth() + 1).padStart(2, '0'),
    DD: String(ist.getUTCDate()).padStart(2, '0'),
    ...vars,
  };
  return prefix.replace(/\{(\w+)\}/g, (_, t: string) => tokens[t] ?? '') + String(value).padStart(padding, '0');
}

/** Template + data gives a PDF; named number sequences give unique document numbers. */
@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Atomically takes the next number of a sequence (inside the caller's transaction when given). */
  async nextNumber(name: string, db: Db = this.prisma, vars?: Record<string, string>): Promise<string> {
    const tenantId = requestContext.tenantId();
    const rows = await db.$queryRaw<Array<{ prefix: string; value: number; padding: number }>>`
      UPDATE util_doc_sequence SET next_value = next_value + 1, updated_at = now()
      WHERE tenant_id = ${tenantId} AND name = ${name}
      RETURNING prefix, next_value - 1 AS value, padding`;
    if (!rows.length) throw Problem.badRequest(`Number sequence ${name} is not configured`, 'sequence-missing');
    return formatNumber(rows[0].prefix, Number(rows[0].value), rows[0].padding, new Date(), vars);
  }

  async ensureSequence(name: string, prefix: string, padding = 6, db: Db = this.prisma) {
    const tenantId = requestContext.tenantId();
    return db.docSequence.upsert({ where: { tenantId_name: { tenantId, name } }, create: { tenantId, name, prefix, padding }, update: {} });
  }

  async render(templateCode: string, data: Record<string, unknown>): Promise<Buffer> {
    const tpl = await this.prisma.docTemplate.findUnique({ where: { tenantId_code: { tenantId: requestContext.tenantId(), code: templateCode } } });
    if (!tpl) throw Problem.badRequest(`Print template ${templateCode} is not configured`, 'template-missing');
    return renderPdf(tpl.layout as unknown as Layout, data);
  }

  async upsertTemplate(code: string, name: string, layout: Layout, db: Db = this.prisma) {
    const tenantId = requestContext.tenantId();
    return db.docTemplate.upsert({
      where: { tenantId_code: { tenantId, code } },
      create: { tenantId, code, name, layout: layout as unknown as Prisma.InputJsonValue },
      update: { name, layout: layout as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
    });
  }

  listTemplates() {
    return this.prisma.docTemplate.findMany({ where: { tenantId: requestContext.tenantId() }, orderBy: { code: 'asc' } });
  }
}
