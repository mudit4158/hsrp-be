import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/database/prisma.service';
import { FileStore } from '../../utility/file-storage/file-store.port';

/** Stores file bytes in PostgreSQL (decision D13). Swap for an object-storage adapter later. */
@Injectable()
export class DbFileStore implements FileStore {
  constructor(private readonly prisma: PrismaService) {}

  async put(key: string, data: Buffer) {
    const tenantId = key.split('/')[0];
    await this.prisma.fileBlob.upsert({ where: { key }, create: { key, tenantId, data }, update: { data } });
  }

  async get(key: string) {
    const row = await this.prisma.fileBlob.findUnique({ where: { key } });
    if (!row) throw new Error(`File bytes missing for ${key}`);
    return Buffer.from(row.data);
  }

  async delete(key: string) {
    await this.prisma.fileBlob.delete({ where: { key } }).catch(() => undefined);
  }
}
