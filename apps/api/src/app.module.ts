import { Module } from '@nestjs/common';
import { AdaptersModule } from './adapters/adapters.module';
import { CoreModule } from './core/core.module';
import { PlatformModule } from './platform/platform.module';
import { UtilityModule } from './utility/utility.module';

/** Composition root: platform, generic utilities, adapters bound to ports, then the HSRP core. */
@Module({ imports: [PlatformModule, UtilityModule, AdaptersModule, CoreModule] })
export class AppModule {}
