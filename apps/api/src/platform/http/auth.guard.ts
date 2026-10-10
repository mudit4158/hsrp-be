import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { ApiClientService } from '../../utility/identity/api-client.service';
import { DeviceService } from '../../utility/identity/device.service';
import { requestContext } from '../context/request-context';
import { API_CLIENT, IS_PUBLIC, PERMISSIONS } from './decorators';
import { Problem } from './problem';

export interface JwtClaims {
  sub: string;
  tid: string;
  kind: 'user' | 'customer';
  name?: string;
  roles: string[];
  perms: string[];
  org?: string | null;
  dev?: string;
  claims?: Record<string, unknown>;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly apiClients: ApiClientService,
    private readonly devices: DeviceService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const isApiClient = this.reflector.getAllAndOverride<boolean>(API_CLIENT, targets);
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS, targets) ?? [];

    if (isApiClient) {
      const actor = await this.apiClients.authenticate({
        apiKey: req.headers['x-api-key'] as string | undefined,
        signature: req.headers['x-signature'] as string | undefined,
        rawBody: req.rawBody ?? Buffer.from(''),
      });
      requestContext.set({ tenantId: actor.tenantId, actor: actor.actor });
      return this.check(required, actor.actor.permissions);
    }

    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      let claims: JwtClaims;
      try {
        claims = await this.jwt.verifyAsync<JwtClaims>(header.slice(7));
      } catch {
        if (isPublic) return true;
        throw Problem.unauthorized('Session expired or invalid. Sign in again.');
      }
      if (claims.dev) {
        const deviceId = req.headers['x-device-id'] as string | undefined;
        if (deviceId !== claims.dev) throw Problem.unauthorized('This session is bound to another device');
        await this.devices.assertActive(claims.tid, claims.sub, claims.dev);
      }
      requestContext.set({
        tenantId: claims.tid,
        deviceId: claims.dev,
        actor: {
          id: claims.sub,
          type: claims.kind,
          name: claims.name,
          roles: claims.roles,
          permissions: claims.perms,
          orgId: claims.org,
          claims: claims.claims,
        },
      });
      return this.check(required, claims.perms);
    }

    if (isPublic) return true;
    throw Problem.unauthorized();
  }

  private check(required: string[], have: string[]) {
    if (required.length === 0 || have.includes('*')) return true;
    if (required.some((p) => have.includes(p))) return true;
    throw Problem.forbidden(`Needs permission: ${required.join(' or ')}`);
  }
}
