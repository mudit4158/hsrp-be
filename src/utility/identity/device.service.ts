import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';
import { Problem } from '../../platform/http/problem';

/** Registered devices. A session bound to a device stops working when the device is deactivated. */
@Injectable()
export class DeviceService {
  constructor(private readonly prisma: PrismaService) {}

  async register(tenantId: string, userId: string, deviceId: string, name?: string) {
    return this.prisma.iamDevice.upsert({
      where: { tenantId_userId_deviceId: { tenantId, userId, deviceId } },
      create: { tenantId, userId, deviceId, name },
      update: { lastSeenAt: new Date(), ...(name ? { name } : {}) },
    });
  }

  async assertActive(tenantId: string, userId: string, deviceId: string) {
    const d = await this.prisma.iamDevice.findUnique({ where: { tenantId_userId_deviceId: { tenantId, userId, deviceId } } });
    if (!d?.active) throw Problem.unauthorized('This device is not registered or has been deactivated');
  }

  list(tenantId: string, userId?: string) {
    return this.prisma.iamDevice.findMany({ where: { tenantId, ...(userId ? { userId } : {}) }, orderBy: { lastSeenAt: 'desc' } });
  }

  setActive(tenantId: string, id: string, active: boolean) {
    return this.prisma.iamDevice.update({ where: { id, tenantId }, data: { active } });
  }
}
