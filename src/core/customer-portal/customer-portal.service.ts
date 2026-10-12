import { Injectable, OnModuleInit } from '@nestjs/common';
import type { ComplaintRequest, CustomerOrderRequest, OtpRequest } from '@hsrp/contracts';
import { env } from '../../platform/config/env';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { Problem } from '../../platform/http/problem';
import { DocumentsService } from '../../utility/documents/documents.service';
import { FileService } from '../../utility/file-storage/file.service';
import { IdentityService } from '../../utility/identity/identity.service';
import { OtpService } from '../../utility/identity/otp.service';
import { EventBus } from '../../utility/integration-hub/event-bus.service';
import { NotificationService } from '../../utility/notification/notification.service';
import { PaymentsService } from '../../utility/payments/payments.service';
import { TicketsService } from '../../utility/tickets/tickets.service';
import { BookingService } from '../booking/booking.module';
import { MastersService } from '../masters/masters.service';
import { OrderService } from '../order-intake/order.service';
import { VehicleCheckService } from '../order-intake/vehicle-check.service';
import { istDate, SUBJECT } from '../shared/subjects';

/** Accepts the configured web origin, localhost, or a private-network address (local deployment only). */
export function allowedOrigin(origin?: string): string | null {
  if (!origin) return null;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(u.protocol)) return null;
  const host = u.hostname;
  const ok =
    u.origin === new URL(env.publicWebUrl).origin ||
    ['localhost', '127.0.0.1'].includes(host) ||
    /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host);
  return ok ? u.origin : null;
}

/** Orchestrates the public portal: Apply HSRP, HSRP Status and HSRP Support. */
@Injectable()
export class CustomerPortalService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
    private readonly checks: VehicleCheckService,
    private readonly booking: BookingService,
    private readonly masters: MastersService,
    private readonly otp: OtpService,
    private readonly identity: IdentityService,
    private readonly payments: PaymentsService,
    private readonly tickets: TicketsService,
    private readonly docs: DocumentsService,
    private readonly files: FileService,
    private readonly notify: NotificationService,
    private readonly bus: EventBus,
  ) {}

  onModuleInit() {
    this.bus.subscribe('TicketCreated', 'portal.ticket-created-sms', async (e) => {
      const t = await this.tickets.get(String(e.payload.ticketId));
      if (!/^[6-9]\d{9}$/.test(t.raisedByContact)) return;
      const days = Math.max(1, Math.round((t.dueAt.getTime() - t.createdAt.getTime()) / 86400_000));
      await this.notify.send({ templateCode: 'TICKET_CREATED', channel: 'SMS', recipient: t.raisedByContact, variables: { ticketNo: t.ticketNo, days }, subjectType: 'ticket', subjectId: t.id });
    });
    this.bus.subscribe('TicketUpdated', 'portal.ticket-updated-sms', async (e) => {
      if (!e.payload.isPublic || !/^[6-9]\d{9}$/.test(String(e.payload.contact))) return;
      await this.notify.send({ templateCode: 'TICKET_UPDATED', channel: 'SMS', recipient: String(e.payload.contact), variables: { ticketNo: String(e.payload.ticketNo), status: String(e.payload.status).replace('_', ' ').toLowerCase() }, subjectType: 'ticket', subjectId: String(e.payload.ticketId) });
    });
  }

  async states() {
    const states = await this.masters.activeStates();
    return states.map((s) => ({ code: s.code, name: s.name, rulePack: s.rulePack }));
  }

  /** Sends an OTP. Status and support look-ups send it to the number already on record, never to a number typed in. */
  async requestOtp(req: OtpRequest) {
    if (req.purpose === 'ORDER_CONFIRM') {
      if (!req.mobile) throw Problem.badRequest('Mobile number is required');
      return this.otp.request({ purpose: 'ORDER_CONFIRM', recipient: req.mobile, context: { mobile: req.mobile } });
    }
    if (req.purpose === 'STATUS') {
      if (!req.regnNo || !req.chassisLast5) throw Problem.badRequest('Registration number and last five chassis characters are required');
      const order = await this.orders.latestForVehicle(req.regnNo, req.chassisLast5);
      if (!order?.mobile) throw Problem.notFound('An order for these vehicle details');
      return this.otp.request({ purpose: 'STATUS', recipient: order.mobile, context: { orderId: order.id, regnNo: order.regnNo } });
    }
    if (req.ticketNo) {
      const t = await this.tickets.byNumber(req.ticketNo, true).catch(() => null);
      if (!t) throw Problem.notFound('Complaint');
      return this.otp.request({ purpose: 'SUPPORT', recipient: t.raisedByContact, context: { ticketNo: t.ticketNo } });
    }
    if (!req.mobile) throw Problem.badRequest('Mobile number is required');
    return this.otp.request({ purpose: 'SUPPORT', recipient: req.mobile, context: { mobile: req.mobile } });
  }

  async uploadEvidence(file: Express.Multer.File) {
    const f = await this.files.upload({ data: file.buffer, filename: file.originalname, mimeType: file.mimetype, purpose: 'replacement-evidence', retentionDays: 30 });
    return { id: f.id, filename: f.filename };
  }

  async placeOrder(req: CustomerOrderRequest) {
    const proof = await this.otp.verify(req.otpRef, req.otpCode, 'ORDER_CONFIRM');
    if (proof.recipient !== req.mobile) throw Problem.badRequest('The OTP was sent to a different mobile number', 'otp-mobile');
    const check = await this.checks.requireDone(req.vehicleCheckId);
    const result = check.result as { orderType: 'OLD' | 'REPLACEMENT' | null };
    if (!result.orderType) throw Problem.unprocessable('This vehicle cannot be ordered here', 'not-eligible');
    if (result.orderType === 'REPLACEMENT' && (!req.replacementReason || !req.evidenceFileId)) {
      throw Problem.badRequest('A replacement needs the reason and a photo of the damaged plate or the police report', 'evidence-required');
    }
    const dealer = await this.masters.dealerByCode(req.dealerCode);
    if (!dealer.acceptsCustomerOrders || dealer.stateCode !== check.stateCode) throw Problem.unprocessable('Choose a fitment centre in the vehicle’s state', 'centre-invalid');
    const order = await this.prisma.tx(async (tx) => {
      const o = await this.orders.create(
        {
          channel: 'CUSTOMER_PORTAL',
          orderType: result.orderType!,
          plateSet: req.plateSet,
          replacementReason: req.replacementReason,
          evidenceFileId: req.evidenceFileId,
          regnNo: check.regnNo,
          chassisNo: check.chassisLast5,
          engineNo: check.engineLast5,
          stateCode: check.stateCode,
          dealerId: dealer.id,
          ownerName: req.ownerName,
          mobile: req.mobile,
          email: req.email,
        },
        tx,
      );
      const b = await this.booking.book(tx, o.id, dealer.id, req.slotDate, req.slotStart);
      await this.notify.send(
        { templateCode: 'BOOKING_CONFIRMED', channel: 'SMS', recipient: req.mobile, variables: { regnNo: o.regnNo, centre: dealer.name, date: b.slotDate, time: b.slotStart }, subjectType: SUBJECT.order, subjectId: o.id },
        tx,
      );
      return o;
    });
    const token = await this.identity.issueCustomerToken({ mobile: req.mobile, claims: { orderId: order.id, regnNo: order.regnNo, mobile: req.mobile } });
    return { orderId: order.id, orderNo: order.orderNo, status: order.status, ...token };
  }

  /** The order the customer token was issued for. */
  async myOrder(orderId: string) {
    const claims = requestContext.actor()?.claims ?? {};
    const order = await this.orders.get(orderId);
    if (claims.orderId !== order.id && claims.regnNo !== order.regnNo) throw Problem.forbidden('This session is for another vehicle');
    return order;
  }

  async orderView(orderId: string) {
    const o = await this.myOrder(orderId);
    const [history, booking, payment, dealer] = await Promise.all([
      this.orders.history(o.id),
      this.booking.forOrder(o.id),
      o.paymentId ? this.payments.get(o.paymentId) : null,
      o.dealerId ? this.masters.dealer(o.dealerId) : null,
    ]);
    return {
      id: o.id,
      orderNo: o.orderNo,
      status: o.status,
      orderType: o.orderType,
      regnNo: o.regnNo,
      maker: o.maker,
      vehicleClass: o.vehicleClass,
      amountPaise: o.amountPaise,
      rejectionReason: o.rejectionReason,
      createdAt: o.createdAt,
      centre: dealer ? { code: dealer.code, name: dealer.name, city: dealer.city, address: dealer.address } : null,
      booking: booking ? { date: booking.slotDate, slot: booking.slotStart, status: booking.status, rescheduleCount: booking.rescheduleCount } : null,
      payment: payment ? { status: payment.status, txnId: payment.txnId, amountPaise: payment.amountPaise } : null,
      timeline: history.map((h) => ({ status: h.toStatus, at: h.createdAt, note: h.note })),
    };
  }

  /**
   * Starts hosted checkout. The portal may pass its own origin so the gateway returns the browser to the
   * address the customer is using (dev server, Docker web port or a LAN address); anything else falls back
   * to PUBLIC_WEB_URL.
   */
  async checkout(orderId: string, returnOrigin?: string) {
    const o = await this.myOrder(orderId);
    if (o.status !== 'AWAITING_PAYMENT' || !o.paymentId) throw Problem.conflict(`Order is ${o.status}; nothing to pay`, 'not-awaiting-payment');
    const origin = allowedOrigin(returnOrigin) ?? env.publicWebUrl;
    return this.payments.checkout(o.paymentId, { returnUrl: `${origin}/portal/payment-return?orderId=${o.id}` });
  }

  async verifyPayment(orderId: string) {
    const o = await this.myOrder(orderId);
    if (!o.paymentId) throw Problem.notFound('Payment');
    return this.payments.requestVerify(o.paymentId);
  }

  async reschedule(orderId: string, date: string, slot: string) {
    const o = await this.myOrder(orderId);
    return this.booking.reschedule(o.id, date, slot);
  }

  async receipt(orderId: string) {
    const o = await this.myOrder(orderId);
    if (!o.paymentId) throw Problem.notFound('Payment');
    const p = await this.payments.get(o.paymentId);
    if (!['SUCCESS', 'REFUNDED'].includes(p.status)) throw Problem.conflict('No successful payment yet', 'not-paid');
    const [booking, dealer] = await Promise.all([this.booking.forOrder(o.id), o.dealerId ? this.masters.dealer(o.dealerId) : null]);
    const price = o.priceSnapshot as { basePaise: number; extras: Array<{ name: string; amountPaise: number }> } | null;
    const lines = [
      { item: `HSRP ${o.plateSet === 'BOTH' ? 'front + rear' : o.plateSet.toLowerCase()} (${o.vehicleClass ?? ''} · ${o.orderType})`, amount: ((price?.basePaise ?? p.amountPaise) / 100).toFixed(2) },
      ...(price?.extras ?? []).map((x) => ({ item: x.name, amount: (x.amountPaise / 100).toFixed(2) })),
    ];
    return {
      filename: `receipt-${o.orderNo}.pdf`,
      pdf: await this.docs.render('receipt', {
        order: o,
        payment: { ...p, amount: (p.amountPaise / 100).toFixed(2), date: istDate(p.succeededAt ?? p.updatedAt) },
        booking,
        dealer,
        lines,
      }),
    };
  }

  /** "HSRP Status": verify OTP sent to the number on the order, then return a short-lived token and the order. */
  async statusLogin(otpRef: string, code: string) {
    const proof = await this.otp.verify(otpRef, code, 'STATUS');
    const orderId = String(proof.context.orderId);
    const token = await this.identity.issueCustomerToken({ mobile: proof.recipient, claims: { orderId, regnNo: proof.context.regnNo, mobile: proof.recipient } });
    requestContext.set({ actor: { id: `customer:${proof.recipient}`, type: 'customer', roles: ['CUSTOMER'], permissions: [], claims: { orderId, regnNo: proof.context.regnNo } } });
    return { ...token, order: await this.orderView(orderId) };
  }

  async raiseComplaint(req: ComplaintRequest) {
    const proof = await this.otp.verify(req.otpRef, req.otpCode, 'SUPPORT');
    if (proof.recipient !== req.mobile) throw Problem.badRequest('The OTP was sent to a different mobile number', 'otp-mobile');
    const order = req.regnNo ? await this.orders.find({ regnNo: req.regnNo }, { orderBy: { createdAt: 'desc' }, take: 1 }) : [];
    const cats = await this.tickets.categories();
    const cat = cats.find((c) => c.code === req.category);
    const t = await this.tickets.create({
      categoryCode: req.category,
      title: `${cat?.name ?? req.category}${req.regnNo ? ` · ${req.regnNo}` : ''}`,
      description: req.description,
      raisedByName: req.name,
      raisedByContact: req.mobile,
      subjectType: order[0] ? SUBJECT.order : undefined,
      subjectId: order[0]?.id,
    });
    return { ticketNo: t.ticketNo, dueAt: t.dueAt, status: t.status };
  }

  async complaintStatus(ticketNo: string, otpRef: string, code: string) {
    const proof = await this.otp.verify(otpRef, code, 'SUPPORT');
    if (proof.context.ticketNo !== ticketNo) throw Problem.badRequest('The OTP was issued for another complaint', 'otp-ticket');
    const t = await this.tickets.byNumber(ticketNo, true);
    return { ticketNo: t.ticketNo, title: t.title, status: t.status, createdAt: t.createdAt, dueAt: t.dueAt, ageDays: t.ageDays, overdue: t.overdue, events: t.events.map((e) => ({ at: e.createdAt, kind: e.kind, message: e.message, status: e.toStatus })) };
  }
}
