import { Body, Controller, Get, HttpCode, Module, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ComplaintRequest, CustomerOrderRequest, OtpRequest, OtpVerify, RescheduleRequest, VehicleCheckRequest } from '@hsrp/contracts';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Idempotent, Public, RequirePermission } from '../../platform/http/decorators';
import { Problem } from '../../platform/http/problem';
import { TicketsService } from '../../utility/tickets/tickets.service';
import { BookingModule, BookingService } from '../booking/booking.module';
import { MastersModule } from '../masters/masters.module';
import { MastersService } from '../masters/masters.service';
import { OrderIntakeModule } from '../order-intake/order-intake.module';
import { VehicleCheckService } from '../order-intake/vehicle-check.service';
import { sendPdf } from '../shared/pdf';
import { CustomerPortalService } from './customer-portal.service';

class VehicleCheckDto extends createZodDto(VehicleCheckRequest) {}
class OtpRequestDto extends createZodDto(OtpRequest) {}
class OtpVerifyDto extends createZodDto(OtpVerify) {}
class CustomerOrderDto extends createZodDto(CustomerOrderRequest) {}
class RescheduleDto extends createZodDto(RescheduleRequest) {}
class ComplaintDto extends createZodDto(ComplaintRequest) {}
class ComplaintStatusDto extends createZodDto(OtpVerify.extend({ ticketNo: z.string().min(3) })) {}

const STRICT = { default: { limit: 20, ttl: 60_000 } };

@ApiTags('public-portal')
@Controller('public')
export class CustomerPortalController {
  constructor(
    private readonly portal: CustomerPortalService,
    private readonly checks: VehicleCheckService,
    private readonly booking: BookingService,
    private readonly masters: MastersService,
    private readonly tickets: TicketsService,
  ) {}

  @Get('states')
  @Public()
  states() {
    return this.portal.states();
  }

  @Get('cities')
  @Public()
  cities(@Query('stateCode') stateCode: string) {
    return this.masters.cities(stateCode);
  }

  @Get('fitment-centres')
  @Public()
  centres(@Query('stateCode') stateCode: string, @Query('city') city?: string) {
    return this.masters.fitmentCentres(stateCode, city);
  }

  @Get('slots')
  @Public()
  slots(@Query('dealerCode') dealerCode: string, @Query('date') date: string) {
    return this.booking.slots(dealerCode, date);
  }

  @Post('vehicle-checks')
  @Public()
  @Throttle(STRICT)
  check(@Body() body: VehicleCheckDto) {
    return this.checks.request(body);
  }

  @Get('vehicle-checks/:id')
  @Public()
  getCheck(@Param('id') id: string) {
    return this.checks.get(id);
  }

  @Post('otp')
  @Public()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  otp(@Body() body: OtpRequestDto) {
    return this.portal.requestOtp(body);
  }

  @Post('evidence')
  @Public()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  evidence(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw Problem.badRequest('Attach the file in the "file" field');
    return this.portal.uploadEvidence(file);
  }

  @Post('orders')
  @Public()
  @Throttle(STRICT)
  @Idempotent()
  placeOrder(@Body() body: CustomerOrderDto) {
    return this.portal.placeOrder(body);
  }

  @Get('orders/:id')
  @ApiBearerAuth()
  @RequirePermission('portal.customer')
  order(@Param('id') id: string) {
    return this.portal.orderView(id);
  }

  @Post('orders/:id/checkout')
  @RequirePermission('portal.customer')
  @HttpCode(200)
  checkout(@Param('id') id: string) {
    return this.portal.checkout(id);
  }

  @Post('orders/:id/verify-payment')
  @RequirePermission('portal.customer')
  @HttpCode(200)
  verify(@Param('id') id: string) {
    return this.portal.verifyPayment(id);
  }

  @Post('orders/:id/reschedule')
  @RequirePermission('portal.customer')
  @HttpCode(200)
  reschedule(@Param('id') id: string, @Body() body: RescheduleDto) {
    return this.portal.reschedule(id, body.slotDate, body.slotStart);
  }

  @Get('orders/:id/receipt')
  @RequirePermission('portal.customer')
  async receipt(@Param('id') id: string, @Res() res: Response) {
    sendPdf(res, await this.portal.receipt(id));
  }

  @Post('status')
  @Public()
  @Throttle(STRICT)
  @HttpCode(200)
  status(@Body() body: OtpVerifyDto) {
    return this.portal.statusLogin(body.otpRef, body.code);
  }

  @Get('complaint-categories')
  @Public()
  categories() {
    return this.tickets.categories();
  }

  @Post('complaints')
  @Public()
  @Throttle(STRICT)
  complaint(@Body() body: ComplaintDto) {
    return this.portal.raiseComplaint(body);
  }

  @Post('complaints/status')
  @Public()
  @Throttle(STRICT)
  @HttpCode(200)
  complaintStatus(@Body() body: ComplaintStatusDto) {
    return this.portal.complaintStatus(body.ticketNo, body.otpRef, body.code);
  }
}

@Module({
  imports: [MastersModule, OrderIntakeModule, BookingModule],
  controllers: [CustomerPortalController],
  providers: [CustomerPortalService],
})
export class CustomerPortalModule {}
