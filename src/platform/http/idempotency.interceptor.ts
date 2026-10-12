import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { catchError, from, mergeMap, Observable, of, throwError } from 'rxjs';
import { IdempotencyService } from '../../utility/integration-hub/idempotency.service';
import { requestContext } from '../context/request-context';
import { IDEMPOTENT } from './decorators';
import { Problem } from './problem';

/** Enforces `Idempotency-Key` on decorated routes and replays the stored response for repeated keys. */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idem: IdempotencyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.get<boolean>(IDEMPOTENT, context.getHandler())) return next.handle();
    const req = context.switchToHttp().getRequest<Request & { file?: Express.Multer.File; files?: Record<string, Express.Multer.File[]> | Express.Multer.File[] }>();
    const res = context.switchToHttp().getResponse<Response>();
    const key = (req.headers['idempotency-key'] as string | undefined)?.trim();
    if (!key) throw Problem.badRequest('Idempotency-Key header is required for this request', 'idempotency-key-required');
    if (key.length > 100) throw Problem.badRequest('Idempotency-Key is too long', 'idempotency-key-invalid');

    const scope = `${requestContext.actorId() ?? 'anonymous'}:${req.method}:${req.route?.path ?? req.path}`;
    const files = req.files
      ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()).map((f) => [f.fieldname, f.originalname, f.size])
      : req.file
        ? [[req.file.fieldname, req.file.originalname, req.file.size]]
        : [];
    const hash = createHash('sha256').update(JSON.stringify({ p: req.params, b: req.body ?? null, f: files })).digest('hex');
    const code = this.reflector.get<number>(HTTP_CODE_METADATA, context.getHandler()) ?? (req.method === 'POST' ? 201 : 200);

    return from(this.idem.begin(scope, key, hash)).pipe(
      mergeMap((begin) => {
        if (begin.state === 'replay') {
          res.status(begin.code);
          res.setHeader('Idempotent-Replayed', 'true');
          return of(begin.body);
        }
        return next.handle().pipe(
          mergeMap((body) => from(this.idem.complete(scope, key, code, body).then(() => body))),
          catchError((err) => from(this.idem.abort(scope, key)).pipe(mergeMap(() => throwError(() => err)))),
        );
      }),
    );
  }
}
