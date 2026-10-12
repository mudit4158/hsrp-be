import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { Problem } from './problem';

interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [k: string]: unknown;
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('Problem');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const body = this.toProblem(exception);
    body.instance = req.originalUrl;
    if (body.status >= 500) this.log.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(body.status).type('application/problem+json').send(body);
  }

  private toProblem(e: unknown): ProblemBody {
    const base = (status: number, code: string, title: string, detail?: string, extra?: Record<string, unknown>): ProblemBody => ({
      type: `https://hsrp.local/problems/${code}`,
      title,
      status,
      detail,
      ...extra,
    });

    if (e instanceof Problem) return base(e.status, e.code ?? 'error', e.title, e.detail, e.extra);
    if (e instanceof ZodValidationException) {
      const zod = e.getZodError() as ZodError;
      return base(400, 'validation', 'Validation failed', 'One or more fields are invalid', {
        errors: zod.errors.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (e instanceof ZodError) {
      return base(400, 'validation', 'Validation failed', 'One or more fields are invalid', {
        errors: e.errors.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') return base(409, 'duplicate', 'Conflict', `Duplicate value for ${String(e.meta?.target ?? 'a unique field')}`);
      if (e.code === 'P2025') return base(404, 'not-found', 'Not found', 'Record not found');
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const r = e.getResponse();
      const detail = typeof r === 'string' ? r : ((r as { message?: string | string[] }).message ?? e.message);
      return base(status, status === 429 ? 'rate-limited' : 'http', e.name.replace(/Exception$/, ''), Array.isArray(detail) ? detail.join('; ') : String(detail));
    }
    return base(500, 'internal', 'Internal server error', 'Something went wrong. The error has been logged.');
  }
}
