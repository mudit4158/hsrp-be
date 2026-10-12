import { Injectable } from '@nestjs/common';
import { requestContext } from '../../platform/context/request-context';
import { Db, PrismaService, Tx } from '../../platform/database/prisma.service';
import { Problem } from '../../platform/http/problem';

export interface CalendarRuleInput {
  weekday: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  capacity: number;
}

export interface Slot {
  start: string;
  capacity: number;
  booked: number;
  available: number;
}

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Slot starts for one calendar rule. Pure, unit-tested. */
export function slotStarts(rule: Pick<CalendarRuleInput, 'startTime' | 'endTime' | 'slotMinutes'>): string[] {
  const out: string[] = [];
  for (let m = toMin(rule.startTime); m + rule.slotMinutes <= toMin(rule.endTime); m += rule.slotMinutes) out.push(toHHMM(m));
  return out;
}

/** Weekday (0 = Sunday) of a YYYY-MM-DD date. */
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Resources with weekly capacity calendars, slots and bookings. Knows nothing about what is booked. */
@Injectable()
export class SchedulingService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertResource(input: { code: string; name: string; subjectType?: string; subjectId?: string }, db: Db = this.prisma) {
    const tenantId = requestContext.tenantId();
    return db.schedResource.upsert({
      where: { tenantId_code: { tenantId, code: input.code } },
      create: { tenantId, ...input },
      update: { name: input.name },
    });
  }

  async setCalendar(resourceId: string, rules: CalendarRuleInput[], db: Db = this.prisma) {
    const tenantId = requestContext.tenantId();
    await db.schedCalendarRule.deleteMany({ where: { resourceId } });
    await db.schedCalendarRule.createMany({ data: rules.map((r) => ({ tenantId, resourceId, ...r })) });
  }

  resourceFor(subjectType: string, subjectId: string, db: Db = this.prisma) {
    return db.schedResource.findFirst({ where: { tenantId: requestContext.tenantId(), subjectType, subjectId, active: true } });
  }

  async slots(resourceId: string, date: string, db: Db = this.prisma): Promise<Slot[]> {
    const closed = await db.schedClosure.findUnique({ where: { resourceId_date: { resourceId, date } } });
    if (closed) return [];
    const rules = await db.schedCalendarRule.findMany({ where: { resourceId, weekday: weekdayOf(date) } });
    const booked = await db.schedBooking.groupBy({ by: ['slotStart'], where: { resourceId, date, status: 'BOOKED' }, _count: true });
    const bookedBy = new Map(booked.map((b) => [b.slotStart, b._count]));
    return rules
      .flatMap((r) => slotStarts(r).map((start) => ({ start, capacity: r.capacity })))
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((s) => ({ ...s, booked: bookedBy.get(s.start) ?? 0, available: Math.max(0, s.capacity - (bookedBy.get(s.start) ?? 0)) }));
  }

  /** Books one unit of capacity. Serialised per slot with an advisory lock so capacity is never exceeded. */
  async book(resourceId: string, date: string, slotStart: string, subject: { subjectType: string; subjectId: string }, tx: Tx) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${resourceId}|${date}|${slotStart}`}))`;
    const slot = (await this.slots(resourceId, date, tx)).find((s) => s.start === slotStart);
    if (!slot) throw Problem.unprocessable('That slot does not exist on that date', 'slot-invalid');
    if (slot.available <= 0) throw Problem.conflict('That slot is full. Pick another one.', 'slot-full');
    return tx.schedBooking.create({
      data: { tenantId: requestContext.tenantId(), resourceId, date, slotStart, subjectType: subject.subjectType, subjectId: subject.subjectId },
    });
  }

  async cancel(bookingId: string, db: Db = this.prisma) {
    return db.schedBooking.update({ where: { id: bookingId }, data: { status: 'CANCELLED' } });
  }

  async reschedule(bookingId: string, date: string, slotStart: string, tx: Tx) {
    const old = await tx.schedBooking.findUniqueOrThrow({ where: { id: bookingId } });
    if (old.status !== 'BOOKED') throw Problem.conflict('Booking is not active');
    await tx.schedBooking.update({ where: { id: bookingId }, data: { status: 'CANCELLED' } });
    return this.book(old.resourceId, date, slotStart, { subjectType: old.subjectType, subjectId: old.subjectId }, tx);
  }

  bookingsFor(resourceId: string, date: string) {
    return this.prisma.schedBooking.findMany({ where: { resourceId, date, status: 'BOOKED' }, orderBy: { slotStart: 'asc' } });
  }
}
