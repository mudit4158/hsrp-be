import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { OemOrderRequest } from '@hsrp/contracts';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { Problem } from '../../platform/http/problem';
import { ImportService } from '../../utility/import-export/import.service';
import { MastersService } from '../masters/masters.service';
import { ORDER_SOURCE, OrderSource } from '../ports/oem.port';
import { OrderService } from './order.service';

/** OEM orders by API push and by CSV file (through the Import utility with one mapping profile per OEM). */
@Injectable()
export class OemIntakeService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
    private readonly masters: MastersService,
    private readonly imports: ImportService,
    @Inject(ORDER_SOURCE) private readonly source: OrderSource,
  ) {}

  onModuleInit() {
    this.imports.registerTarget('hsrp.oem-order', {
      processRow: async (row, ctx) => {
        const oemCode = ctx.context.oemCode;
        if (!oemCode) throw new Error('Import profile has no oemCode in its context');
        const parsed = OemOrderRequest.safeParse(row);
        if (!parsed.success) throw Problem.badRequest(parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '));
        const order = await this.intake(oemCode, parsed.data, 'OEM_FILE');
        return { ref: order.id };
      },
    });
  }

  /** API push. The caller must be the OEM's own API client. */
  async push(oemCode: string, payload: unknown) {
    const oem = await this.masters.oemByCode(oemCode);
    const actor = requestContext.actor();
    if (actor?.type === 'api-client' && actor.orgId !== oem.orgId) throw Problem.forbidden('This API key belongs to another OEM');
    const canonical = this.source.toCanonical(oem.code, payload);
    const order = await this.intake(oem.code, canonical, 'OEM_API');
    return { orderId: order.id, orderNo: order.orderNo, status: order.status, oemOrderRef: order.sourceRef };
  }

  private async intake(oemCode: string, req: OemOrderRequest, channel: 'OEM_API' | 'OEM_FILE') {
    const oem = await this.masters.oemByCode(oemCode);
    const dup = await this.orders.findBySourceRef(oem.id, req.oemOrderRef);
    if (dup) throw Problem.conflict(`OEM order ${req.oemOrderRef} was already received as ${dup.orderNo}`, 'duplicate-oem-order', { orderId: dup.id, orderNo: dup.orderNo });
    const dealer = await this.masters.dealerByCode(req.dealerCode);
    return this.prisma.tx((tx) =>
      this.orders.create(
        {
          channel,
          orderType: 'NEW',
          plateSet: 'BOTH',
          regnNo: req.regnNo,
          chassisNo: req.chassisNo,
          engineNo: req.engineNo,
          ownerName: req.ownerName,
          mobile: req.mobile,
          dealerId: dealer.id,
          oemId: oem.id,
          sourceRef: req.oemOrderRef,
        },
        tx,
      ),
    );
  }

  async status(oemCode: string, ref: string) {
    const oem = await this.masters.oemByCode(oemCode);
    const o = await this.orders.findBySourceRef(oem.id, ref);
    if (!o) throw Problem.notFound('Order');
    return { oemOrderRef: ref, orderNo: o.orderNo, status: o.status, rejectionReason: o.rejectionReason, updatedAt: o.updatedAt };
  }
}
