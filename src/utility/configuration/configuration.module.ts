import { Body, Controller, Get, Global, Module, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigSetRequest } from '@hsrp/contracts';
import { createZodDto } from 'nestjs-zod';
import { RequirePermission } from '../../platform/http/decorators';
import { SettingsService } from './settings.service';

class ConfigSetDto extends createZodDto(ConfigSetRequest) {}

@ApiTags('configuration')
@Controller('config')
export class ConfigurationController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermission('config.read', 'config.manage')
  list(@Query('key') key?: string, @Query('history') history?: string) {
    return this.settings.list({ key, includeHistory: history === 'true' });
  }

  @Get('resolve')
  @RequirePermission('config.read', 'config.manage')
  async resolve(@Query('key') key: string, @Query('scopes') scopes?: string) {
    const parsed = (scopes ?? '')
      .split(',')
      .filter(Boolean)
      .map((s) => {
        const [type, id] = s.split(':');
        return { type, id };
      });
    return { key, value: (await this.settings.get(key, parsed)) ?? null };
  }

  @Post()
  @RequirePermission('config.manage')
  set(@Body() body: ConfigSetDto) {
    return this.settings.set({ ...body, value: body.value ?? null, effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined });
  }
}

@Global()
@Module({ controllers: [ConfigurationController], providers: [SettingsService], exports: [SettingsService] })
export class ConfigurationModule {}
