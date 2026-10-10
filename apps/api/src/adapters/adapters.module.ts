import { Global, Module, Provider } from '@nestjs/common';
import { env } from '../platform/config/env';
import { OEM_VEHICLE_CATALOG, ORDER_SOURCE } from '../core/ports/oem.port';
import { VEHICLE_REGISTRY } from '../core/ports/vehicle-registry.port';
import { FILE_STORE } from '../utility/file-storage/file-store.port';
import { MESSAGE_SENDER } from '../utility/notification/message-sender.port';
import { PAYMENT_PROVIDER } from '../utility/payments/payment-provider.port';
import { DbFileStore } from './file-store/db-file-store.adapter';
import { MockMessageSender, RealMessageSender } from './messaging/mock-message-sender.adapter';
import { MockStateService } from './mock-state.service';
import { MockOemCatalog, MockOrderSource, RealOemCatalog, RealOrderSource } from './oem/mock-oem.adapter';
import { MockPayuGatewayController } from './payment/mock-payu-gateway.controller';
import { MockPayuAdapter } from './payment/mock-payu.adapter';
import { RealPayuAdapter } from './payment/real-payu.adapter';
import { SimulatorController } from './simulator/simulator.controller';
import { MockVahanAdapter } from './vahan/mock-vahan.adapter';
import { RealVahanAdapter } from './vahan/real-vahan.adapter';

type Ctor = new (...args: never[]) => unknown;

/** Binds `token` to the mock (or db) or real class according to the environment variable's value. */
function bind(envName: string, value: string, token: symbol, mock: Ctor, real: Ctor): Provider {
  if (value === 'mock' || value === 'db') return { provide: token, useClass: mock };
  if (value === 'real') return { provide: token, useClass: real };
  throw new Error(`${envName} must be "mock" or "real", got "${value}"`);
}

/** Binds every port to its implementation, chosen by environment variable (e.g. VAHAN_ADAPTER=mock). */
@Global()
@Module({
  controllers: [MockPayuGatewayController, SimulatorController],
  providers: [
    MockStateService,
    bind('VAHAN_ADAPTER', env.adapters.vahan, VEHICLE_REGISTRY, MockVahanAdapter, RealVahanAdapter),
    bind('PAYMENT_ADAPTER', env.adapters.payment, PAYMENT_PROVIDER, MockPayuAdapter, RealPayuAdapter),
    bind('MESSAGE_ADAPTER', env.adapters.message, MESSAGE_SENDER, MockMessageSender, RealMessageSender),
    bind('OEM_ADAPTER', env.adapters.oem, ORDER_SOURCE, MockOrderSource, RealOrderSource),
    bind('OEM_ADAPTER', env.adapters.oem, OEM_VEHICLE_CATALOG, MockOemCatalog, RealOemCatalog),
    bind('FILE_STORE_ADAPTER', env.adapters.fileStore, FILE_STORE, DbFileStore, DbFileStore),
  ],
  exports: [VEHICLE_REGISTRY, PAYMENT_PROVIDER, MESSAGE_SENDER, ORDER_SOURCE, OEM_VEHICLE_CATALOG, FILE_STORE, MockStateService],
})
export class AdaptersModule {}
