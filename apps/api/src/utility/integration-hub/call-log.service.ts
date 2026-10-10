import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';

/** Records every call to an external system: request, response, outcome and duration. */
@Injectable()
export class CallLogService {
  constructor(private readonly prisma: PrismaService) {}

  async track<T>(
    meta: { system: string; operation: string; subjectType?: string; subjectId?: string; request?: unknown },
    fn: () => Promise<T>,
  ): Promise<T> {
    const started = Date.now();
    try {
      const result = await fn();
      await this.write(meta, 'OK', started, result);
      return result;
    } catch (e) {
      await this.write(meta, 'ERROR', started, undefined, (e as Error).message);
      throw e;
    }
  }

  private async write(
    meta: { system: string; operation: string; subjectType?: string; subjectId?: string; request?: unknown },
    outcome: string,
    started: number,
    response?: unknown,
    error?: string,
  ) {
    await this.prisma.callLog.create({
      data: {
        tenantId: requestContext.tenantId(),
        system: meta.system,
        operation: meta.operation,
        subjectType: meta.subjectType,
        subjectId: meta.subjectId,
        request: (meta.request ?? undefined) as Prisma.InputJsonValue | undefined,
        response: (response ?? undefined) as Prisma.InputJsonValue | undefined,
        outcome,
        error,
        durationMs: Date.now() - started,
      },
    });
  }
}
