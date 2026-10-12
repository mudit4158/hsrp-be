import { Body, Controller, Get, HttpCode, Module, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BoxLockRequest } from '@hsrp/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermission } from '../../platform/http/decorators';
import { Problem } from '../../platform/http/problem';
import { MastersModule } from '../masters/masters.module';
import { ScopeService } from '../masters/scope.service';
import { InventoryService } from './inventory.service';

class LockDto extends createZodDto(BoxLockRequest.extend({ stationId: z.string() })) {}
class ReleaseDto extends createZodDto(BoxLockRequest) {}

@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly scope: ScopeService,
  ) {}

  private async station(requested?: string) {
    const s = await this.scope.current();
    if (s.all) return requested;
    if (!s.stationId) throw Problem.forbidden();
    if (requested && requested !== s.stationId) throw Problem.forbidden('That is another station');
    return s.stationId;
  }

  @Get('stock')
  @RequirePermission('inventory.read')
  stock() {
    return this.inventory.stockByStation();
  }

  @Get('boxes')
  @RequirePermission('inventory.read')
  async boxes(@Query('stationId') stationId?: string, @Query('status') status?: string, @Query('q') q?: string) {
    return this.inventory.boxes({ stationId: await this.station(stationId), status, q });
  }

  @Get('plates')
  @RequirePermission('inventory.read')
  plates(@Query('boxNo') boxNo?: string, @Query('laserCode') laserCode?: string, @Query('status') status?: string) {
    return this.inventory.plates({ boxNo, laserCode, status });
  }

  @Get('plates/:laserCode/history')
  @RequirePermission('inventory.read', 'orders.read')
  history(@Param('laserCode') laserCode: string) {
    return this.inventory.plateHistory(laserCode);
  }

  @Post('boxes/lock')
  @RequirePermission('station.operate')
  @HttpCode(200)
  async lock(@Body() body: LockDto) {
    return this.inventory.lockBoxes((await this.station(body.stationId))!, body.boxNos);
  }

  @Post('boxes/release')
  @RequirePermission('station.operate')
  @HttpCode(200)
  async release(@Body() body: ReleaseDto) {
    await this.inventory.releaseBoxes(body.boxNos);
    return { released: body.boxNos };
  }
}

@Module({ imports: [MastersModule], controllers: [InventoryController], providers: [InventoryService], exports: [InventoryService] })
export class InventoryModule {}
