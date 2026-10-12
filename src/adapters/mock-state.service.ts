import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requestContext } from '../platform/context/request-context';
import { PrismaService } from '../platform/database/prisma.service';

/** Knobs and fixtures of the mock external systems (VAHAN mode, demo OEM credentials, ...). */
@Injectable()
export class MockStateService {
  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const row = await this.prisma.mockSetting.findUnique({ where: { key } });
    return (row?.value as T) ?? fallback;
  }

  async set(key: string, value: unknown) {
    await this.prisma.mockSetting.upsert({
      where: { key },
      create: { key, tenantId: requestContext.tenantId(), value: value as Prisma.InputJsonValue },
      update: { value: value as Prisma.InputJsonValue },
    });
  }
}
