"""Postpaid billing (D46). Prepaid OEMs keep using wallets (order-intake holds and captures). For a postpaid OEM the order
is confirmed without a hold; this module turns it into a charge, makes the charge billable when the plates are
dispatched, and at each cycle close (weekly or monthly, per OEM) bills every party — the OEM or the dealer, set per OEM
× dealer — for its dispatched orders, with a PDF sent by e-mail."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy import select, update

from app.core.billing.models import Bill, BillingCharge, BillingRun
from app.core.billing.rules import (
    cycle_boundary,
    ist_day,
    pair_scope_id,
    period_label,
    previous_boundary,
    resolve_bill_to,
    rupees,
)
from app.core.masters.service import MastersService
from app.core.order_intake.orders import OrderService
from app.core.shared.subjects import SUBJECT, ist_date
from app.platform.config import env
from app.platform.context import request_context
from app.platform.db.base import utcnow
from app.platform.db.session import Database
from app.platform.http.json import row
from app.platform.http.problem import NonRetryableError, Problem
from app.utility.audit.service import AuditService
from app.utility.configuration.service import Scope, SettingsService
from app.utility.documents.service import DocumentsService
from app.utility.file_storage.service import FileService
from app.utility.integration_hub.event_bus import DeliveredEvent, EventBus
from app.utility.notification.service import NotificationService

log = logging.getLogger("Billing")


class BillingService:
    def __init__(
        self,
        db: Database,
        settings: SettingsService,
        masters: MastersService,
        orders: OrderService,
        docs: DocumentsService,
        files: FileService,
        notify: NotificationService,
        audit: AuditService,
        bus: EventBus,
    ):
        self.db = db
        self.settings = settings
        self.masters = masters
        self.orders = orders
        self.docs = docs
        self.files = files
        self.notify = notify
        self.audit = audit
        bus.subscribe("OrderStatusChanged", "billing.charges", self._on_order_status)

    # ------------------------------------------------------------ configuration (settings, effective-dated)

    def payment_mode(self, oem_code: str) -> str:
        return self.settings.get_or("billing.paymentMode", "PREPAID", [Scope("oem", oem_code)])

    def cycle(self, oem_code: str) -> str:
        return self.settings.get_or("billing.cycle", "MONTHLY", [Scope("oem", oem_code)])

    def bill_to(self, oem_code: str, dealer_code: str | None) -> str:
        pair = self.settings.get("billing.billTo", [Scope("oem-dealer", pair_scope_id(oem_code, dealer_code))]) if dealer_code else None
        # `get` falls back to global; read the OEM default on its own so a pair without a setting inherits it.
        oem_default = self.settings.get("billing.billTo", [Scope("oem", oem_code)])
        return resolve_bill_to(pair, oem_default, bool(dealer_code))

    def _contact(self, oem_code: str) -> str:
        return self.settings.get_or("billing.contactEmail", "", [Scope("oem", oem_code)])

    def setup(self) -> list[dict[str, Any]]:
        """Everything the Billing → Setup screen shows: per OEM its mode, cycle and contact; per OEM × dealer the bill-to."""
        out = []
        for o in self.masters.oems():
            out.append(
                {
                    "oemCode": o.code,
                    "oemName": o.name,
                    "paymentMode": self.payment_mode(o.code),
                    "cycle": self.cycle(o.code),
                    "billToDefault": self.bill_to(o.code, None),
                    "contactEmail": self._contact(o.code),
                    "dealers": [
                        {"dealerCode": d.code, "dealerName": d.name, "billTo": self.bill_to(o.code, d.code), "email": d.email} for d in self.masters.dealers_for_oem(o.id)
                    ],
                }
            )
        return out

    def configure_oem(
        self, oem_code: str, payment_mode: str | None = None, cycle: str | None = None, bill_to_default: str | None = None, contact_email: str | None = None
    ) -> dict[str, Any] | None:
        oem = self.masters.oem_by_code(oem_code)
        for key, value in (("billing.paymentMode", payment_mode), ("billing.cycle", cycle), ("billing.billTo", bill_to_default)):
            if value:
                self.settings.set(key, "oem", oem.code, value)
        if contact_email is not None:
            self.settings.set("billing.contactEmail", "oem", oem.code, contact_email)
        return next((x for x in self.setup() if x["oemCode"] == oem.code), None)

    def configure_pair(self, oem_code: str, dealer_code: str, bill_to: str) -> dict[str, str]:
        oem = self.masters.oem_by_code(oem_code)
        dealer = self.masters.dealer_by_code(dealer_code)
        if not self.masters.dealer_serves_oem(dealer.id, oem.id):
            raise Problem.unprocessable(f"Dealer {dealer.code} is not mapped to {oem.name}", "dealer-oem-mapping")
        self.settings.set("billing.billTo", "oem-dealer", pair_scope_id(oem.code, dealer.code), bill_to)
        return {"oemCode": oem.code, "dealerCode": dealer.code, "billTo": bill_to}

    # ------------------------------------------------------------ charges (outbox subscriber)

    def _on_order_status(self, e: DeliveredEvent) -> None:
        status = str(e.payload.get("status"))
        if status not in ("CONFIRMED", "DISPATCHED", "CANCELLED", "REJECTED"):
            return
        order = self.orders.get(str(e.payload.get("orderId")))
        with self.db.tx() as s:
            charge = s.scalar(select(BillingCharge).where(BillingCharge.order_id == order.id))
            if status == "CONFIRMED":
                # Postpaid orders are confirmed without a wallet hold or gateway payment (order-flow checks the same setting).
                if charge is not None or not order.oem_id or order.wallet_hold_id or order.payment_id:
                    return
                oem = self.masters.oem(order.oem_id)
                if oem is None or self.payment_mode(oem.code) != "POSTPAID":
                    return
                dealer = self.masters.dealer(order.dealer_id) if order.dealer_id else None
                bill_to = self.bill_to(oem.code, dealer.code if dealer else None)
                to_dealer = bill_to == "DEALER" and dealer is not None
                s.add(
                    BillingCharge(
                        tenant_id=order.tenant_id,
                        order_id=order.id,
                        order_no=order.order_no,
                        regn_no=order.regn_no,
                        oem_id=oem.id,
                        dealer_id=dealer.id if dealer else None,
                        bill_to_type=bill_to,
                        bill_to_id=dealer.id if to_dealer else oem.id,
                        bill_to_name=f"{dealer.code} · {dealer.name}" if to_dealer else f"{oem.code} · {oem.name}",
                        amount_paise=order.amount_paise or 0,
                        confirmed_at=order.confirmed_at or utcnow(),
                    )
                )
                return
            if charge is None:
                return
            if status == "DISPATCHED" and charge.status == "PENDING":
                charge.status, charge.dispatched_at = "BILLABLE", utcnow()
            elif status in ("CANCELLED", "REJECTED") and charge.status in ("PENDING", "BILLABLE"):
                charge.status, charge.void_reason = "VOID", f"Order {status.lower()}"

    def charges(self, status: str | None = None, oem_code: str | None = None) -> list[BillingCharge]:
        q = select(BillingCharge).where(BillingCharge.tenant_id == request_context.tenant_id())
        if status:
            q = q.where(BillingCharge.status.in_(status.split(",")))
        if oem_code:
            q = q.where(BillingCharge.oem_id == self.masters.oem_by_code(oem_code).id)
        with self.db.tx() as s:
            return list(s.scalars(q.order_by(BillingCharge.created_at.desc()).limit(500)))

    def for_order(self, order_id: str) -> dict[str, Any] | None:
        with self.db.tx() as s:
            charge = s.scalar(select(BillingCharge).where(BillingCharge.order_id == order_id))
            bill = s.get(Bill, charge.bill_id) if charge is not None and charge.bill_id else None
        if charge is None:
            return None
        brief = {"id": bill.id, "billNo": bill.bill_no, "status": bill.status, "periodFrom": bill.period_from, "periodTo": bill.period_to} if bill else None
        return {"charge": charge, "bill": brief}

    # ------------------------------------------------------------ bills

    def run(self, oem_code: str, trigger: str, period_to: datetime | None = None) -> dict[str, Any]:
        """Bills every billable charge of the OEM dispatched before `period_to`, one bill per bill-to party, then sends
        each. `trigger` is 'cycle' for the scheduled close (idempotent per period end) or 'manual' for Run billing now."""
        oem = self.masters.oem_by_code(oem_code)
        if self.payment_mode(oem.code) != "POSTPAID":
            raise Problem.unprocessable(f"{oem.name} is prepaid; only postpaid OEMs are billed", "not-postpaid")
        cycle = self.cycle(oem.code)
        tenant_id = request_context.tenant_id()
        period_to = period_to or utcnow()
        with self.db.tx() as s:
            last = s.scalar(
                select(BillingRun).where(BillingRun.tenant_id == tenant_id, BillingRun.oem_id == oem.id, BillingRun.period_to <= period_to).order_by(BillingRun.period_to.desc())
            )
            if trigger == "cycle" and last is not None and last.period_to == period_to:
                return {"run": last, "bills": []}
            charges = s.scalars(
                select(BillingCharge)
                .where(BillingCharge.tenant_id == tenant_id, BillingCharge.oem_id == oem.id, BillingCharge.status == "BILLABLE", BillingCharge.dispatched_at < period_to)
                .order_by(BillingCharge.dispatched_at)
            ).all()
            period_from = (last.period_to if last else None) or (charges[0].dispatched_at if charges else None) or previous_boundary(cycle, cycle_boundary(cycle, period_to))
            groups: dict[str, list[BillingCharge]] = {}
            for c in charges:
                groups.setdefault(f"{c.bill_to_type}:{c.bill_to_id}", []).append(c)
            bills = []
            for lines in groups.values():
                first = lines[0]
                bill = Bill(
                    tenant_id=tenant_id,
                    bill_no=self.docs.next_number("bill", s),
                    oem_id=oem.id,
                    bill_to_type=first.bill_to_type,
                    bill_to_id=first.bill_to_id,
                    bill_to_name=first.bill_to_name,
                    cycle=cycle,
                    period_from=period_from,
                    period_to=period_to,
                    amount_paise=sum(x.amount_paise for x in lines),
                    line_count=len(lines),
                    created_by=request_context.actor_id(),
                )
                s.add(bill)
                s.flush()
                s.execute(update(BillingCharge).where(BillingCharge.id.in_([x.id for x in lines])).values(status="BILLED", bill_id=bill.id, updated_at=utcnow()))
                bills.append(bill)
            run = BillingRun(tenant_id=tenant_id, oem_id=oem.id, cycle=cycle, trigger=trigger, period_from=period_from, period_to=period_to, bill_count=len(bills))
            s.add(run)
            s.flush()
            self.audit.record("billing.run", SUBJECT.oem, oem.id, after={"trigger": trigger, "periodTo": period_to, "bills": [b.bill_no for b in bills]}, s=s)
            bill_ids = [b.id for b in bills]
            bill_nos = [b.bill_no for b in bills]
        # PDF and e-mail after the commit: a failure here leaves the bill ISSUED, and "Send again" retries it.
        for bid, bno in zip(bill_ids, bill_nos, strict=True):
            try:
                self.send(bid)
            except Exception as err:
                log.warning("Bill %s not sent: %s", bno, err)
        log.info("%s: %s bill(s) for %s order(s), %s", oem.code, len(bill_ids), len(charges), trigger)
        with self.db.tx() as s:
            fresh = list(s.scalars(select(Bill).where(Bill.id.in_(bill_ids))))
        return {"run": run, "bills": fresh}

    def close_due_cycles(self, now: datetime | None = None) -> list[dict[str, Any]]:
        """Scheduled job: closes the cycle of every postpaid OEM once its boundary has passed."""
        now = now or utcnow()
        out = []
        for oem in self.masters.oems():
            if self.payment_mode(oem.code) != "POSTPAID":
                continue
            boundary = cycle_boundary(self.cycle(oem.code), now)
            with self.db.tx() as s:
                done = s.scalar(select(BillingRun.id).where(BillingRun.tenant_id == request_context.tenant_id(), BillingRun.oem_id == oem.id, BillingRun.period_to >= boundary))
            if done is None:
                out.append(self.run(oem.code, "cycle", boundary))
        return out

    def bills(self, oem_code: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
        q = select(Bill).where(Bill.tenant_id == request_context.tenant_id())
        if oem_code:
            q = q.where(Bill.oem_id == self.masters.oem_by_code(oem_code).id)
        if status:
            q = q.where(Bill.status == status)
        with self.db.tx() as s:
            bills = s.scalars(q.order_by(Bill.created_at.desc()).limit(300)).all()
        codes = {o.id: o.code for o in self.masters.oems()}
        return [{**row(b), "oemCode": codes.get(b.oem_id), "period": period_label(b.period_from, b.period_to)} for b in bills]

    def bill(self, id: str) -> dict[str, Any]:
        with self.db.tx() as s:
            b = s.scalar(select(Bill).where(Bill.id == id, Bill.tenant_id == request_context.tenant_id()))
            if b is None:
                raise Problem.not_found("Bill")
            lines = list(s.scalars(select(BillingCharge).where(BillingCharge.bill_id == id).order_by(BillingCharge.dispatched_at)))
        return {**row(b), "period": period_label(b.period_from, b.period_to), "lines": [row(x) for x in lines]}

    def pdf(self, id: str) -> tuple[str, bytes]:
        b = self.bill(id)
        if b["fileId"]:
            return f"{b['billNo']}.pdf", self.files.read(b["fileId"])[1]
        return f"{b['billNo']}.pdf", self._render(b)

    def _render(self, b: dict[str, Any]) -> bytes:
        oem = self.masters.oem(b["oemId"])
        return self.docs.render(
            "bill",
            {
                "bill": {
                    "billNo": b["billNo"],
                    "date": ist_date(b["createdAt"]),
                    "period": b["period"],
                    "cycle": b["cycle"].lower(),
                    "amount": rupees(b["amountPaise"]),
                    "lineCount": b["lineCount"],
                    "billTo": b["billToName"],
                    "billToType": "OEM" if b["billToType"] == "OEM" else "Dealer",
                },
                "oem": {"code": oem.code, "name": oem.name},
                "lines": [
                    {
                        "rowNo": i + 1,
                        "orderNo": x["orderNo"],
                        "regnNo": x["regnNo"],
                        "dispatched": ist_day(x["dispatchedAt"]) if x["dispatchedAt"] else "",
                        "amount": rupees(x["amountPaise"]),
                    }
                    for i, x in enumerate(b["lines"])
                ],
            },
        )

    def send(self, id: str) -> Bill:
        """Renders the PDF (once), e-mails it to the bill-to party's billing contact and marks the bill SENT."""
        b = self.bill(id)
        file_id = b["fileId"]
        if not file_id:
            pdf = self._render(b)
            file_id = self.files.upload(pdf, f"{b['billNo']}.pdf", "application/pdf", "bill", SUBJECT.oem, b["oemId"], 3650).id
            with self.db.tx() as s:
                s.get_one(Bill, id).file_id = file_id
        oem = self.masters.oem(b["oemId"])
        to = (self.masters.dealer(b["billToId"]).email or self._contact(oem.code)) if b["billToType"] == "DEALER" else self._contact(oem.code)
        if not to:
            raise NonRetryableError(f"No billing e-mail for {b['billToName']}")
        self.notify.send(
            "BILL_ISSUED",
            "EMAIL",
            to,
            {
                "billNo": b["billNo"],
                "billTo": b["billToName"],
                "oem": oem.name,
                "period": b["period"],
                "count": b["lineCount"],
                "amount": rupees(b["amountPaise"]),
                "link": f"{env.public_web_url}/billing?bill={b['billNo']}",
            },
            "hsrp.bill",
            b["id"],
        )
        with self.db.tx() as s:
            bill = s.get_one(Bill, id)
            bill.status = "PAID" if b["status"] == "PAID" else "SENT"
            bill.sent_to, bill.sent_at = to, utcnow()
            s.flush()
            return bill

    def mark_paid(self, id: str) -> Bill:
        b = self.bill(id)
        with self.db.tx() as s:
            bill = s.get_one(Bill, id)
            bill.status, bill.paid_at = "PAID", utcnow()
            s.flush()
        self.audit.record("billing.paid", "hsrp.bill", id, {"status": b["status"]}, {"status": "PAID"})
        return bill
