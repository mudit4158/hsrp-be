export const PAYMENT_PROVIDER = Symbol('PaymentProvider');

export type ProviderStatus = 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'PENDING';

export interface CheckoutRequest {
  txnId: string;
  amountPaise: number;
  productInfo: string;
  payer: { name: string; email?: string; mobile?: string };
  successUrl: string;
  failureUrl: string;
}

/** A browser form post to the gateway's hosted page. */
export interface CheckoutForm {
  action: string;
  method: 'POST';
  fields: Record<string, string>;
}

export interface CallbackResult {
  txnId: string;
  status: ProviderStatus;
  hashValid: boolean;
  providerRef?: string;
  amountPaise?: number;
}

/** Port for a hosted-checkout payment gateway (shaped after PayU). */
export interface PaymentProvider {
  readonly name: string;
  createCheckout(req: CheckoutRequest): CheckoutForm;
  parseCallback(body: Record<string, string>): CallbackResult;
  verify(txnId: string): Promise<{ status: ProviderStatus; providerRef?: string; amountPaise?: number }>;
  refund(txnId: string, amountPaise: number, refundRef: string): Promise<{ providerRef: string; status: 'SUCCESS' | 'PENDING' | 'FAILED' }>;
}
