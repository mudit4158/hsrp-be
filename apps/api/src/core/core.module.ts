import { Module } from '@nestjs/common';

/** HSRP-specific modules. They may use utilities and ports, never adapters. */
@Module({ imports: [] })
export class CoreModule {}
