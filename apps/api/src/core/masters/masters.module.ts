import { Body, Controller, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../platform/http/decorators';
import { MASTER_RESOURCES, MastersService } from './masters.service';
import { ScopeService } from './scope.service';

@ApiTags('masters')
@Controller('masters')
export class MastersController {
  constructor(private readonly masters: MastersService) {}

  @Get()
  @RequirePermission('masters.read')
  resources() {
    return Object.entries(MASTER_RESOURCES).map(([key, r]) => ({ key, label: r.label }));
  }

  @Get(':resource')
  @RequirePermission('masters.read', 'orders.read')
  list(@Param('resource') resource: string, @Query('q') q?: string) {
    return this.masters.list(resource, q);
  }

  @Post(':resource')
  @RequirePermission('masters.manage')
  create(@Param('resource') resource: string, @Body() body: unknown) {
    return this.masters.create(resource, body);
  }

  @Patch(':resource/:id')
  @RequirePermission('masters.manage')
  update(@Param('resource') resource: string, @Param('id') id: string, @Body() body: unknown) {
    return this.masters.update(resource, id, body);
  }
}

@Module({ controllers: [MastersController], providers: [MastersService, ScopeService], exports: [MastersService, ScopeService] })
export class MastersModule {}
