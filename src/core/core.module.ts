import { Module } from '@nestjs/common';
import { BillingModule } from './billing/billing.module';
import { BookingModule } from './booking/booking.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { FitmentModule } from './fitment/fitment.module';
import { InventoryModule } from './inventory/inventory.module';
import { MastersModule } from './masters/masters.module';
import { OrderIntakeModule } from './order-intake/order-intake.module';
import { OversightModule } from './oversight/oversight.module';
import { PricingModule } from './pricing/pricing.module';
import { ProductionModule } from './production/production.module';
import { RejectionModule } from './rejection/rejection.module';

/**
 * HSRP-specific modules. They may use utilities and ports, never adapters.
 *
 * The customer portal (core/customer-portal) is disabled (decision D37): its module is not imported, so none of
 * its /api/v1/public/* routes or event subscribers exist. To bring it back, import CustomerPortalModule here,
 * restore the CUSTOMER role's permissions and re-add the web routes.
 */
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
    BillingModule,
    OversightModule,
  ],
})
export class CoreModule {}
