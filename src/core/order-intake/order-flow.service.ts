import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Order } from '@prisma/client';
import { env } from '../../platform/config/env';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService, Tx } from '../../platform/database/prisma.service';
import { NonRetryableError, Problem } from '../../platform/http/problem';
import { ApprovalsService } from '../../utility/approvals/approvals.service';
import { SettingsService } from '../../utility/configuration/settings.service';
import { CallLogService } from '../../utility/integration-hub/call-log.service';
import { DeliveredEvent, EventBus } from '../../utility/integration-hub/event-bus.service';
import { NotificationService } from '../../utility/notification/notification.service';
import { PaymentsService } from '../../utility/payments/payments.service';
import { WalletService } from '../../utility/wallet/wallet.service';
import { MastersService } from '../masters/masters.service';
import { OEM_VEHICLE_CATALOG, OemVehicleCatalog, ORDER_SOURCE, OrderSource } from '../ports/oem.port';
import { VahanLookupReply, VEHICLE_REGISTRY, VehicleRegistry } from '../ports/vehicle-registry.port';
import { PricingService } from '../pricing/pricing.module';
import { APPROVAL, SUBJECT } from '../shared/subjects';
import { routeAfterApproval, routeAfterValidation } from './order-state-machine';
import { OemVehicleDataService } from './oem-vehicle-data.service';
import { OrderService } from './order.service';
import { judgeOemVehicle, judgeStateRules, judgeVahanReply, StateRules, StepResult } from './validation-steps';

const DEFAULT_STEPS = ['vahan-check', 'state-eligibility-rules'];

/**
 * Drives an order from RECEIVED to CONFIRMED: the validation chain (outbox subscriber), wallet hold and
 * capture, replacement approval, customer payment, and the money side of rejection and cancellation.
 */
@Injectable()
export class OrderFlowService implements OnModuleInit {
  private readonly log = new Logger('OrderFlow');

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
    private readonly masters: MastersService,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
    private readonly wallets: WalletService,
    private readonly payments: PaymentsService,
    private readonly approvals: ApprovalsService,
    private readonly notify: NotificationService,
    private readonly calls: CallLogService,
    private readonly bus: EventBus,
    private readonly oemData: OemVehicleDataService,
    @Inject(VEHICLE_REGISTRY) private readonly vahan: VehicleRegistry,
    @Inject(OEM_VEHICLE_CATALOG) private readonly catalog: OemVehicleCatalog,
    @Inject(ORDER_SOURCE) private readonly orderSource: OrderSource,
  ) {}

  onModuleInit() {
    this.bus.subscribe('OrderReceived', 'orders.validate', (e) => this.validate(String(e.payload.orderId)), { maxAttempts: 10 });
    this.bus.subscribe('PaymentSucceeded', 'orders.payment-succeeded', (e) => this.onPaymentSucceeded(e));
    this.bus.subscribe('ApprovalDecided', 'orders.replacement-decided', (e) => this.onApprovalDecided(e));
    this.bus.subscribe('OrderRejected', 'orders.settle-money', (e) => this.settleMoney(String(e.payload.orderId)));
    this.bus.subscribe('OrderCancelled', 'orders.settle-money', (e) => this.settleMoney(String(e.payload.orderId)));
    this.bus.subscribe('OrderStatusChanged', 'orders.notify-customer', (e) => this.notifyCustomer(e));
    this.bus.subscribe('OrderStatusChanged', 'orders.oem-callback', (e) => this.oemCallback(e));
  }

  // ------------------------------------------------------------------ validation chain

  async validate(orderId: string) {
    const order = await this.orders.get(orderId);
    if (order.status !== 'RECEIVED') return;
    const state = await this.masters.state(order.stateCode);
    const oem = order.oemId ? await this.masters.oem(order.oemId) : null;
    const dealer = order.dealerId ? await this.masters.dealer(order.dealerId) : null;
    const scopes = [...(dealer ? [{ type: 'dealer', id: dealer.code }] : []), ...(oem ? [{ type: 'oem', id: oem.code }] : []), { type: 'state', id: state.code }];
    const steps = await this.settings.getOr<string[]>('order.validationSteps', DEFAULT_STEPS, scopes);
    const rules = await this.settings.getOr<StateRules>('state.rules', {}, [{ type: 'state', id: state.code }]);
    const cutoff = new Date(await this.settings.getOr<string>('order.newVehicleCutoff', '2019-04-01'));

    const results: Array<{ step: string; res: StepResult }> = [];
    let reply: VahanLookupReply | undefined;
    let category = null as Awaited<ReturnType<MastersService['vehicleCategory']>>;
    for (const step of steps) {
      let res: StepResult;
      if (step === 'oem-catalogue-check') {
        if (!oem) res = { ok: true, message: 'Not an OEM order' };
        else {
          const hit = await this.calls.track(
            { system: 'OEM', operation: 'catalogue-check', subjectType: SUBJECT.order, subjectId: order.id, request: { oem: oem.code, chassisNo: order.chassisNo } },
            () => this.catalog.check(oem.code, order.chassisNo),
          );
          res = hit.found ? { ok: true, message: `Catalogue model ${hit.model}` } : { ok: false, reason: `Chassis ${order.chassisNo} is not in ${oem.name}'s catalogue` };
        }
      } else if (step === 'oem-vehicle-data') {
        const record = order.orderType === 'NEW' ? await this.oemData.facts(order.chassisNo, order.oemId) : null;
        res = judgeOemVehicle(order, record, { oemName: oem?.name, orderDealerCode: dealer?.code });
      } else if (step === 'vahan-check') {
        const req = { regnNO: order.regnNo, chasisNo: order.chassisNo.slice(-5), engineNo: order.engineNo.slice(-5), userId: await this.settings.getOr('vahan.userId', 'HSRPDEMO') };
        // RegistryUnavailableError propagates: the outbox retries this delivery with back-off.
        reply = await this.calls.track({ system: 'VAHAN', operation: 'lookup', subjectType: SUBJECT.order, subjectId: order.id, request: req }, () => this.vahan.lookup(req));
        category = reply.vchCatg ? await this.masters.vehicleCategory(reply.vchCatg) : null;
        res = judgeVahanReply(order, reply, cutoff, category);
        res.data = reply;
      } else if (step === 'state-eligibility-rules') {
        res = judgeStateRules(order, rules, { vehicleClass: category?.vehicleClass, offCd: reply?.offCd });
      } else {
        res = { ok: false, reason: `Unknown validation step ${step}` };
      }
      results.push({ step, res });
      if (!res.ok) break;
    }

    const failed = results.find((r) => !r.res.ok);
    await this.prisma.tx(async (tx) => {
      for (const r of results) await this.orders.saveValidation(tx, order.id, r.step, r.res.ok ? 'PASS' : 'FAIL', r.res.ok ? r.res.message : r.res.reason, r.res.data);
      if (failed && !failed.res.ok) {
        await this.orders.transition(tx, order.id, 'REJECTED', `validation:${failed.step}`, { rejectionReason: failed.res.reason }, failed.res.reason);
        return;
      }
      const patch = this.vehiclePatch(reply, category);
      if (!patch.vehicleClass) {
        await this.orders.transition(tx, order.id, 'REJECTED', 'validation:vehicle-class', { rejectionReason: 'Vehicle class unknown: enable the vahan-check step for this OEM/state' }, 'Vehicle class unknown');
        return;
      }
      let quote;
      try {
        quote = await this.pricing.quote(
          { stateCode: order.stateCode, vehicleClass: patch.vehicleClass, vehicleType: patch.vehicleType, oemCode: oem?.code, orderType: order.orderType, plateSet: order.plateSet, at: new Date() },
          { greenStrip: patch.greenStrip, channel: order.channel },
          tx,
        );
      } catch (e) {
        if (e instanceof Problem) {
          await this.orders.saveValidation(tx, order.id, 'pricing', 'FAIL', e.detail);
          await this.orders.transition(tx, order.id, 'REJECTED', 'validation:pricing', { rejectionReason: e.detail }, e.detail);
          return;
        }
        throw e;
      }
      await this.orders.saveValidation(tx, order.id, 'pricing', 'PASS', `₹${(quote.totalPaise / 100).toFixed(2)}`, quote);
      const validated = await this.orders.transition(tx, order.id, 'VALIDATED', 'validation-passed', { ...patch, amountPaise: quote.totalPaise });
      await this.route(tx, validated);
    });
  }

  private vehiclePatch(reply: VahanLookupReply | undefined, category: { vehicleClass: string; vehicleType: string; frontProductCode: string; rearProductCode: string; stickerRequired: boolean; vahanCategory: string } | null) {
    return {
      vehicleClass: category?.vehicleClass,
      vehicleType: category?.vehicleType,
      vahanCategory: category?.vahanCategory,
      frontProductCode: category?.frontProductCode,
      rearProductCode: category?.rearProductCode,
      stickerRequired: category?.stickerRequired ?? false,
      fuel: reply?.fuel,
      maker: reply?.maker,
      norms: reply?.norms,
      regnDate: reply?.regnDate,
      greenStrip: /VI/i.test(reply?.norms ?? ''),
    };
  }

  /** After VALIDATED: approval, payment or wallet. */
  private async route(tx: Tx, order: Order) {
    const next = routeAfterValidation(order);
    // Postpaid OEMs (D46) are billed per cycle by the billing module: no wallet hold.
    const postpaid = await this.isPostpaid(order);
    if (order.channel !== 'CUSTOMER_PORTAL' && !postpaid) {
      const held = await this.holdWallet(tx, order);
      if (!held) return; // stays VALIDATED until the wallet has funds; retried by a scheduled job
    }
    if (next === 'AWAITING_APPROVAL') {
      const appr = await this.approvals.request(
        {
          type: APPROVAL.replacementOrder,
          subjectType: SUBJECT.order,
          subjectId: order.id,
          requiredRole: 'OPERATIONS',
          title: `Replacement ${order.orderNo} · ${order.regnNo} · ${order.replacementReason}`,
          details: { orderNo: order.orderNo, regnNo: order.regnNo, reason: order.replacementReason, evidenceFileId: order.evidenceFileId, plateSet: order.plateSet },
        },
        tx,
      );
      await this.orders.transition(tx, order.id, 'AWAITING_APPROVAL', 'replacement-needs-approval', { approvalId: appr.id });
    } else if (next === 'AWAITING_PAYMENT') {
      await this.awaitPayment(tx, order);
    } else {
      await this.confirm(tx, order.id, postpaid ? 'postpaid' : 'wallet-captured');
    }
  }

  /** The OEM's payment mode (setting billing.paymentMode, scope oem); orders without an OEM are prepaid. */
  private async isPostpaid(order: Order) {
    if (!order.oemId || order.channel === 'CUSTOMER_PORTAL') return false;
    const oem = await this.masters.oem(order.oemId);
    return Boolean(oem) && (await this.settings.getOr<string>('billing.paymentMode', 'PREPAID', [{ type: 'oem', id: oem!.code }])) === 'POSTPAID';
  }

  private async awaitPayment(tx: Tx, order: Order) {
    const p = await this.payments.createPayment(
      {
        amountPaise: order.amountPaise ?? 0,
        payer: { name: order.ownerName ?? 'Customer', email: order.email ?? undefined, mobile: order.mobile ?? undefined },
        subjectType: SUBJECT.order,
        subjectId: order.id,
        returnUrl: `${env.publicWebUrl}/portal/payment-return?orderId=${order.id}`,
        productInfo: `HSRP ${order.orderNo}`,
      },
      tx,
    );
    await this.orders.transition(tx, order.id, 'AWAITING_PAYMENT', 'awaiting-payment', { paymentId: p.id });
  }

  /** Who pays: OEM orders draw on the OEM's wallet (with credit), others on the dealer's (possibly shared) wallet. */
  private async payerWallet(order: Order) {
    if (order.oemId && (order.channel === 'OEM_API' || order.channel === 'OEM_FILE')) {
      const oem = await this.masters.oem(order.oemId);
      return oem?.walletAccountId ?? null;
    }
    if (order.dealerId) return (await this.masters.dealer(order.dealerId)).walletAccountId;
    return null;
  }

  private async holdWallet(tx: Tx, order: Order): Promise<boolean> {
    if (order.walletHoldId) return true;
    const walletId = await this.payerWallet(order);
    if (!walletId) throw new NonRetryableError(`Order ${order.orderNo} has no wallet to charge`);
    try {
      const hold = await this.wallets.hold(walletId, order.amountPaise ?? 0, { subjectType: SUBJECT.order, subjectId: order.id }, tx);
      await this.orders.update(tx, order.id, { walletHoldId: hold.id, remarks: null });
      order.walletHoldId = hold.id;
      return true;
    } catch (e) {
      if (e instanceof Problem && e.status === 402) {
        await this.orders.update(tx, order.id, { remarks: `Waiting for wallet funds: ${e.detail}` });
        return false;
      }
      throw e;
    }
  }

  /** CONFIRMED: capture any wallet hold and copy the VAHAN reply and price onto the order (snapshots). */
  async confirm(tx: Tx, orderId: string, trigger: string) {
    const order = await this.orders.get(orderId, tx);
    if (order.walletHoldId) await this.wallets.capture(order.walletHoldId, tx);
    const validations = await tx.orderValidation.findMany({ where: { orderId }, orderBy: { createdAt: 'desc' } });
    const vahan = validations.find((v) => v.step === 'vahan-check' && v.outcome === 'PASS')?.data ?? undefined;
    const price = validations.find((v) => v.step === 'pricing' && v.outcome === 'PASS')?.data ?? undefined;
    return this.orders.transition(tx, orderId, 'CONFIRMED', trigger, {
      confirmedAt: new Date(),
      vahanSnapshot: vahan as never,
      priceSnapshot: price as never,
    });
  }

  /** Retries VALIDATED dealer/OEM orders that were waiting for wallet funds. */
  async retryAwaitingFunds(orderId?: string) {
    const waiting = await this.orders.find({ status: 'VALIDATED', walletHoldId: null, channel: { not: 'CUSTOMER_PORTAL' }, ...(orderId ? { id: orderId } : {}) }, { take: 100 });
    for (const o of waiting) {
      await this.prisma.tx(async (tx) => {
        const fresh = await this.orders.get(o.id, tx);
        if (fresh.status === 'VALIDATED') await this.route(tx, fresh);
      });
    }
    return waiting.length;
  }

  // ------------------------------------------------------------------ event handlers

  private async onPaymentSucceeded(e: DeliveredEvent) {
    if (e.payload.subjectType !== SUBJECT.order) return;
    const order = await this.orders.get(String(e.payload.subjectId));
    if (order.status === 'AWAITING_PAYMENT') {
      await this.prisma.tx(async (tx) => {
        await this.confirm(tx, order.id, 'payment-succeeded');
        if (order.email) {
          await this.notify.send(
            { templateCode: 'PAYMENT_RECEIPT', channel: 'EMAIL', recipient: order.email, variables: { orderNo: order.orderNo, regnNo: order.regnNo, amount: ((order.amountPaise ?? 0) / 100).toFixed(2) }, subjectType: SUBJECT.order, subjectId: order.id },
            tx,
          );
        }
      });
    } else if (order.status === 'CANCELLED') {
      await this.payments.requestRefund(String(e.payload.paymentId), Number(e.payload.amountPaise), 'Order was cancelled before payment completed');
    }
  }

  private async onApprovalDecided(e: DeliveredEvent) {
    if (e.payload.approvalType !== APPROVAL.replacementOrder) return;
    const order = await this.orders.get(String(e.payload.subjectId));
    if (order.status !== 'AWAITING_APPROVAL') return;
    await this.prisma.tx(async (tx) => {
      if (e.payload.decision === 'APPROVED') {
        const next = routeAfterApproval(order);
        if (next === 'AWAITING_PAYMENT') await this.awaitPayment(tx, order);
        else await this.confirm(tx, order.id, 'replacement-approved');
      } else {
        await this.orders.transition(tx, order.id, 'REJECTED', 'replacement-rejected', { rejectionReason: `Replacement rejected: ${e.payload.remarks}` }, String(e.payload.remarks));
      }
    });
  }

  /** On REJECTED or CANCELLED: release a held amount, refund a captured one, refund a gateway payment. */
  private async settleMoney(orderId: string) {
    const order = await this.orders.get(orderId);
    await this.prisma.tx(async (tx) => {
      if (order.walletHoldId) {
        const hold = await this.wallets.getHold(order.walletHoldId, tx);
        if (hold?.status === 'HELD') await this.wallets.release(hold.id, tx);
        else if (hold?.status === 'CAPTURED') await this.wallets.refundCaptured(hold.id, tx);
      }
    });
    if (order.paymentId) {
      const p = await this.payments.get(order.paymentId);
      if (p.status === 'SUCCESS') await this.payments.requestRefund(p.id, p.amountPaise - p.refundedPaise, `Order ${order.status.toLowerCase()}`);
    }
  }

  private async notifyCustomer(e: DeliveredEvent) {
    const order = await this.orders.get(String(e.payload.orderId));
    if (!order.mobile) return;
    const status = String(e.payload.status);
    const rules = await this.settings.getOr<StateRules>('state.rules', {}, [{ type: 'state', id: order.stateCode }]);
    const vars = { orderNo: order.orderNo, regnNo: order.regnNo };
    let send: { templateCode: string; variables: Record<string, string> } | null = null;
    if (status === 'REJECTED') send = { templateCode: 'ORDER_REJECTED', variables: { ...vars, reason: (order.rejectionReason ?? 'see details').slice(0, 80) } };
    else if (status === 'CONFIRMED' && (order.channel === 'CUSTOMER_PORTAL' || rules.smsStatusUpdates)) send = { templateCode: 'ORDER_CONFIRMED', variables: vars };
    else if (rules.smsStatusUpdates && ['DISPATCHED', 'INWARDED', 'CANCELLED'].includes(status)) send = { templateCode: 'ORDER_STATUS', variables: { ...vars, status: status.replace('_', ' ').toLowerCase() } };
    if (send) await this.notify.send({ ...send, channel: 'SMS', recipient: order.mobile, subjectType: SUBJECT.order, subjectId: order.id });
  }

  /** "Reason sent to the source": OEM orders get status callbacks on key changes. */
  private async oemCallback(e: DeliveredEvent) {
    const status = String(e.payload.status);
    if (!['OEM_API', 'OEM_FILE'].includes(String(e.payload.channel))) return;
    if (!['REJECTED', 'CONFIRMED', 'DISPATCHED', 'COMPLETED', 'CANCELLED'].includes(status)) return;
    const order = await this.orders.get(String(e.payload.orderId));
    const oem = order.oemId ? await this.masters.oem(order.oemId) : null;
    if (!oem || !order.sourceRef) return;
    await this.calls.track(
      { system: 'OEM', operation: 'status-callback', subjectType: SUBJECT.order, subjectId: order.id, request: { oem: oem.code, ref: order.sourceRef, status } },
      () => this.orderSource.notifyStatus(oem.code, order.sourceRef!, status, status === 'REJECTED' ? (order.rejectionReason ?? undefined) : undefined),
    );
  }

  /** Cancel before ISSUED; money is settled by the OrderCancelled subscriber. */
  async cancel(orderId: string, reason: string) {
    const order = await this.orders.getScoped(orderId);
    await this.prisma.tx((tx) => this.orders.transition(tx, order.id, 'CANCELLED', 'cancelled', { cancelReason: reason }, reason));
    this.log.log(`Order ${order.orderNo} cancelled by ${requestContext.actorId()}`);
    return this.orders.get(orderId);
  }
}
