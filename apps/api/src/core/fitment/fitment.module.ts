import { Body, Controller, Get, Module, OnModuleInit, Post, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { FitmentRequest } from '@hsrp/contracts';
import { Idempotent, RequirePermission } from '../../platform/http/decorators';
import { Scheduler } from '../../platform/worker/scheduler.service';
import { InventoryModule } from '../inventory/inventory.module';
import { MastersModule } from '../masters/masters.module';
import { OrderIntakeModule } from '../order-intake/order-intake.module';
import { FitmentService } from './fitment.service';

@ApiTags('fitment')
@Controller('fitments')
export class FitmentController {
  constructor(private readonly fitment: FitmentService) {}

  @Get('search')
  @RequirePermission('fitment.record', 'orders.read')
  search(@Query('regnNo') regnNo: string) {
    return this.fitment.search(regnNo ?? '');
  }

  /** Multipart: fields of FitmentRequest plus photo files `front`, `rear`, `chassis`. Safe to retry with the same Idempotency-Key (offline sync). */
  @Post()
  @RequirePermission('fitment.record')
  @Idempotent()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        frontLaserCode: { type: 'string' },
        rearLaserCode: { type: 'string' },
        fittedAt: { type: 'string', format: 'date-time' },
        front: { type: 'string', format: 'binary' },
        rear: { type: 'string', format: 'binary' },
        chassis: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'front', maxCount: 1 },
        { name: 'rear', maxCount: 1 },
        { name: 'chassis', maxCount: 1 },
      ],
      { limits: { fileSize: 8 * 1024 * 1024 } },
    ),
  )
  record(@Body() body: Record<string, string>, @UploadedFiles() files: { front?: Express.Multer.File[]; rear?: Express.Multer.File[]; chassis?: Express.Multer.File[] } = {}) {
    const input = FitmentRequest.parse(body);
    return this.fitment.record(input, { front: files.front?.[0], rear: files.rear?.[0], chassis: files.chassis?.[0] });
  }

  @Get('vahan-pending')
  @RequirePermission('integration.monitor', 'orders.read')
  pending() {
    return this.fitment.pendingVahan();
  }

  @Post('vahan-eod-alert')
  @RequirePermission('integration.replay')
  eodAlert() {
    return this.fitment.endOfDayAlert(true);
  }
}

@Module({
  imports: [MastersModule, InventoryModule, OrderIntakeModule],
  controllers: [FitmentController],
  providers: [FitmentService],
  exports: [FitmentService],
})
export class FitmentModule implements OnModuleInit {
  constructor(
    private readonly scheduler: Scheduler,
    private readonly fitment: FitmentService,
  ) {}

  onModuleInit() {
    this.scheduler.every('fitment.vahan-eod-alert', 60_000, () => this.fitment.endOfDayAlert());
  }
}
