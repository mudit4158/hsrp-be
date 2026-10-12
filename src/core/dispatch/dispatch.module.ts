import { Body, Controller, Get, HttpCode, Module, Param, Post, Query, Res } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { CancelOrderRequest, CreateChallanRequest, InwardRequest } from '@hsrp/contracts';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { Idempotent, RequirePermission } from '../../platform/http/decorators';
import { Problem } from '../../platform/http/problem';
import { InventoryModule } from '../inventory/inventory.module';
import { MastersModule } from '../masters/masters.module';
import { ScopeService } from '../masters/scope.service';
import { OrderIntakeModule } from '../order-intake/order-intake.module';
import { RejectionModule } from '../rejection/rejection.module';
import { sendPdf } from '../shared/pdf';
import { DispatchService } from './dispatch.service';

class CreateChallanDto extends createZodDto(CreateChallanRequest) {}
class InwardDto extends createZodDto(InwardRequest) {}
class CancelDto extends createZodDto(CancelOrderRequest) {}

@ApiTags('dispatch')
@Controller('dispatch')
export class DispatchController {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly scope: ScopeService,
  ) {}

  private async station(requested?: string) {
    const s = await this.scope.current();
    if (s.stationId) return s.stationId;
    if (!s.all || !requested) throw Problem.badRequest('stationId is required', 'station-required');
    return requested;
  }

  @Get('ready')
  @RequirePermission('station.operate', 'station.read')
  async ready(@Query('stationId') stationId?: string, @Query('dealerId') dealerId?: string) {
    return this.dispatch.ready(await this.station(stationId), dealerId);
  }

  @Post('challans')
  @RequirePermission('station.operate')
  async create(@Body() body: CreateChallanDto) {
    return this.dispatch.create({ ...body, stationId: await this.station(body.stationId) });
  }

  @Get('challans')
  @RequirePermission('orders.read')
  list(@Query('status') status?: string, @Query('dealerId') dealerId?: string, @Query('stationId') stationId?: string) {
    return this.dispatch.list({ status, dealerId, stationId });
  }

  @Get('challans/:id')
  @RequirePermission('orders.read')
  get(@Param('id') id: string) {
    return this.dispatch.get(id);
  }

  @Get('challans/:id/pdf')
  @RequirePermission('orders.read')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    sendPdf(res, await this.dispatch.pdf(id));
  }

  @Post('challans/:id/cancel')
  @RequirePermission('station.operate')
  @HttpCode(200)
  cancel(@Param('id') id: string, @Body() body: CancelDto) {
    return this.dispatch.cancel(id, body.reason);
  }

  @Post('challans/:id/inward')
  @RequirePermission('inward.record')
  @Idempotent()
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  inward(@Param('id') id: string, @Body() body: InwardDto) {
    return this.dispatch.inward(id, body);
  }
}

@Module({
  imports: [MastersModule, InventoryModule, OrderIntakeModule, RejectionModule],
  controllers: [DispatchController],
  providers: [DispatchService],
  exports: [DispatchService],
})
export class DispatchModule {}
