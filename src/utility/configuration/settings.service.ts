import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requestContext } from '../../platform/context/request-context';
import { Db, PrismaService } from '../../platform/database/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface Scope {
  type: string;
  id: string;
}

export const GLOBAL: Scope = { type: 'global', id: '*' };

/**
 * Settings by scope with effective dates. Callers pass scopes most specific first
 * (e.g. dealer, oem, state); global is always tried last. Feature flags are settings named `feature.<name>`.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get<T = unknown>(key: string, scopes: Scope[] = [], at: Date = new Date(), db: Db = this.prisma): Promise<T | undefined> {
    const chain = [...scopes, GLOBAL];
    const rows = await db.configSetting.findMany({
      where: {
        tenantId: requestContext.tenantId(),
        key,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    for (const s of chain) {
      const hit = rows.find((r) => r.scopeType === s.type && r.scopeId === s.id);
      if (hit) return hit.value as T;
    }
    return undefined;
  }

  async getOr<T>(key: string, fallback: T, scopes: Scope[] = [], at?: Date, db?: Db): Promise<T> {
    return (await this.get<T>(key, scopes, at, db)) ?? fallback;
  }

  async flag(name: string, scopes: Scope[] = []): Promise<boolean> {
    return Boolean(await this.get<boolean>(`feature.${name}`, scopes));
  }

  /** Sets a value from `effectiveFrom` (default now), closing the previous value for the same key and scope. */
  async set(input: { key: string; scopeType: string; scopeId: string; value: unknown; effectiveFrom?: Date }, db?: Db) {
    const run = async (tx: Db) => {
      const tenantId = requestContext.tenantId();
      const from = input.effectiveFrom ?? new Date();
      const open = await tx.configSetting.findMany({
        where: { tenantId, key: input.key, scopeType: input.scopeType, scopeId: input.scopeId, effectiveTo: null, effectiveFrom: { lte: from } },
      });
      for (const o of open) await tx.configSetting.update({ where: { id: o.id }, data: { effectiveTo: from } });
      const row = await tx.configSetting.create({
        data: {
          tenantId,
          key: input.key,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          value: input.value as Prisma.InputJsonValue,
          effectiveFrom: from,
          createdBy: requestContext.actorId(),
        },
      });
      await this.audit.record(
        { action: 'config.set', subjectType: 'config', subjectId: `${input.key}@${input.scopeType}:${input.scopeId}`, before: open.map((o) => o.value), after: input.value },
        tx,
      );
      return row;
    };
    return db ? run(db) : this.prisma.tx(run);
  }

  list(filter: { key?: string; includeHistory?: boolean } = {}) {
    return this.prisma.configSetting.findMany({
      where: {
        tenantId: requestContext.tenantId(),
        ...(filter.key ? { key: { contains: filter.key } } : {}),
        ...(filter.includeHistory ? {} : { effectiveTo: null }),
      },
      orderBy: [{ key: 'asc' }, { scopeType: 'asc' }, { scopeId: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }
}
