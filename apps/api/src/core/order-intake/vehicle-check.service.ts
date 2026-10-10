import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { VehicleCheckRequest } from '@hsrp/contracts';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { NonRetryableError, Problem } from '../../platform/http/problem';
import { SettingsService } from '../../utility/configuration/settings.service';
import { CallLogService } from '../../utility/integration-hub/call-log.service';
import { DeliveredEvent, EventBus } from '../../utility/integration-hub/event-bus.service';
import { MastersService } from '../masters/masters.service';
import { VEHICLE_REGISTRY, VehicleRegistry } from '../ports/vehicle-registry.port';
import { PricingService } from '../pricing/pricing.module';
import { parseDate } from '../shared/subjects';

/**
 * Customer portal "validate vehicle". The VAHAN lookup is an external call, so it runs from the outbox
 * and the portal polls the check until it is DONE or FAILED.
 */
@Injectable()
export class VehicleCheckService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
    private readonly calls: CallLogService,
    private readonly settings: SettingsService,
    private readonly masters: MastersService,
    private readonly pricing: PricingService,
    @Inject(VEHICLE_REGISTRY) private readonly vahan: VehicleRegistry,
  ) {}

  onModuleInit() {
    this.bus.subscribe('VehicleCheckRequested', 'orders.vehicle-check', (e) => this.run(e), { maxAttempts: 4 });
  }

  async request(input: VehicleCheckRequest) {
    await this.masters.state(input.stateCode);
    return this.prisma.tx(async (tx) => {
      const check = await tx.vehicleCheck.create({
        data: { tenantId: requestContext.tenantId(), stateCode: input.stateCode, regnNo: input.regnNo, chassisLast5: input.chassisLast5.slice(-5), engineLast5: input.engineLast5.slice(-5) },
      });
      await this.bus.publish(tx, { type: 'VehicleCheckRequested', subjectType: 'hsrp.vehicle-check', subjectId: check.id, payload: { checkId: check.id } });
      return { id: check.id, status: check.status };
    });
  }

  async get(id: string) {
    const c = await this.prisma.vehicleCheck.findFirst({ where: { id, tenantId: requestContext.tenantId() } });
    if (!c) throw Problem.notFound('Vehicle check');
    return { id: c.id, status: c.status, stateCode: c.stateCode, regnNo: c.regnNo, result: c.result, error: c.error };
  }

  /** Returns a DONE check whose vehicle matches; used when the customer places the order. */
  async requireDone(id: string) {
    const c = await this.prisma.vehicleCheck.findFirst({ where: { id, tenantId: requestContext.tenantId() } });
    if (!c || c.status !== 'DONE') throw Problem.unprocessable('Validate the vehicle first', 'vehicle-check-pending');
    if (c.createdAt.getTime() < Date.now() - 60 * 60_000) throw Problem.unprocessable('Vehicle check expired; validate again', 'vehicle-check-expired');
    return c;
  }

  private async run(e: DeliveredEvent) {
    const c = await this.prisma.vehicleCheck.findUnique({ where: { id: String(e.payload.checkId) } });
    if (!c) throw new NonRetryableError('Check not found');
    if (c.status !== 'PENDING') return;
    const req = { regnNO: c.regnNo, chasisNo: c.chassisLast5, engineNo: c.engineLast5, userId: await this.settings.getOr('vahan.userId', 'HSRPDEMO') };
    let reply;
    try {
      reply = await this.calls.track({ system: 'VAHAN', operation: 'lookup', subjectType: 'hsrp.vehicle-check', subjectId: c.id, request: req }, () => this.vahan.lookup(req));
    } catch (err) {
      if (e.attempt >= 4) {
        await this.prisma.vehicleCheck.update({ where: { id: c.id }, data: { status: 'FAILED', error: 'VAHAN is not reachable right now. Try again later.' } });
        return;
      }
      throw err;
    }
    if (!/^success$/i.test(reply.message)) {
      await this.prisma.vehicleCheck.update({ where: { id: c.id }, data: { status: 'FAILED', error: reply.message } });
      return;
    }
    if (reply.stateCd !== c.stateCode) {
      await this.prisma.vehicleCheck.update({ where: { id: c.id }, data: { status: 'FAILED', error: `This vehicle is registered in ${reply.stateCd}. Choose that state.` } });
      return;
    }
    const cutoff = new Date(await this.settings.getOr<string>('order.newVehicleCutoff', '2019-04-01'));
    const category = await this.masters.vehicleCategory(reply.vchCatg);
    const regn = parseDate(reply.regnDate);
    const hasPlates = Boolean(reply.hsrpFrontLaserCode || reply.hsrpRearLaserCode);
    const isNew = regn ? regn >= cutoff : false;
    const orderType = hasPlates ? 'REPLACEMENT' : isNew ? null : 'OLD';
    const greenStrip = /VI/i.test(reply.norms);
    let pricePaise: number | null = null;
    if (orderType && category) {
      const q = await this.pricing
        .quote({ stateCode: c.stateCode, vehicleClass: category.vehicleClass, vehicleType: category.vehicleType, orderType, plateSet: 'BOTH', at: new Date() }, { greenStrip, channel: 'CUSTOMER_PORTAL' })
        .catch(() => null);
      pricePaise = q?.totalPaise ?? null;
    }
    const result = {
      maker: reply.maker,
      fuel: reply.fuel,
      vchCatg: reply.vchCatg,
      vehicleClass: category?.vehicleClass ?? null,
      norms: reply.norms,
      greenStrip,
      regnDate: reply.regnDate,
      hasPlates,
      orderType,
      pricePaise,
      message: hasPlates
        ? 'HSRP already fitted on this vehicle. You can order a replacement with a photo of the damaged plate or a police report.'
        : isNew
          ? 'This is a new vehicle (registered on or after the cut-off date). Its HSRP is supplied through the dealer.'
          : 'Eligible for HSRP fitment.',
    };
    await this.prisma.vehicleCheck.update({ where: { id: c.id }, data: { status: orderType ? 'DONE' : 'FAILED', result: result as Prisma.InputJsonValue, error: orderType ? null : result.message } });
  }
}
