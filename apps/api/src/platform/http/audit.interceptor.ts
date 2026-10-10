import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { from, mergeMap, Observable } from 'rxjs';
import { AuditService } from '../../utility/audit/audit.service';

const SKIP = ['/api/v1/auth/login'];

/**
 * Records every successful state-changing HTTP call (method, route, ids) in the audit log.
 * Services add richer entries with before/after values for the changes that matter.
 * Bodies are not logged here because they may hold passwords or OTPs.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || SKIP.includes(req.path)) return next.handle();
    return next.handle().pipe(
      mergeMap((body) =>
        from(
          this.audit
            .record({
              action: `http.${req.method.toLowerCase()} ${req.route?.path ?? req.path}`,
              subjectType: 'http',
              subjectId: req.params?.id ?? req.params?.orderId ?? req.params?.code,
              after: { params: req.params, status: 'ok' },
            })
            .catch(() => undefined)
            .then(() => body),
        ),
      ),
    );
  }
}
