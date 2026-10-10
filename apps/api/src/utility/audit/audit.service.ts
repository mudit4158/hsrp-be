import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requestContext } from '../../platform/context/request-context';
import { Db, PrismaService } from '../../platform/database/prisma.service';

export interface AuditEntry {
  action: string;
  subjectType?: string;
  subjectId?: string;
  before?: unknown;
  after?: unknown;
  /** Override the actor (e.g. a failed login, where nobody is signed in yet). */
  actorId?: string;
  actorType?: string;
  actorName?: string;
}

/** Append-only audit trail: who did what to which subject, with before/after, device and IP. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, db: Db = this.prisma) {
    const ctx = requestContext.get();
    await db.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorId: entry.actorId ?? ctx.actor?.id,
        actorType: entry.actorType ?? ctx.actor?.type ?? 'anonymous',
        actorName: entry.actorName ?? ctx.actor?.name,
        action: entry.action,
        subjectType: entry.subjectType,
        subjectId: entry.subjectId,
        before: toJson(entry.before),
        after: toJson(entry.after),
        device: ctx.deviceId,
        ip: ctx.ip,
      },
    });
  }
}

function toJson(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}
