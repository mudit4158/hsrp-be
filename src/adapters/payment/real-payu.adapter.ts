import { Injectable } from '@nestjs/common';
import { PaymentProvider } from '../../utility/payments/payment-provider.port';

/** Placeholder for the real PayU integration (not built in the prototype, D6). */
@Injectable()
export class RealPayuAdapter implements PaymentProvider {
  readonly name = 'payu';
  private fail(): never {
    throw new Error('Real payment adapter is not implemented. Set PAYMENT_ADAPTER=mock.');
  }
  createCheckout() {
    return this.fail();
  }
  parseCallback() {
    return this.fail();
  }
  verify() {
    return this.fail();
  }
  refund() {
    return this.fail();
  }
}
