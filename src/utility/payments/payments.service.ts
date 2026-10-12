import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { env } from '../../platform/config/env';
import { requestContext } from '../../platform/context/request-context';
import { Db, PrismaService } from '../../platform/database/prisma.service';
import { NonRetryableError, Problem } from '../../platform/http/problem';
import { CallLogService } from '../integration-hub/call-log.service';
import { DeliveredEvent, EventBus } from '../integration-hub/event-bus.service';
import { PAYMENT_PROVIDER, PaymentProvider, ProviderStatus } from './payment-provider.port';

/**
 * Generic payments. A payment belongs to any subject (type + id). An order is marked paid only through
 * a gateway webhook or a server-to-server verify — never because the browser came back to a success URL.
 * Success is announced with the generic event PaymentSucceeded { subjectType, subjectId }.
 */
@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly log = new Logger('Payments');

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
    private readonly calls: CallLogService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  onModuleInit() {
    this.bus.subscribe('PaymentVerifyRequested', 'payments.verify', (e) => this.runVerify(e));
    this.bus.subscribe('PaymentRefundRequested', 'payments.refund', (e) => this.runRefund(e));
  }

  async createPayment(
    input: { amountPaise: number; payer: { name: string; email?: string; mobile?: string }; subjectType: string; subjectId: string; returnUrl: string; productInfo: string },
    db: Db = this.prisma,
  ) {
    if (input.amountPaise <= 0) throw Problem.badRequest('Amount must be positive');
    return db.payment.create({
      data: {
        tenantId: requestContext.tenantId(),
        txnId: `TXN${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`,
        provider: this.provider.name,
        amountPaise: input.amountPaise,
        productInfo: input.productInfo,
        payer: input.payer as Prisma.InputJsonValue,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        returnUrl: input.returnUrl,
      },
    });
  }

  /** Builds the signed hosted-checkout form the browser posts to the gateway. */
  async checkout(paymentId: string, opts: { returnUrl?: string } = {}) {
    let p = await this.get(paymentId);
    if (p.status === 'SUCCESS') throw Problem.conflict('Already paid', 'already-paid');
    if (opts.returnUrl && opts.returnUrl !== p.returnUrl) p = await this.prisma.payment.update({ where: { id: p.id }, data: { returnUrl: opts.returnUrl } });
    const payer = p.payer as { name: string; email?: string; mobile?: string };
    const form = this.provider.createCheckout({
      txnId: p.txnId,
      amountPaise: p.amountPaise,
      productInfo: p.productInfo,
      payer,
      successUrl: `${env.publicApiUrl}/api/v1/payments/return/${this.provider.name}`,
      failureUrl: `${env.publicApiUrl}/api/v1/payments/return/${this.provider.name}`,
    });
    await this.prisma.payment.update({ where: { id: p.id }, data: { status: 'PENDING' } });
    await this.logEvent(p.id, p.txnId, 'CHECKOUT', { action: form.action, txnid: p.txnId, amount: form.fields.amount });
    return { paymentId: p.id, ...form };
  }

  /** Server-to-server notification from the gateway. The only callback that can mark a payment paid. */
  async handleWebhook(body: Record<string, string>) {
    const cb = this.provider.parseCallback(body);
    const p = await this.prisma.payment.findUnique({ where: { txnId: cb.txnId } });
    await this.logEvent(p?.id, cb.txnId, 'WEBHOOK', body, cb.hashValid, cb.status);
    if (!p) throw Problem.notFound('Payment');
    if (!cb.hashValid) throw Problem.badRequest('Hash mismatch', 'bad-hash');
    if (cb.amountPaise !== undefined && cb.amountPaise !== p.amountPaise) throw Problem.badRequest('Amount mismatch', 'amount-mismatch');
    await requestContext.runAsSystem(p.tenantId, () => this.applyStatus(p.id, cb.status, cb.providerRef));
    return { ok: true };
  }

  /** Browser return from the gateway: logged, then a verify is queued. Returns where to send the browser. */
  async handleReturn(body: Record<string, string>) {
    const cb = this.provider.parseCallback(body);
    const p = await this.prisma.payment.findUnique({ where: { txnId: cb.txnId } });
    await this.logEvent(p?.id, cb.txnId, 'RETURN', body, cb.hashValid, cb.status);
    if (!p) throw Problem.notFound('Payment');
    await requestContext.runAsSystem(p.tenantId, () => this.requestVerify(p.id));
    const sep = p.returnUrl.includes('?') ? '&' : '?';
    return `${p.returnUrl}${sep}paymentId=${p.id}&result=${cb.status.toLowerCase()}`;
  }

  /** Queues a server-to-server status check (runs from the outbox). */
  async requestVerify(paymentId: string) {
    const p = await this.get(paymentId);
    await this.prisma.tx((tx) => this.bus.publish(tx, { type: 'PaymentVerifyRequested', subjectType: 'payment', subjectId: p.id, payload: { paymentId: p.id } }));
    return { status: p.status, queued: true };
  }

  async requestRefund(paymentId: string, amountPaise: number, reason: string, db?: Db) {
    const run = async (tx: Db) => {
      const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (p.status !== 'SUCCESS') throw Problem.conflict(`Payment is ${p.status}; only successful payments can be refunded`);
      if (amountPaise <= 0 || p.refundedPaise + amountPaise > p.amountPaise) throw Problem.badRequest('Refund amount exceeds the paid amount');
      const r = await tx.paymentRefund.create({ data: { tenantId: p.tenantId, paymentId, amountPaise, status: 'PENDING', reason } });
      await this.bus.publish(tx, { type: 'PaymentRefundRequested', subjectType: 'payment', subjectId: p.id, payload: { refundId: r.id } });
      return r;
    };
    return db ? run(db) : this.prisma.tx(run);
  }

  /** Reconciliation: re-verify payments stuck in PENDING for more than two minutes. */
  async reconcile() {
    const stuck = await this.prisma.payment.findMany({ where: { status: 'PENDING', updatedAt: { lt: new Date(Date.now() - 120_000) } }, take: 50 });
    for (const p of stuck) await requestContext.runAsSystem(p.tenantId, () => this.requestVerify(p.id));
    return stuck.length;
  }

  async get(paymentId: string) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw Problem.notFound('Payment');
    return p;
  }

  forSubject(subjectType: string, subjectId: string) {
    return this.prisma.payment.findMany({ where: { tenantId: requestContext.tenantId(), subjectType, subjectId }, orderBy: { createdAt: 'desc' } });
  }

  // ---------------------------------------------------------------------------

  private async runVerify(e: DeliveredEvent) {
    const p = await this.prisma.payment.findUnique({ where: { id: String(e.payload.paymentId) } });
    if (!p) throw new NonRetryableError('Payment not found');
    if (p.status === 'SUCCESS' || p.status === 'REFUNDED') return;
    const res = await this.calls.track(
      { system: 'PAYMENT', operation: 'verify', subjectType: 'payment', subjectId: p.id, request: { txnId: p.txnId } },
      () => this.provider.verify(p.txnId),
    );
    await this.logEvent(p.id, p.txnId, 'VERIFY', res as unknown as Record<string, unknown>, true, res.status);
    if (res.amountPaise !== undefined && res.amountPaise !== p.amountPaise) throw new NonRetryableError('Amount mismatch on verify');
    await this.applyStatus(p.id, res.status, res.providerRef, true);
  }

  private async runRefund(e: DeliveredEvent) {
    const r = await this.prisma.paymentRefund.findUnique({ where: { id: String(e.payload.refundId) } });
    if (!r) throw new NonRetryableError('Refund not found');
    if (r.status === 'SUCCESS') return;
    const p = await this.prisma.payment.findUniqueOrThrow({ where: { id: r.paymentId } });
    const res = await this.calls.track(
      { system: 'PAYMENT', operation: 'refund', subjectType: 'payment', subjectId: p.id, request: { txnId: p.txnId, amountPaise: r.amountPaise } },
      () => this.provider.refund(p.txnId, r.amountPaise, r.id),
    );
    if (res.status === 'FAILED') throw new Error('Gateway refused the refund');
    await this.prisma.tx(async (tx) => {
      await tx.paymentRefund.update({ where: { id: r.id }, data: { status: res.status, providerRef: res.providerRef } });
      const refunded = p.refundedPaise + r.amountPaise;
      await tx.payment.update({ where: { id: p.id }, data: { refundedPaise: refunded, status: refunded >= p.amountPaise ? 'REFUNDED' : p.status } });
      await this.bus.publish(tx, { type: 'PaymentRefunded', subjectType: p.subjectType, subjectId: p.subjectId, payload: { paymentId: p.id, amountPaise: r.amountPaise } });
    });
  }

  private async applyStatus(paymentId: string, status: ProviderStatus, providerRef?: string, fromVerify = false) {
    await this.prisma.tx(async (tx) => {
      const [p] = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM util_pay_payment WHERE id = ${paymentId} FOR UPDATE`;
      const current = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (fromVerify) await tx.payment.update({ where: { id: paymentId }, data: { lastVerifiedAt: new Date() } });
      if (p.status === 'SUCCESS' || p.status === 'REFUNDED') return;
      if (status === 'PENDING') return;
      if (status === 'SUCCESS') {
        await tx.payment.update({ where: { id: paymentId }, data: { status: 'SUCCESS', providerRef, succeededAt: new Date() } });
        await this.bus.publish(tx, {
          type: 'PaymentSucceeded',
          subjectType: current.subjectType,
          subjectId: current.subjectId,
          payload: { paymentId, amountPaise: current.amountPaise, subjectType: current.subjectType, subjectId: current.subjectId },
        });
      } else {
        await tx.payment.update({ where: { id: paymentId }, data: { status, providerRef } });
        await this.bus.publish(tx, {
          type: 'PaymentFailed',
          subjectType: current.subjectType,
          subjectId: current.subjectId,
          payload: { paymentId, status, subjectType: current.subjectType, subjectId: current.subjectId },
        });
      }
    });
    this.log.log(`Payment ${paymentId} → ${status}`);
  }

  private async logEvent(paymentId: string | undefined, txnId: string | undefined, kind: string, payload: Record<string, unknown>, hashValid?: boolean, resultStatus?: string) {
    await this.prisma.paymentEvent.create({
      data: { tenantId: requestContext.tenantId(), paymentId, txnId, kind, payload: payload as Prisma.InputJsonValue, hashValid, resultStatus },
    });
  }
}
