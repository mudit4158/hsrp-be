import { Controller, Get, Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';
import { env } from './config/env';
import { PrismaService } from './database/prisma.service';
import { AuditInterceptor } from './http/audit.interceptor';
import { AuthGuard } from './http/auth.guard';
import { ContextMiddleware } from './http/context.middleware';
import { Public } from './http/decorators';
import { IdempotencyInterceptor } from './http/idempotency.interceptor';
import { ProblemFilter } from './http/problem.filter';
import { Scheduler } from './worker/scheduler.service';

@ApiTags('platform')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Public()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', worker: env.workerEnabled, demoMode: env.demoMode, time: new Date().toISOString() };
  }
}

@Global()
@Module({
  imports: [
    JwtModule.register({ global: true, secret: env.jwtSecret, signOptions: { expiresIn: env.jwtExpiresIn } }),
    // Generous default; public endpoints set stricter limits with @Throttle.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 600 }]),
  ],
  controllers: [HealthController],
  providers: [
    PrismaService,
    Scheduler,
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: ProblemFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [PrismaService, Scheduler],
})
export class PlatformModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ContextMiddleware).forRoutes('*');
  }
}
