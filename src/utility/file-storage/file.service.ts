import { Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../../platform/config/env';
import { requestContext } from '../../platform/context/request-context';
import { Db, PrismaService } from '../../platform/database/prisma.service';
import { Problem } from '../../platform/http/problem';
import { FILE_STORE, FileStore } from './file-store.port';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/csv', 'application/vnd.ms-excel', 'text/plain'];
const MAX_BYTES = 10 * 1024 * 1024;

export interface UploadInput {
  data: Buffer;
  filename: string;
  mimeType: string;
  purpose?: string;
  ownerSubjectType?: string;
  ownerSubjectId?: string;
  retentionDays?: number;
}

/** Upload, fetch by signed link, retention. Callers attach files to any subject by type and id. */
@Injectable()
export class FileService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORE) private readonly store: FileStore,
  ) {}

  async upload(input: UploadInput, db: Db = this.prisma) {
    const mimeType = input.mimeType === 'application/octet-stream' ? guessMime(input.filename) : input.mimeType;
    if (!ALLOWED.includes(mimeType)) throw Problem.badRequest(`File type ${mimeType} is not allowed`, 'file-type');
    if (input.data.length === 0) throw Problem.badRequest('File is empty', 'file-empty');
    if (input.data.length > MAX_BYTES) throw Problem.badRequest('File is larger than 10 MB', 'file-too-large');
    const tenantId = requestContext.tenantId();
    const id = randomUUID();
    const storageKey = `${tenantId}/${id}`;
    await this.store.put(storageKey, input.data, mimeType);
    return db.fileObject.create({
      data: {
        id,
        tenantId,
        filename: input.filename.slice(0, 200),
        mimeType,
        sizeBytes: input.data.length,
        sha256: createHash('sha256').update(input.data).digest('hex'),
        storageKey,
        purpose: input.purpose,
        ownerSubjectType: input.ownerSubjectType,
        ownerSubjectId: input.ownerSubjectId,
        retentionUntil: input.retentionDays ? new Date(Date.now() + input.retentionDays * 86400_000) : null,
        createdBy: requestContext.actorId(),
      },
    });
  }

  async meta(id: string, db: Db = this.prisma) {
    const f = await db.fileObject.findFirst({ where: { id, tenantId: requestContext.tenantId(), deletedAt: null } });
    if (!f) throw Problem.notFound('File');
    return f;
  }

  async attach(id: string, owner: { subjectType: string; subjectId: string; purpose?: string }, db: Db = this.prisma) {
    await this.meta(id, db);
    return db.fileObject.update({ where: { id }, data: { ownerSubjectType: owner.subjectType, ownerSubjectId: owner.subjectId, purpose: owner.purpose } });
  }

  async read(id: string) {
    const f = await this.prisma.fileObject.findFirst({ where: { id, deletedAt: null } });
    if (!f) throw Problem.notFound('File');
    return { meta: f, data: await this.store.get(f.storageKey) };
  }

  /** Short-lived link that works without a session (for <img> tags, downloads, the Android app). */
  signedPath(id: string, ttlSeconds = 900) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    return `/api/v1/files/${id}/content?exp=${exp}&sig=${this.sign(id, exp)}`;
  }

  verifyLink(id: string, exp: number, sig: string) {
    if (!exp || exp < Date.now() / 1000) throw Problem.forbidden('Link expired');
    const a = Buffer.from(this.sign(id, exp));
    const b = Buffer.from(sig ?? '');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw Problem.forbidden('Bad link signature');
  }

  listFor(subjectType: string, subjectId: string) {
    return this.prisma.fileObject.findMany({
      where: { tenantId: requestContext.tenantId(), ownerSubjectType: subjectType, ownerSubjectId: subjectId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Retention: soft-deletes metadata and removes bytes of files past their retention date. */
  async purgeExpired() {
    const due = await this.prisma.fileObject.findMany({ where: { retentionUntil: { lt: new Date() }, deletedAt: null }, take: 200 });
    for (const f of due) {
      await this.store.delete(f.storageKey);
      await this.prisma.fileObject.update({ where: { id: f.id }, data: { deletedAt: new Date() } });
    }
    return due.length;
  }

  private sign(id: string, exp: number) {
    return createHmac('sha256', env.fileLinkSecret).update(`${id}.${exp}`).digest('base64url');
  }
}

function guessMime(name: string) {
  const ext = name.toLowerCase().split('.').pop();
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain' } as Record<string, string>)[ext ?? ''] ?? 'application/octet-stream';
}
