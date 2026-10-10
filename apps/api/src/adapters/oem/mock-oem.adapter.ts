import { Injectable } from '@nestjs/common';
import { OemOrderRequest } from '@hsrp/contracts';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { OemVehicleCatalog, OrderSource } from '../../core/ports/oem.port';

/** Mock OEM side: payloads are already canonical; status callbacks are stored instead of sent. */
@Injectable()
export class MockOrderSource implements OrderSource {
  constructor(private readonly prisma: PrismaService) {}

  toCanonical(_oemCode: string, payload: unknown) {
    return OemOrderRequest.parse(payload);
  }

  async notifyStatus(oemCode: string, orderRef: string, status: string, reason?: string) {
    await this.prisma.mockOemCallback.create({ data: { tenantId: requestContext.tenantId(), oemCode, orderRef, status, reason } });
  }
}

/** Mock OEM chassis catalogue backed by a seeded table. */
@Injectable()
export class MockOemCatalog implements OemVehicleCatalog {
  constructor(private readonly prisma: PrismaService) {}

  async check(oemCode: string, chassisNo: string) {
    const row = await this.prisma.mockOemCatalogue.findUnique({ where: { oemCode_chassisNo: { oemCode, chassisNo: chassisNo.toUpperCase() } } });
    return { found: Boolean(row), model: row?.model };
  }
}

@Injectable()
export class RealOrderSource implements OrderSource {
  toCanonical(): never {
    throw new Error('Real OEM adapter is not implemented. Set OEM_ADAPTER=mock.');
  }
  notifyStatus(): Promise<void> {
    throw new Error('Real OEM adapter is not implemented. Set OEM_ADAPTER=mock.');
  }
}

@Injectable()
export class RealOemCatalog implements OemVehicleCatalog {
  check(): Promise<{ found: boolean }> {
    throw new Error('Real OEM catalogue adapter is not implemented. Set OEM_ADAPTER=mock.');
  }
}
