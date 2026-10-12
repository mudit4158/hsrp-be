import { Controller, Get, Injectable, Module, OnModuleInit, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService, Tx } from '../../platform/database/prisma.service';
import { RequirePermission } from '../../platform/http/decorators';
import { Problem } from '../../platform/http/problem';
import { SettingsService } from '../../utility/configuration/settings.service';
import { EventBus } from '../../utility/integration-hub/event-bus.service';
import { SchedulingService } from '../../utility/scheduling/scheduling.service';
import { MastersModule } from '../masters/masters.module';
import { MastersService } from '../masters/masters.service';
import { ScopeService } from '../masters/scope.service';
import { OrderIntakeModule } from '../order-intake/order-intake.module';
import { OrderService } from '../order-intake/order.service';
import { istDate, SUBJECT } from '../shared/subjects';

const addDays = (date: string, n: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86400_000).toISOString().slice(0, 10);

/** Fitment centre, appointment slot, reschedule and cancel for customer orders. */
@Injectable()
export class BookingService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduling: SchedulingService,
    private readonly masters: MastersService,
    private readonly orders: OrderService,
    private readonly settings: SettingsService,
    private readonly bus: EventBus,
  ) {}

  onModuleInit() {
    this.bus.subscribe('OrderCancelled', 'booking.release-slot', async (e) => {
      const b = await this.prisma.booking.findUnique({ where: { orderId: String(e.payload.orderId) } });
      if (!b || b.status !== 'BOOKED') return;
      await this.prisma.tx(async (tx) => {
        await this.scheduling.cancel(b.schedBookingId, tx);
        await tx.booking.update({ where: { id: b.id }, data: { status: 'CANCELLED' } });
      });
    });
  }

  private async window() {
    const days = await this.settings.getOr<number>('booking.horizonDays', 30);
    const today = istDate();
    return { first: addDays(today, 1), last: addDays(today, days) };
  }

  async slots(dealerCode: string, date: string) {
    const dealer = await this.masters.dealerByCode(dealerCode);
    const res = await this.scheduling.resourceFor(SUBJECT.dealer, dealer.id);
    if (!res) throw Problem.unprocessable('This centre has no fitment calendar', 'no-calendar');
    const w = await this.window();
    if (date < w.first || date > w.last) return { date, first: w.first, last: w.last, slots: [] };
    return { date, first: w.first, last: w.last, slots: await this.scheduling.slots(res.id, date) };
  }

  async book(tx: Tx, orderId: string, dealerId: string, date: string, slotStart: string) {
    const w = await this.window();
    if (date < w.first || date > w.last) throw Problem.unprocessable(`Pick a date between ${w.first} and ${w.last}`, 'date-out-of-range');
    const res = await this.scheduling.resourceFor(SUBJECT.dealer, dealerId, tx);
    if (!res) throw Problem.unprocessable('This centre has no fitment calendar', 'no-calendar');
    const sb = await this.scheduling.book(res.id, date, slotStart, { subjectType: SUBJECT.order, subjectId: orderId }, tx);
    return tx.booking.create({ data: { tenantId: requestContext.tenantId(), orderId, dealerId, schedBookingId: sb.id, slotDate: date, slotStart } });
  }

  async reschedule(orderId: string, date: string, slotStart: string) {
    const order = await this.orders.get(orderId);
    if (['FITTED', 'COMPLETED', 'CANCELLED', 'REJECTED'].includes(order.status)) throw Problem.conflict(`Order is ${order.status}; the appointment cannot change`, 'booking-locked');
    const max = await this.settings.getOr<number>('booking.maxReschedules', 2);
    return this.prisma.tx(async (tx) => {
      const b = await tx.booking.findUnique({ where: { orderId } });
      if (!b || b.status !== 'BOOKED') throw Problem.notFound('Booking');
      if (b.rescheduleCount >= max) throw Problem.conflict(`An appointment can be rescheduled at most ${max} times`, 'reschedule-limit');
      const w = await this.window();
      if (date < w.first || date > w.last) throw Problem.unprocessable(`Pick a date between ${w.first} and ${w.last}`, 'date-out-of-range');
      const sb = await this.scheduling.reschedule(b.schedBookingId, date, slotStart, tx);
      return tx.booking.update({ where: { id: b.id }, data: { schedBookingId: sb.id, slotDate: date, slotStart, rescheduleCount: { increment: 1 } } });
    });
  }

  forOrder(orderId: string) {
    return this.prisma.booking.findUnique({ where: { orderId } });
  }

  async appointments(dealerId: string, date: string) {
    const rows = await this.prisma.booking.findMany({ where: { dealerId, slotDate: date, status: 'BOOKED' }, orderBy: { slotStart: 'asc' } });
    const orders = await this.orders.byIds(rows.map((r) => r.orderId));
    return rows.map((r) => {
      const o = orders.find((x) => x.id === r.orderId);
      return { ...r, orderNo: o?.orderNo, regnNo: o?.regnNo, ownerName: o?.ownerName, orderStatus: o?.status };
    });
  }
}

@ApiTags('booking')
@Controller('bookings')
export class BookingController {
  constructor(
    private readonly booking: BookingService,
    private readonly scope: ScopeService,
  ) {}

  @Get('appointments')
  @RequirePermission('orders.read')
  async appointments(@Query('date') date?: string, @Query('dealerId') dealerId?: string) {
    const s = await this.scope.current();
    const id = s.dealerId ?? dealerId;
    if (!id) throw Problem.badRequest('dealerId is required');
    return this.booking.appointments(id, date ?? istDate());
  }
}

@Module({ imports: [MastersModule, OrderIntakeModule], controllers: [BookingController], providers: [BookingService], exports: [BookingService] })
export class BookingModule {}
