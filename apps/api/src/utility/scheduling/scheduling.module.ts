import { Body, Controller, Get, Global, Module, Param, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { RequirePermission } from '../../platform/http/decorators';
import { SchedulingService } from './scheduling.service';

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
class CalendarDto extends createZodDto(
  z.object({
    rules: z.array(z.object({ weekday: z.number().int().min(0).max(6), startTime: hhmm, endTime: hhmm, slotMinutes: z.number().int().min(10).max(480), capacity: z.number().int().min(1).max(100) })),
  }),
) {}

@ApiTags('scheduling')
@Controller('scheduling')
export class SchedulingController {
  constructor(
    private readonly scheduling: SchedulingService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('resources')
  @RequirePermission('scheduling.manage', 'masters.read')
  resources() {
    return this.prisma.schedResource.findMany({ where: { tenantId: requestContext.tenantId() }, orderBy: { code: 'asc' } });
  }

  @Get('resources/:id/calendar')
  @RequirePermission('scheduling.manage', 'masters.read')
  calendar(@Param('id') id: string) {
    return this.prisma.schedCalendarRule.findMany({ where: { resourceId: id }, orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] });
  }

  @Put('resources/:id/calendar')
  @RequirePermission('scheduling.manage')
  setCalendar(@Param('id') id: string, @Body() body: CalendarDto) {
    return this.prisma.tx((tx) => this.scheduling.setCalendar(id, body.rules, tx));
  }

  @Get('resources/:id/slots')
  @RequirePermission('scheduling.manage', 'masters.read', 'orders.read')
  slots(@Param('id') id: string, @Query('date') date: string) {
    return this.scheduling.slots(id, date);
  }

  @Get('resources/:id/bookings')
  @RequirePermission('scheduling.manage', 'orders.read')
  bookings(@Param('id') id: string, @Query('date') date: string) {
    return this.scheduling.bookingsFor(id, date);
  }
}

@Global()
@Module({ controllers: [SchedulingController], providers: [SchedulingService], exports: [SchedulingService] })
export class SchedulingModule {}
