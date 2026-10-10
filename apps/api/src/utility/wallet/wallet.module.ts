import { Body, Controller, Get, Global, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TopUpRequest } from '@hsrp/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Idempotent, RequirePermission } from '../../platform/http/decorators';
import { toPaise } from './ledger-rules';
import { WalletService } from './wallet.service';

class TopUpDto extends createZodDto(TopUpRequest) {}
class CreditLimitDto extends createZodDto(z.object({ creditLimitRupees: z.coerce.number().min(0).max(100_000_000) })) {}

@ApiTags('wallets')
@Controller('wallets')
export class WalletController {
  constructor(private readonly wallets: WalletService) {}

  @Get()
  @RequirePermission('wallet.read')
  list() {
    return this.wallets.list();
  }

  @Get(':id')
  @RequirePermission('wallet.read')
  summary(@Param('id') id: string) {
    return this.wallets.summary(id);
  }

  @Get(':id/statement')
  @RequirePermission('wallet.read')
  statement(@Param('id') id: string, @Query('page') page = '1') {
    return this.wallets.statement(id, Number(page) || 1);
  }

  @Get(':id/holds')
  @RequirePermission('wallet.read')
  holds(@Param('id') id: string, @Query('status') status?: string) {
    return this.wallets.holdsFor(id, status);
  }

  @Post(':id/top-ups')
  @RequirePermission('wallet.manage')
  @Idempotent()
  topUp(@Param('id') id: string, @Body() body: TopUpDto) {
    return this.wallets.topUp(id, toPaise(body.amountRupees), body.reference);
  }

  @Patch(':id/credit-limit')
  @RequirePermission('wallet.manage')
  creditLimit(@Param('id') id: string, @Body() body: CreditLimitDto) {
    return this.wallets.setCreditLimit(id, toPaise(body.creditLimitRupees));
  }
}

@Global()
@Module({ controllers: [WalletController], providers: [WalletService], exports: [WalletService] })
export class WalletModule {}
