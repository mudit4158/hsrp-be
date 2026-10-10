import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { Problem } from '../../platform/http/problem';

export type IdempotencyBegin = { state: 'new' } | { state: 'replay'; code: number; body: unknown };

const TTL_MS = 7 * 24 * 3600_000;

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async begin(scope: string, key: string, requestHash: string): Promise<IdempotencyBegin> {
    const tenantId = requestContext.tenantId();
    try {
      await this.prisma.idempotencyKey.create({
        data: { tenantId, scope, key, requestHash, expiresAt: new Date(Date.now() + TTL_MS) },
      });
      return { state: 'new' };
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    const existing = await this.prisma.idempotencyKey.findUnique({ where: { tenantId_scope_key: { tenantId, scope, key } } });
    if (!existing) throw Problem.conflict('Idempotency key is being processed, retry shortly', 'idempotency-in-progress');
    if (existing.requestHash !== requestHash) {
      throw Problem.unprocessable('This Idempotency-Key was already used with a different request', 'idempotency-mismatch');
    }
    if (existing.status !== 'DONE') {
      throw Problem.conflict('A request with this Idempotency-Key is still in progress', 'idempotency-in-progress');
    }
    return { state: 'replay', code: existing.responseCode ?? 200, body: existing.responseBody };
  }

  async complete(scope: string, key: string, code: number, body: unknown) {
    await this.prisma.idempotencyKey.update({
      where: { tenantId_scope_key: { tenantId: requestContext.tenantId(), scope, key } },
      data: { status: 'DONE', responseCode: code, responseBody: (body ?? null) as Prisma.InputJsonValue },
    });
  }

  async abort(scope: string, key: string) {
    await this.prisma.idempotencyKey
      .delete({ where: { tenantId_scope_key: { tenantId: requestContext.tenantId(), scope, key } } })
      .catch(() => undefined);
  }
}
