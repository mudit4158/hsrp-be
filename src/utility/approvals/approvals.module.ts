import { Body, Controller, Get, Global, Module, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DecisionRequest } from '@hsrp/contracts';
import { createZodDto } from 'nestjs-zod';
import { RequirePermission } from '../../platform/http/decorators';
import { ApprovalsService } from './approvals.service';

class DecisionDto extends createZodDto(DecisionRequest) {}

@ApiTags('approvals')
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  @RequirePermission('approvals.decide', 'approvals.read')
  list(@Query('type') type?: string, @Query('status') status?: string, @Query('subjectId') subjectId?: string) {
    return this.approvals.list({ type, status, subjectId });
  }

  @Post(':id/decision')
  @RequirePermission('approvals.decide')
  decide(@Param('id') id: string, @Body() body: DecisionDto) {
    return this.approvals.decide(id, body.decision, body.remarks);
  }
}

@Global()
@Module({ controllers: [ApprovalsController], providers: [ApprovalsService], exports: [ApprovalsService] })
export class ApprovalsModule {}
