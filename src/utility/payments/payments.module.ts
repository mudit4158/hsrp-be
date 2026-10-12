import { Body, Controller, Get, Global, HttpCode, Module, Param, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { Public, RequirePermission } from '../../platform/http/decorators';
import { FilteredPageQueryDto, pageArgs, pageOf } from '../../platform/http/pagination';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Gateway → API server-to-server notification (form or JSON body). */
  @Post('webhook/:provider')
  @Public()
  @HttpCode(200)
  webhook(@Body() body: Record<string, string>) {
    return this.payments.handleWebhook(body);
  }

  /** Browser return (success and failure URL). Queues a verify and redirects to the caller's return page. */
  @Post('return/:provider')
  @Public()
  async returnPost(@Body() body: Record<string, string>, @Res() res: Response) {
    res.redirect(303, await this.payments.handleReturn(body));
  }

  @Post(':id/checkout')
  @RequirePermission('payments.pay')
  checkout(@Param('id') id: string) {
    return this.payments.checkout(id);
  }

  @Post(':id/verify')
  @RequirePermission('payments.pay', 'payments.read')
  verify(@Param('id') id: string) {
    return this.payments.requestVerify(id);
  }

  @Get()
  @RequirePermission('payments.read')
  async list(@Query() q: FilteredPageQueryDto) {
    const where = { tenantId: requestContext.tenantId(), ...(q.status ? { status: String(q.status) } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.payment.count({ where }),
    ]);
    return pageOf(items, total, q);
  }

  @Get(':id/events')
  @RequirePermission('payments.read')
  events(@Param('id') id: string) {
    return this.prisma.paymentEvent.findMany({ where: { paymentId: id }, orderBy: { createdAt: 'asc' } });
  }
}

@Global()
@Module({ controllers: [PaymentsController], providers: [PaymentsService], exports: [PaymentsService] })
export class PaymentsModule {}
