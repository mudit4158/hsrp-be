import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { requestContext } from '../context/request-context';

/** Opens a request context (tenant, IP, device, request id) that services and the audit log read. */
@Injectable()
export class ContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();
    res.setHeader('x-request-id', requestId);
    const ip = ((req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? req.socket.remoteAddress ?? '').trim();
    requestContext.run(
      { tenantId: env.defaultTenantId, ip, deviceId: req.headers['x-device-id'] as string | undefined, requestId },
      () => next(),
    );
  }
}
