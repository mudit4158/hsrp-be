import { Controller, Get, Module, OnModuleInit, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../platform/http/decorators';
import { Scheduler } from '../../platform/worker/scheduler.service';
import { ReportingService } from '../../utility/reporting/reporting.service';
import { BookingModule } from '../booking/booking.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { FitmentModule } from '../fitment/fitment.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MastersModule } from '../masters/masters.module';
import { OrderIntakeModule } from '../order-intake/order-intake.module';
import { ProductionModule } from '../production/production.module';
import { RejectionModule } from '../rejection/rejection.module';
import { OversightService } from './oversight.service';
import { registerReports } from './reports';

@ApiTags('oversight')
@Controller()
export class OversightController {
  constructor(
    private readonly oversight: OversightService,
    private readonly scheduler: Scheduler,
  ) {}

  @Get('dashboard')
  @RequirePermission('orders.read')
  dashboard() {
    return this.oversight.dashboard();
  }

  @Get('orders/:id/detail')
  @RequirePermission('orders.read')
  detail(@Param('id') id: string) {
    return this.oversight.orderDetail(id);
  }

  @Get('dealer/home')
  @RequirePermission('dealer.app')
  home() {
    return this.oversight.dealerHome();
  }

  @Get('dealer/wallet')
  @RequirePermission('dealer.app')
  wallet() {
    return this.oversight.dealerWallet();
  }

  @Get('admin/jobs')
  @RequirePermission('integration.monitor')
  jobs() {
    return this.scheduler.jobNames();
  }

  @Post('admin/jobs/:name/run')
  @RequirePermission('integration.replay')
  run(@Param('name') name: string) {
    return this.scheduler.runNow(name);
  }
}

@Module({
  imports: [MastersModule, OrderIntakeModule, InventoryModule, FitmentModule, DispatchModule, ProductionModule, RejectionModule, BookingModule],
  controllers: [OversightController],
  providers: [OversightService],
})
export class OversightModule implements OnModuleInit {
  constructor(
    private readonly oversight: OversightService,
    private readonly reporting: ReportingService,
  ) {}

  onModuleInit() {
    registerReports(this.reporting, this.oversight);
  }
}
