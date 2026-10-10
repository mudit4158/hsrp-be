import { Module } from '@nestjs/common';
import { BookingModule } from './booking/booking.module';
import { CustomerPortalModule } from './customer-portal/customer-portal.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { FitmentModule } from './fitment/fitment.module';
import { InventoryModule } from './inventory/inventory.module';
import { MastersModule } from './masters/masters.module';
import { OrderIntakeModule } from './order-intake/order-intake.module';
import { OversightModule } from './oversight/oversight.module';
import { PricingModule } from './pricing/pricing.module';
import { ProductionModule } from './production/production.module';
import { RejectionModule } from './rejection/rejection.module';

/** HSRP-specific modules. They may use utilities and ports, never adapters. */
@Module({
  imports: [
    MastersModule,
    PricingModule,
    InventoryModule,
    OrderIntakeModule,
    BookingModule,
    RejectionModule,
    ProductionModule,
    DispatchModule,
    FitmentModule,
    CustomerPortalModule,
    OversightModule,
  ],
})
export class CoreModule {}
