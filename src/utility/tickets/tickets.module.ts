import { Body, Controller, Get, Global, Module, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TicketReplyRequest } from '@hsrp/contracts';
import { createZodDto } from 'nestjs-zod';
import { RequirePermission } from '../../platform/http/decorators';
import { FilteredPageQueryDto } from '../../platform/http/pagination';
import { TicketsService } from './tickets.service';

class ReplyDto extends createZodDto(TicketReplyRequest) {}

@ApiTags('tickets')
@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  @RequirePermission('tickets.manage')
  list(@Query() q: FilteredPageQueryDto) {
    return this.tickets.list({ status: q.status as string | undefined, overdue: q.overdue === 'true', page: q.page, pageSize: q.pageSize });
  }

  @Get('categories')
  @RequirePermission('tickets.manage')
  categories() {
    return this.tickets.categories();
  }

  @Get(':id')
  @RequirePermission('tickets.manage')
  get(@Param('id') id: string) {
    return this.tickets.get(id);
  }

  @Post(':id/replies')
  @RequirePermission('tickets.manage')
  reply(@Param('id') id: string, @Body() body: ReplyDto) {
    return this.tickets.reply(id, body);
  }
}

@Global()
@Module({ controllers: [TicketsController], providers: [TicketsService], exports: [TicketsService] })
export class TicketsModule {}
