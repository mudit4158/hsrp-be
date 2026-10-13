import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Oem } from '@prisma/client';
import { env } from '../../platform/config/env';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { NonRetryableError, Problem } from '../../platform/http/problem';
import { AuditService } from '../../utility/audit/audit.service';
import { SettingsService } from '../../utility/configuration/settings.service';
import { DocumentsService } from '../../utility/documents/documents.service';
import { FileService } from '../../utility/file-storage/file.service';
import { DeliveredEvent, EventBus } from '../../utility/integration-hub/event-bus.service';
import { NotificationService } from '../../utility/notification/notification.service';
import { MastersService } from '../masters/masters.service';
import { OrderService } from '../order-intake/order.service';
import { istDate, SUBJECT } from '../shared/subjects';
import { BillingCycle, BillTo, cycleBoundary, pairScope, PaymentMode, periodLabel, previousBoundary, resolveBillTo } from './billing-rules';

const rupees = (p: number) => (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10).split('-').reverse().join('-');

/**
 * Postpaid billing (D46). Prepaid OEMs keep using wallets (order-intake holds and captures). For a postpaid OEM the
 * order is confirmed without a hold; this module turns it into a charge, makes the charge billable when the plates
 * are dispatched, and at each cycle close (weekly or monthly, per OEM) bills every party — the OEM or the dealer, set
 * per OEM × dealer — for its dispatched orders, with a PDF sent by e-mail.
 */
@Injectable()
export class BillingService implements OnModuleInit {
  private readonly log = new Logger('Billing');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly masters: MastersService,
    private readonly orders: OrderService,
    private readonly docs: DocumentsService,
    private readonly files: FileService,
    private readonly notify: NotificationService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
  ) {}

  onModuleInit() {
    this.bus.subscribe('OrderStatusChanged', 'billing.charges', (e) => this.onOrderStatus(e));
  }

  // ------------------------------------------------------------------ configuration (settings, effective-dated)

  paymentMode(oemCode: string) {
    return this.settings.getOr<PaymentMode>('billing.paymentMode', 'PREPAID', [{ type: 'oem', id: oemCode }]);
  }

  cycle(oemCode: string) {
    return this.settings.getOr<BillingCycle>('billing.cycle', 'MONTHLY', [{ type: 'oem', id: oemCode }]);
  }

  async billTo(oemCode: string, dealerCode: string | null): Promise<BillTo> {
    const pair = dealerCode ? await this.settings.get<string>('billing.billTo', [pairScope(oemCode, dealerCode)]) : undefined;
    // `get` falls back to global; read the OEM default on its own so a pair without a setting inherits it.
    const oemDefault = await this.settings.get<string>('billing.billTo', [{ type: 'oem', id: oemCode }]);
    return resolveBillTo(pair, oemDefault, Boolean(dealerCode));
  }

  /** Everything the Billing → Setup screen shows: per OEM its mode, cycle and contact; per OEM × dealer the bill-to. */
  async setup() {
    const oems = await this.masters.oems();
    return Promise.all(
      oems.map(async (o) => ({
        oemCode: o.code,
        oemName: o.name,
        paymentMode: await this.paymentMode(o.code),
        cycle: await this.cycle(o.code),
        billToDefault: await this.billTo(o.code, null),
        contactEmail: await this.settings.getOr<string>('billing.contactEmail', '', [{ type: 'oem', id: o.code }]),
        dealers: await Promise.all(
          (await this.masters.dealersForOem(o.id)).map(async (d) => ({ dealerCode: d.code, dealerName: d.name, billTo: await this.billTo(o.code, d.code), email: d.email })),
        ),
      })),
    );
  }

  async configureOem(oemCode: string, input: { paymentMode?: PaymentMode; cycle?: BillingCycle; billToDefault?: BillTo; contactEmail?: string }) {
    const oem = await this.masters.oemByCode(oemCode);
    const scope = { scopeType: 'oem', scopeId: oem.code };
    if (input.paymentMode) await this.settings.set({ key: 'billing.paymentMode', ...scope, value: input.paymentMode });
    if (input.cycle) await this.settings.set({ key: 'billing.cycle', ...scope, value: input.cycle });
    if (input.billToDefault) await this.settings.set({ key: 'billing.billTo', ...scope, value: input.billToDefault });
    if (input.contactEmail !== undefined) await this.settings.set({ key: 'billing.contactEmail', ...scope, value: input.contactEmail });
    return (await this.setup()).find((s) => s.oemCode === oem.code);
  }

  async configurePair(oemCode: string, dealerCode: string, billTo: BillTo) {
    const oem = await this.masters.oemByCode(oemCode);
    const dealer = await this.masters.dealerByCode(dealerCode);
    if (!(await this.masters.dealerServesOem(dealer.id, oem.id))) throw Problem.unprocessable(`Dealer ${dealer.code} is not mapped to ${oem.name}`, 'dealer-oem-mapping');
    const s = pairScope(oem.code, dealer.code);
    await this.settings.set({ key: 'billing.billTo', scopeType: s.type, scopeId: s.id, value: billTo });
    return { oemCode: oem.code, dealerCode: dealer.code, billTo };
  }

  // ------------------------------------------------------------------ charges (outbox subscriber)

  private async onOrderStatus(e: DeliveredEvent) {
    const status = String(e.payload.status);
    if (!['CONFIRMED', 'DISPATCHED', 'CANCELLED', 'REJECTED'].includes(status)) return;
    const order = await this.orders.get(String(e.payload.orderId));
    const charge = await this.prisma.billingCharge.findUnique({ where: { orderId: order.id } });
    if (status === 'CONFIRMED') {
      // Postpaid orders are confirmed without a wallet hold or gateway payment (order-flow checks the same setting).
      if (charge || !order.oemId || order.walletHoldId || order.paymentId) return;
      const oem = await this.masters.oem(order.oemId);
      if (!oem || (await this.paymentMode(oem.code)) !== 'POSTPAID') return;
      const dealer = order.dealerId ? await this.masters.dealer(order.dealerId) : null;
      const billTo = await this.billTo(oem.code, dealer?.code ?? null);
      await this.prisma.billingCharge.create({
        data: {
          tenantId: order.tenantId,
          orderId: order.id,
          orderNo: order.orderNo,
          regnNo: order.regnNo,
          oemId: oem.id,
          dealerId: dealer?.id,
          billToType: billTo,
          billToId: billTo === 'DEALER' ? dealer!.id : oem.id,
          billToName: billTo === 'DEALER' ? `${dealer!.code} · ${dealer!.name}` : `${oem.code} · ${oem.name}`,
          amountPaise: order.amountPaise ?? 0,
          confirmedAt: order.confirmedAt ?? new Date(),
        },
      });
      return;
    }
    if (!charge) return;
    if (status === 'DISPATCHED' && charge.status === 'PENDING') {
      await this.prisma.billingCharge.update({ where: { id: charge.id }, data: { status: 'BILLABLE', dispatchedAt: new Date() } });
    } else if ((status === 'CANCELLED' || status === 'REJECTED') && ['PENDING', 'BILLABLE'].includes(charge.status)) {
      await this.prisma.billingCharge.update({ where: { id: charge.id }, data: { status: 'VOID', voidReason: `Order ${status.toLowerCase()}` } });
    }
  }

  charges(filter: { status?: string; oemCode?: string }) {
    return (async () => {
      const oemId = filter.oemCode ? (await this.masters.oemByCode(filter.oemCode)).id : undefined;
      return this.prisma.billingCharge.findMany({
        where: { tenantId: requestContext.tenantId(), ...(filter.status ? { status: { in: filter.status.split(',') } } : {}), ...(oemId ? { oemId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
    })();
  }

  forOrder(orderId: string) {
    return (async () => {
      const charge = await this.prisma.billingCharge.findUnique({ where: { orderId } });
      const bill = charge?.billId ? await this.prisma.bill.findUnique({ where: { id: charge.billId } }) : null;
      return charge ? { charge, bill: bill && { id: bill.id, billNo: bill.billNo, status: bill.status, periodFrom: bill.periodFrom, periodTo: bill.periodTo } } : null;
    })();
  }

  // ------------------------------------------------------------------ bills

  /**
   * Bills every billable charge of the OEM dispatched before `periodTo`, one bill per bill-to party, then sends each.
   * `trigger` is "cycle" for the scheduled close (idempotent per period end) or "manual" for Run billing now.
   */
  async run(oemCode: string, opts: { trigger: 'cycle' | 'manual'; periodTo?: Date }) {
    const oem = await this.masters.oemByCode(oemCode);
    if ((await this.paymentMode(oem.code)) !== 'POSTPAID') throw Problem.unprocessable(`${oem.name} is prepaid; only postpaid OEMs are billed`, 'not-postpaid');
    const cycle = await this.cycle(oem.code);
    const tenantId = requestContext.tenantId();
    const periodTo = opts.periodTo ?? new Date();
    const last = await this.prisma.billingRun.findFirst({ where: { tenantId, oemId: oem.id, periodTo: { lte: periodTo } }, orderBy: { periodTo: 'desc' } });
    if (opts.trigger === 'cycle' && last && last.periodTo.getTime() === periodTo.getTime()) return { run: last, bills: [] };
    const charges = await this.prisma.billingCharge.findMany({
      where: { tenantId, oemId: oem.id, status: 'BILLABLE', dispatchedAt: { lt: periodTo } },
      orderBy: { dispatchedAt: 'asc' },
    });
    const periodFrom = last?.periodTo ?? charges[0]?.dispatchedAt ?? previousBoundary(cycle, cycleBoundary(cycle, periodTo));
    const groups = new Map<string, typeof charges>();
    for (const c of charges) groups.set(`${c.billToType}:${c.billToId}`, [...(groups.get(`${c.billToType}:${c.billToId}`) ?? []), c]);

    const created = await this.prisma.tx(async (tx) => {
      const bills = [];
      for (const lines of groups.values()) {
        const first = lines[0];
        const bill = await tx.bill.create({
          data: {
            tenantId,
            billNo: await this.docs.nextNumber('bill', tx),
            oemId: oem.id,
            billToType: first.billToType,
            billToId: first.billToId,
            billToName: first.billToName,
            cycle,
            periodFrom,
            periodTo,
            amountPaise: lines.reduce((n, l) => n + l.amountPaise, 0),
            lineCount: lines.length,
            createdBy: requestContext.actorId(),
          },
        });
        await tx.billingCharge.updateMany({ where: { id: { in: lines.map((l) => l.id) } }, data: { status: 'BILLED', billId: bill.id } });
        bills.push(bill);
      }
      const run = await tx.billingRun.create({ data: { tenantId, oemId: oem.id, cycle, trigger: opts.trigger, periodFrom, periodTo, billCount: bills.length } });
      await this.audit.record({ action: 'billing.run', subjectType: SUBJECT.oem, subjectId: oem.id, after: { trigger: opts.trigger, periodTo, bills: bills.map((b) => b.billNo) } }, tx);
      return { run, bills };
    });
    // PDF and e-mail after the commit: a failure here leaves the bill ISSUED, and "Send again" retries it.
    for (const b of created.bills) await this.send(b.id).catch((err) => this.log.warn(`Bill ${b.billNo} not sent: ${(err as Error).message}`));
    this.log.log(`${oem.code}: ${created.bills.length} bill(s) for ${charges.length} order(s), ${opts.trigger}`);
    return { run: created.run, bills: await this.prisma.bill.findMany({ where: { id: { in: created.bills.map((b) => b.id) } } }) };
  }

  /** Scheduled job: closes the cycle of every postpaid OEM once its boundary has passed. */
  async closeDueCycles(now = new Date()) {
    const out = [];
    for (const oem of await this.masters.oems()) {
      if ((await this.paymentMode(oem.code)) !== 'POSTPAID') continue;
      const boundary = cycleBoundary(await this.cycle(oem.code), now);
      const done = await this.prisma.billingRun.findFirst({ where: { tenantId: requestContext.tenantId(), oemId: oem.id, periodTo: { gte: boundary } } });
      if (!done) out.push(await this.run(oem.code, { trigger: 'cycle', periodTo: boundary }));
    }
    return out;
  }

  async bills(filter: { oemCode?: string; status?: string }) {
    const oemId = filter.oemCode ? (await this.masters.oemByCode(filter.oemCode)).id : undefined;
    const bills = await this.prisma.bill.findMany({
      where: { tenantId: requestContext.tenantId(), ...(oemId ? { oemId } : {}), ...(filter.status ? { status: filter.status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const oems = await this.masters.oems();
    return bills.map((b) => ({ ...b, oemCode: oems.find((o) => o.id === b.oemId)?.code, period: periodLabel(b.periodFrom, b.periodTo) }));
  }

  async bill(id: string) {
    const bill = await this.prisma.bill.findFirst({ where: { id, tenantId: requestContext.tenantId() } });
    if (!bill) throw Problem.notFound('Bill');
    const lines = await this.prisma.billingCharge.findMany({ where: { billId: id }, orderBy: { dispatchedAt: 'asc' } });
    return { ...bill, period: periodLabel(bill.periodFrom, bill.periodTo), lines };
  }

  async pdf(id: string) {
    const b = await this.bill(id);
    if (b.fileId) return { filename: `${b.billNo}.pdf`, pdf: (await this.files.read(b.fileId)).data };
    return { filename: `${b.billNo}.pdf`, pdf: await this.render(b) };
  }

  private async render(b: Awaited<ReturnType<BillingService['bill']>>) {
    const oem = (await this.masters.oem(b.oemId)) as Oem;
    return this.docs.render('bill', {
      bill: { billNo: b.billNo, date: istDate(b.createdAt), period: b.period, cycle: b.cycle.toLowerCase(), amount: rupees(b.amountPaise), lineCount: b.lineCount, billTo: b.billToName, billToType: b.billToType === 'OEM' ? 'OEM' : 'Dealer' },
      oem: { code: oem.code, name: oem.name },
      lines: b.lines.map((l, i) => ({ rowNo: i + 1, orderNo: l.orderNo, regnNo: l.regnNo, dispatched: l.dispatchedAt ? istDay(l.dispatchedAt) : '', amount: rupees(l.amountPaise) })),
    });
  }

  /** Renders the PDF (once), e-mails it to the bill-to party's billing contact and marks the bill SENT. */
  async send(id: string) {
    const b = await this.bill(id);
    let fileId = b.fileId;
    if (!fileId) {
      const pdf = await this.render(b);
      fileId = (await this.files.upload({ data: pdf, filename: `${b.billNo}.pdf`, mimeType: 'application/pdf', purpose: 'bill', ownerSubjectType: SUBJECT.oem, ownerSubjectId: b.oemId, retentionDays: 3650 })).id;
      await this.prisma.bill.update({ where: { id }, data: { fileId } });
    }
    const oem = (await this.masters.oem(b.oemId)) as Oem;
    const to =
      b.billToType === 'DEALER'
        ? ((await this.masters.dealer(b.billToId)).email ?? (await this.settings.getOr<string>('billing.contactEmail', '', [{ type: 'oem', id: oem.code }])))
        : await this.settings.getOr<string>('billing.contactEmail', '', [{ type: 'oem', id: oem.code }]);
    if (!to) throw new NonRetryableError(`No billing e-mail for ${b.billToName}`);
    await this.notify.send({
      templateCode: 'BILL_ISSUED',
      channel: 'EMAIL',
      recipient: to,
      variables: { billNo: b.billNo, billTo: b.billToName, oem: oem.name, period: b.period, count: b.lineCount, amount: rupees(b.amountPaise), link: `${env.publicWebUrl}/billing?bill=${b.billNo}` },
      subjectType: 'hsrp.bill',
      subjectId: b.id,
    });
    return this.prisma.bill.update({ where: { id }, data: { status: b.status === 'PAID' ? 'PAID' : 'SENT', sentTo: to, sentAt: new Date() } });
  }

  async markPaid(id: string) {
    const b = await this.bill(id);
    const updated = await this.prisma.bill.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } });
    await this.audit.record({ action: 'billing.paid', subjectType: 'hsrp.bill', subjectId: id, before: { status: b.status }, after: { status: 'PAID' } });
    return updated;
  }
}
