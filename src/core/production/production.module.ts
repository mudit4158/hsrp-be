import { Body, Controller, Get, Module, Param, Post, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { IssuanceRequest, PendingIssuanceQuery, QcRequest, StickerPrintRequest, SwitchLaserRequest } from '@hsrp/contracts';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { RequirePermission } from '../../platform/http/decorators';
import { InventoryModule } from '../inventory/inventory.module';
import { MastersModule } from '../masters/masters.module';
import { OrderIntakeModule } from '../order-intake/order-intake.module';
import { RejectionModule } from '../rejection/rejection.module';
import { sendPdf } from '../shared/pdf';
import { ProductionService } from './production.service';

class PendingDto extends createZodDto(PendingIssuanceQuery) {}
class IssueDto extends createZodDto(IssuanceRequest) {}
class QcDto extends createZodDto(QcRequest) {}
class SwitchDto extends createZodDto(SwitchLaserRequest) {}
class StickerDto extends createZodDto(StickerPrintRequest) {}

@ApiTags('station')
@Controller('station')
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @Get('issuance/pending')
  @RequirePermission('station.operate', 'station.read')
  pending(@Query() q: PendingDto) {
    return this.production.pending(q);
  }

  @Post('issuance')
  @RequirePermission('station.operate')
  issue(@Body() body: IssueDto) {
    return this.production.issue(body);
  }

  @Get('job-cards')
  @RequirePermission('station.operate', 'station.read')
  jobCards(@Query('stationId') stationId?: string) {
    return this.production.jobCards(stationId);
  }

  @Get('job-cards/:id/pdf')
  @RequirePermission('station.operate', 'station.read')
  async jobCardPdf(@Param('id') id: string, @Res() res: Response) {
    sendPdf(res, await this.production.jobCardPdf(id));
  }

  @Get('qc')
  @RequirePermission('station.operate', 'station.read')
  qcQueue(@Query('stationId') stationId?: string) {
    return this.production.qcQueue(stationId);
  }

  /** Multipart: photo files `front` and/or `rear` of the embossed plates; each is read by OCR (D45). */
  @Post('qc/:orderId/plate-photos')
  @RequirePermission('station.operate')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'front', maxCount: 1 },
        { name: 'rear', maxCount: 1 },
      ],
      { limits: { fileSize: 8 * 1024 * 1024 } },
    ),
  )
  platePhotos(@Param('orderId') orderId: string, @UploadedFiles() files: { front?: Express.Multer.File[]; rear?: Express.Multer.File[] } = {}) {
    return this.production.checkPlatePhotos(orderId, { FRONT: files.front?.[0], REAR: files.rear?.[0] });
  }

  @Post('qc/:orderId')
  @RequirePermission('station.operate')
  qc(@Param('orderId') orderId: string, @Body() body: QcDto) {
    return this.production.qc(orderId, body);
  }

  @Post('qc/:orderId/switch-laser')
  @RequirePermission('station.operate')
  switchLaser(@Param('orderId') orderId: string, @Body() body: SwitchDto) {
    return this.production.switchLaser(orderId, body);
  }

  @Get('stickers')
  @RequirePermission('station.operate', 'station.read')
  stickerQueue(@Query('stationId') stationId?: string) {
    return this.production.stickerQueue(stationId);
  }

  @Post('stickers/:orderId/print')
  @RequirePermission('station.operate')
  async print(@Param('orderId') orderId: string, @Body() body: StickerDto, @Res() res: Response) {
    sendPdf(res, await this.production.printSticker(orderId, body));
  }
}

@Module({
  imports: [MastersModule, InventoryModule, OrderIntakeModule, RejectionModule],
  controllers: [ProductionController],
  providers: [ProductionService],
  exports: [ProductionService],
})
export class ProductionModule {}
