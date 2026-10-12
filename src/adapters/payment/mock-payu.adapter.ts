import { Injectable } from '@nestjs/common';
import { env } from '../../platform/config/env';
import { PrismaService } from '../../platform/database/prisma.service';
import {
  CallbackResult,
  CheckoutForm,
  CheckoutRequest,
  PaymentProvider,
  ProviderStatus,
} from '../../utility/payments/payment-provider.port';
import { paise, requestHash, responseHash, rupees } from './payu-hash';

export function mapPayuStatus(status: string | undefined, unmapped?: string): ProviderStatus {
  if (status === 'success') return 'SUCCESS';
  if (status === 'pending' || status === 'initiated') return 'PENDING';
  if (unmapped === 'userCancelled' || status === 'cancelled') return 'CANCELLED';
  return 'FAILED';
}

/** PayU-shaped hosted checkout whose "gateway" is the mock page served by MockPayuGatewayController. */
@Injectable()
export class MockPayuAdapter implements PaymentProvider {
  readonly name = 'payu';

  constructor(private readonly prisma: PrismaService) {}

  createCheckout(req: CheckoutRequest): CheckoutForm {
    const fields: Record<string, string> = {
      key: env.payu.key,
      txnid: req.txnId,
      amount: rupees(req.amountPaise),
      productinfo: req.productInfo,
      firstname: req.payer.name,
      email: req.payer.email ?? 'customer@example.invalid',
      phone: req.payer.mobile ?? '',
      surl: req.successUrl,
      furl: req.failureUrl,
    };
    fields.hash = requestHash(fields, env.payu.salt);
    return { action: `${env.publicApiUrl}/mock-gateway/payu/_payment`, method: 'POST', fields };
  }

  parseCallback(body: Record<string, string>): CallbackResult {
    const hashValid = Boolean(body.hash) && responseHash(body, env.payu.salt) === body.hash;
    return {
      txnId: body.txnid,
      status: mapPayuStatus(body.status, body.unmappedstatus),
      hashValid,
      providerRef: body.mihpayid,
      amountPaise: body.amount ? paise(body.amount) : undefined,
    };
  }

  /** Simulates PayU's verify_payment server-to-server API. */
  async verify(txnId: string) {
    const t = await this.prisma.mockPayuTxn.findUnique({ where: { txnid: txnId } });
    if (!t) return { status: 'PENDING' as ProviderStatus };
    return { status: mapPayuStatus(t.status), providerRef: t.mihpayid ?? undefined, amountPaise: paise(t.amount) };
  }

  async refund(txnId: string, amountPaise: number, refundRef: string) {
    const t = await this.prisma.mockPayuTxn.findUnique({ where: { txnid: txnId } });
    if (!t || t.status !== 'success') return { providerRef: '', status: 'FAILED' as const };
    const refunds = [...((t.refunds as unknown[]) ?? []), { refundRef, amount: rupees(amountPaise), at: new Date().toISOString() }];
    await this.prisma.mockPayuTxn.update({ where: { id: t.id }, data: { refunds: refunds as object[] } });
    return { providerRef: `RF${refundRef.slice(0, 8).toUpperCase()}`, status: 'SUCCESS' as const };
  }
}
