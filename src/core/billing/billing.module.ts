import { Body, Controller, Get, HttpCode, Module, OnModuleInit, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../platform/http/decorators';
import { Scheduler } from '../../platform/worker/scheduler.service';
import { MastersModule } from '../masters/masters.module';
import { OrderIntakeModule } from '../order-intake/order-intake.module';
import { sendPdf } from '../shared/pdf';
import { BILL_TO, BILLING_CYCLES, PAYMENT_MODES } from './billing-rules';
import { BillingService } from './billing.service';

class OemBillingDto extends createZodDto(
  z.object({
    paymentMode: z.enum(PAYMENT_MODES as [string, ...string[]]).optional(),
    cycle: z.enum(BILLING_CYCLES as [string, ...string[]]).optional(),
    billToDefault: z.enum(BILL_TO as [string, ...string[]]).optional(),
    contactEmail: z.string().email().or(z.literal('')).optional(),
  }),
) {}
class PairDto extends createZodDto(z.object({ billTo: z.enum(BILL_TO as [string, ...string[]]) })) {}
class RunDto extends createZodDto(z.object({ oemCode: z.string().min(1) })) {}

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('setup')
  @RequirePermission('billing.read')
  setup() {
    return this.billing.setup();
  }

  @Put('oems/:oemCode')
  @RequirePermission('billing.manage')
  configureOem(@Param('oemCode') oemCode: string, @Body() body: OemBillingDto) {
    return this.billing.configureOem(oemCode, body as never);
  }

  @Put('oems/:oemCode/dealers/:dealerCode')
  @RequirePermission('billing.manage')
  configurePair(@Param('oemCode') oemCode: string, @Param('dealerCode') dealerCode: string, @Body() body: PairDto) {
    return this.billing.configurePair(oemCode, dealerCode, body.billTo as never);
  }

  @Get('charges')
  @RequirePermission('billing.read')
  charges(@Query('status') status?: string, @Query('oemCode') oemCode?: string) {
    return this.billing.charges({ status, oemCode });
  }

  @Get('bills')
  @RequirePermission('billing.read')
  bills(@Query('oemCode') oemCode?: string, @Query('status') status?: string) {
    return this.billing.bills({ oemCode, status });
  }

  @Get('bills/:id')
  @RequirePermission('billing.read')
  bill(@Param('id') id: string) {
    return this.billing.bill(id);
  }

  @Get('bills/:id/pdf')
  @RequirePermission('billing.read')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    sendPdf(res, await this.billing.pdf(id));
  }

  /** Closes the current period now for one postpaid OEM ("Run billing now"). */
  @Post('run')
  @RequirePermission('billing.manage')
  @HttpCode(200)
  run(@Body() body: RunDto) {
    return this.billing.run(body.oemCode, { trigger: 'manual' });
  }

  @Post('bills/:id/send')
  @RequirePermission('billing.manage')
  @HttpCode(200)
  send(@Param('id') id: string) {
    return this.billing.send(id);
  }

  @Post('bills/:id/paid')
  @RequirePermission('billing.manage')
  @HttpCode(200)
  paid(@Param('id') id: string) {
    return this.billing.markPaid(id);
  }
}

@Module({
  imports: [MastersModule, OrderIntakeModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule implements OnModuleInit {
  constructor(
    private readonly scheduler: Scheduler,
    private readonly billing: BillingService,
  ) {}

  onModuleInit() {
    // Hourly check; each OEM's cycle is closed once after its boundary (Monday or the 1st, 00:00 IST).
    this.scheduler.every('billing.close-cycles', 60 * 60_000, () => this.billing.closeDueCycles());
  }
}
