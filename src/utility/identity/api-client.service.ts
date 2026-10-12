import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Actor } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { Problem } from '../../platform/http/problem';

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/** HMAC-SHA256 of the raw request body with the client's shared secret, hex encoded. */
export const signBody = (secret: string, rawBody: Buffer | string) => createHmac('sha256', secret).update(rawBody).digest('hex');

@Injectable()
export class ApiClientService {
  constructor(private readonly prisma: PrismaService) {}

  async authenticate(input: { apiKey?: string; signature?: string; rawBody: Buffer }): Promise<{ tenantId: string; actor: Actor }> {
    if (!input.apiKey) throw Problem.unauthorized('X-Api-Key header required');
    const client = await this.prisma.iamApiClient.findUnique({ where: { keyHash: hashKey(input.apiKey) } });
    if (!client?.active) throw Problem.unauthorized('Unknown or inactive API key');
    if (!input.signature) throw Problem.unauthorized('X-Signature header required');
    const expected = Buffer.from(signBody(client.secret, input.rawBody), 'hex');
    const given = Buffer.from(input.signature, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw Problem.unauthorized('Request signature does not match');
    }
    const roles = await this.prisma.iamRole.findMany({ where: { tenantId: client.tenantId, code: { in: client.roles } } });
    return {
      tenantId: client.tenantId,
      actor: {
        id: client.id,
        type: 'api-client',
        name: client.name,
        roles: client.roles,
        permissions: [...new Set(roles.flatMap((r) => r.permissions))],
        orgId: client.orgId,
      },
    };
  }

  /** Creates a client and returns the API key and secret once; only a hash of the key is stored. */
  async create(tenantId: string, input: { orgId: string; name: string; roles: string[]; apiKey?: string; secret?: string }) {
    const apiKey = input.apiKey ?? `hk_${randomBytes(18).toString('base64url')}`;
    const secret = input.secret ?? randomBytes(24).toString('base64url');
    const client = await this.prisma.iamApiClient.create({
      data: { tenantId, orgId: input.orgId, name: input.name, roles: input.roles, keyHash: hashKey(apiKey), secret },
    });
    return { id: client.id, apiKey, secret };
  }

  list(tenantId: string) {
    return this.prisma.iamApiClient.findMany({
      where: { tenantId },
      select: { id: true, name: true, orgId: true, roles: true, active: true, createdAt: true },
    });
  }
}
