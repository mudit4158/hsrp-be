import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { NonRetryableError, Problem } from '../../platform/http/problem';
import { DeliveredEvent, EventBus } from '../integration-hub/event-bus.service';
import { FileService } from '../file-storage/file.service';
import { mapRow, MappingProfile, parseCsv, toCsv } from './csv';

export interface ImportRowContext {
  jobId: string;
  rowNo: number;
  profileCode: string;
  context: Record<string, string>;
}

/** A consumer (e.g. a core module) registers a target type and processes mapped rows. Throw to mark a row bad. */
export interface ImportTarget {
  processRow(mapped: Record<string, string>, ctx: ImportRowContext): Promise<{ ref?: string }>;
}

/**
 * File intake with per-source mapping profiles. Rows are mapped and checked on upload; good rows are then
 * processed from the outbox by the registered target. Bad rows go to a downloadable error report.
 */
@Injectable()
export class ImportService implements OnModuleInit {
  private readonly targets = new Map<string, ImportTarget>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
    private readonly files: FileService,
  ) {}

  onModuleInit() {
    this.bus.subscribe('ImportRowsReady', 'import.process', (e) => this.process(e));
  }

  registerTarget(targetType: string, target: ImportTarget) {
    this.targets.set(targetType, target);
  }

  async start(input: { profileCode: string; filename: string; data: Buffer; context?: Record<string, string> }) {
    const tenantId = requestContext.tenantId();
    const profile = await this.prisma.importProfile.findUnique({ where: { tenantId_code: { tenantId, code: input.profileCode } } });
    if (!profile) throw Problem.badRequest(`Unknown import profile ${input.profileCode}`, 'profile-unknown');
    if (!this.targets.has(profile.targetType)) throw Problem.badRequest(`No handler for ${profile.targetType}`, 'target-unknown');

    let raw: Record<string, string>[];
    try {
      raw = parseCsv(input.data.toString('utf8'), profile.delimiter);
    } catch (e) {
      throw Problem.badRequest(`Could not read the CSV: ${(e as Error).message}`, 'csv-invalid');
    }
    if (raw.length === 0) throw Problem.badRequest('The file has no data rows', 'csv-empty');
    if (raw.length > 5000) throw Problem.badRequest('At most 5000 rows per file', 'csv-too-large');
    const mapping = profile.mapping as unknown as MappingProfile;
    const missing = Object.values(mapping.columns).filter((c) => c.required && !(c.from in raw[0])).map((c) => c.from);
    if (missing.length) throw Problem.badRequest(`Missing column(s) for profile ${profile.code}: ${missing.join(', ')}`, 'csv-columns');

    const file = await this.files.upload({ data: input.data, filename: input.filename, mimeType: 'text/csv', purpose: 'import' });
    return this.prisma.tx(async (tx) => {
      const job = await tx.importJob.create({
        data: { tenantId, profileCode: profile.code, targetType: profile.targetType, fileId: file.id, filename: input.filename, totalRows: raw.length, status: 'PROCESSING', createdBy: requestContext.actorId() },
      });
      let errorRows = 0;
      await tx.importRow.createMany({
        data: raw.map((r, i) => {
          const { mapped, errors } = mapRow(r, mapping);
          if (errors.length) errorRows++;
          return {
            tenantId,
            jobId: job.id,
            rowNo: i + 2,
            raw: r as Prisma.InputJsonValue,
            mapped: mapped as Prisma.InputJsonValue,
            status: errors.length ? 'ERROR' : 'PENDING',
            errors: errors.length ? errors : undefined,
          };
        }),
      });
      await tx.importJob.update({ where: { id: job.id }, data: { errorRows } });
      await this.files.attach(file.id, { subjectType: 'import-job', subjectId: job.id, purpose: 'import' }, tx);
      await this.bus.publish(tx, {
        type: 'ImportRowsReady',
        subjectType: 'import-job',
        subjectId: job.id,
        payload: { jobId: job.id, context: { ...(mapping.context ?? {}), ...(input.context ?? {}) } },
      });
      return job;
    });
  }

  async job(id: string) {
    const job = await this.prisma.importJob.findFirst({ where: { id, tenantId: requestContext.tenantId() } });
    if (!job) throw Problem.notFound('Import job');
    return job;
  }

  rows(jobId: string, status?: string) {
    return this.prisma.importRow.findMany({ where: { jobId, ...(status ? { status } : {}) }, orderBy: { rowNo: 'asc' } });
  }

  async errorReport(jobId: string): Promise<string> {
    await this.job(jobId);
    const rows = await this.rows(jobId, 'ERROR');
    const rawKeys = [...new Set(rows.flatMap((r) => Object.keys(r.raw as object)))];
    return toCsv(
      rows.map((r) => ({ row: r.rowNo, errors: ((r.errors as string[]) ?? []).join('; '), ...(r.raw as object) })),
      [{ key: 'row', label: 'Row' }, { key: 'errors', label: 'Errors' }, ...rawKeys.map((k) => ({ key: k, label: k }))],
    );
  }

  private async process(e: DeliveredEvent) {
    const job = await this.prisma.importJob.findUnique({ where: { id: String(e.payload.jobId) } });
    if (!job) throw new NonRetryableError('Import job not found');
    const target = this.targets.get(job.targetType);
    if (!target) throw new Error(`No handler for ${job.targetType}`);
    const pending = await this.prisma.importRow.findMany({ where: { jobId: job.id, status: 'PENDING' }, orderBy: { rowNo: 'asc' } });
    for (const row of pending) {
      try {
        const res = await target.processRow(row.mapped as Record<string, string>, {
          jobId: job.id,
          rowNo: row.rowNo,
          profileCode: job.profileCode,
          context: (e.payload.context ?? {}) as Record<string, string>,
        });
        await this.prisma.importRow.update({ where: { id: row.id }, data: { status: 'OK', resultRef: res.ref } });
      } catch (err) {
        const msg = err instanceof Problem ? (err.detail ?? err.title) : (err as Error).message;
        await this.prisma.importRow.update({ where: { id: row.id }, data: { status: 'ERROR', errors: [msg] } });
      }
    }
    const [ok, bad] = await Promise.all([
      this.prisma.importRow.count({ where: { jobId: job.id, status: 'OK' } }),
      this.prisma.importRow.count({ where: { jobId: job.id, status: 'ERROR' } }),
    ]);
    await this.prisma.importJob.update({ where: { id: job.id }, data: { status: 'DONE', okRows: ok, errorRows: bad } });
  }
}
