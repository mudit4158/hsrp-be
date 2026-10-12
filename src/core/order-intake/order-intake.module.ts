import { Body, Controller, Get, HttpCode, Module, OnModuleInit, Param, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CancelOrderRequest, CreateOrderRequest, OemOrderRequest, OrderListQuery } from '@hsrp/contracts';
import { createZodDto } from 'nestjs-zod';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { ApiClientAuth, Idempotent, RequirePermission } from '../../platform/http/decorators';
import { Problem } from '../../platform/http/problem';
import { Scheduler } from '../../platform/worker/scheduler.service';
import { MastersModule } from '../masters/masters.module';
import { MastersService } from '../masters/masters.service';
import { ScopeService } from '../masters/scope.service';
import { PricingModule } from '../pricing/pricing.module';
import { OemIntakeService } from './oem-intake.service';
import { OrderFlowService } from './order-flow.service';
import { OrderService } from './order.service';
import { VehicleCheckService } from './vehicle-check.service';

class CreateOrderDto extends createZodDto(CreateOrderRequest) {}
class CancelDto extends createZodDto(CancelOrderRequest) {}
class OrderListDto extends createZodDto(OrderListQuery) {}
class OemOrderDto extends createZodDto(OemOrderRequest) {}

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
    private readonly flow: OrderFlowService,
    private readonly masters: MastersService,
    private readonly scope: ScopeService,
  ) {}

  /** Dealer app / dealer web / staff web order. Dealers order for themselves; staff name the dealer. */
  @Post()
  @RequirePermission('orders.create')
  @Idempotent()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async create(@Body() body: CreateOrderDto) {
    const s = await this.scope.current();
    let dealerId = s.dealerId;
    if (!dealerId) {
      if (!s.all) throw Problem.forbidden('Only dealers and staff place orders here');
      if (!body.dealerCode) throw Problem.badRequest('dealerCode is required for staff orders', 'dealer-required');
      dealerId = (await this.masters.dealerByCode(body.dealerCode)).id;
    }
    const oemId = body.oemCode ? (await this.masters.oemByCode(body.oemCode)).id : undefined;
    const order = await this.prisma.tx((tx) =>
      this.orders.create(
        { ...body, channel: s.dealerId ? 'DEALER_APP' : 'STAFF_WEB', orderType: body.orderType, plateSet: body.plateSet, dealerId, oemId },
        tx,
      ),
    );
    return { id: order.id, orderNo: order.orderNo, status: order.status };
  }

  @Get()
  @RequirePermission('orders.read')
  list(@Query() q: OrderListDto) {
    return this.orders.list(q);
  }

  @Get(':id')
  @RequirePermission('orders.read')
  get(@Param('id') id: string) {
    return this.orders.getScoped(id);
  }

  @Get(':id/history')
  @RequirePermission('orders.read')
  async history(@Param('id') id: string) {
    await this.orders.getScoped(id);
    return { history: await this.orders.history(id), validations: await this.orders.validations(id) };
  }

  @Post(':id/cancel')
  @RequirePermission('orders.cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @Body() body: CancelDto) {
    return this.flow.cancel(id, body.reason);
  }

  /** Re-tries wallet hold for an order waiting for funds (after a top-up). */
  @Post(':id/retry-confirmation')
  @RequirePermission('orders.create')
  @HttpCode(200)
  async retry(@Param('id') id: string) {
    await this.orders.getScoped(id);
    await this.flow.retryAwaitingFunds(id);
    return this.orders.get(id);
  }
}

@ApiTags('oem')
@Controller('oem')
export class OemController {
  constructor(private readonly oem: OemIntakeService) {}

  /** OEM order push: X-Api-Key, X-Signature (HMAC-SHA256 of the raw body) and Idempotency-Key. */
  @Post(':oemCode/orders')
  @ApiClientAuth()
  @ApiSecurity('oem-api-key')
  @RequirePermission('oem.orders.push')
  @Idempotent()
  @HttpCode(202)
  @ApiHeader({ name: 'X-Signature', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  push(@Param('oemCode') oemCode: string, @Body() body: OemOrderDto) {
    return this.oem.push(oemCode, body);
  }

  @Get(':oemCode/orders/:ref')
  @ApiClientAuth()
  @ApiSecurity('oem-api-key')
  @RequirePermission('oem.orders.push')
  status(@Param('oemCode') oemCode: string, @Param('ref') ref: string) {
    if (requestContext.actor()?.type !== 'api-client') throw Problem.forbidden();
    return this.oem.status(oemCode, ref);
  }
}

@Module({
  imports: [MastersModule, PricingModule],
  controllers: [OrdersController, OemController],
  providers: [OrderService, OrderFlowService, VehicleCheckService, OemIntakeService],
  exports: [OrderService, OrderFlowService, VehicleCheckService],
})
export class OrderIntakeModule implements OnModuleInit {
  constructor(
    private readonly scheduler: Scheduler,
    private readonly flow: OrderFlowService,
  ) {}

  onModuleInit() {
    this.scheduler.every('orders.retry-awaiting-funds', 2 * 60_000, () => this.flow.retryAwaitingFunds());
  }
}
