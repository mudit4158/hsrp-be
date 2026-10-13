"""Drives an order from RECEIVED to CONFIRMED: the validation chain (outbox subscriber), wallet hold and capture,
replacement approval, customer payment, and the money side of rejection and cancellation."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.masters.service import MastersService
from app.core.order_intake.models import Order, OrderValidation
from app.core.order_intake.oem_vehicle_data import OemVehicleDataService
from app.core.order_intake.orders import OrderService
from app.core.order_intake.state_machine import route_after_approval, route_after_validation
from app.core.order_intake.validation_steps import StateRules, StepResult, judge_oem_vehicle, judge_state_rules, judge_vahan_reply
from app.core.ports import OemVehicleCatalog, OrderSource, VahanLookupReply, VahanLookupRequest, VehicleRegistry
from app.core.pricing.service import PriceQuery, PricingService
from app.core.shared.subjects import APPROVAL, SUBJECT
from app.platform.config import env
from app.platform.context import request_context
from app.platform.db.base import utcnow
from app.platform.db.session import Database
from app.platform.http.problem import NonRetryableError, Problem
from app.utility.approvals.service import ApprovalsService
from app.utility.configuration.service import Scope, SettingsService
from app.utility.integration_hub.call_log import CallLogService
from app.utility.integration_hub.event_bus import DeliveredEvent, EventBus
from app.utility.notification.service import NotificationService
from app.utility.payments.service import PaymentsService
from app.utility.wallet.service import WalletService

log = logging.getLogger("OrderFlow")
DEFAULT_STEPS = ["vahan-check", "state-eligibility-rules"]


class OrderFlowService:
    def __init__(
        self,
        db: Database,
        orders: OrderService,
        masters: MastersService,
        pricing: PricingService,
        settings: SettingsService,
        wallets: WalletService,
        payments: PaymentsService,
        approvals: ApprovalsService,
        notify: NotificationService,
        calls: CallLogService,
        bus: EventBus,
        oem_data: OemVehicleDataService,
        vahan: VehicleRegistry,
        catalog: OemVehicleCatalog,
        order_source: OrderSource,
    ):
        self.db = db
        self.orders = orders
        self.masters = masters
        self.pricing = pricing
        self.settings = settings
        self.wallets = wallets
        self.payments = payments
        self.approvals = approvals
        self.notify = notify
        self.calls = calls
        self.oem_data = oem_data
        self.vahan = vahan
        self.catalog = catalog
        self.order_source = order_source
        bus.subscribe("OrderReceived", "orders.validate", lambda e: self.validate(str(e.payload["orderId"])), max_attempts=10)
        bus.subscribe("PaymentSucceeded", "orders.payment-succeeded", self._on_payment_succeeded)
        bus.subscribe("ApprovalDecided", "orders.replacement-decided", self._on_approval_decided)
        bus.subscribe("OrderRejected", "orders.settle-money", lambda e: self._settle_money(str(e.payload["orderId"])))
        bus.subscribe("OrderCancelled", "orders.settle-money", lambda e: self._settle_money(str(e.payload["orderId"])))
        bus.subscribe("OrderStatusChanged", "orders.notify-customer", self._notify_customer)
        bus.subscribe("OrderStatusChanged", "orders.oem-callback", self._oem_callback)

    # ------------------------------------------------------------ validation chain

    def validate(self, order_id: str) -> None:
        order = self.orders.get(order_id)
        if order.status != "RECEIVED":
            return
        state = self.masters.state(order.state_code)
        oem = self.masters.oem(order.oem_id) if order.oem_id else None
        dealer = self.masters.dealer(order.dealer_id) if order.dealer_id else None
        scopes = [*([Scope("dealer", dealer.code)] if dealer else []), *([Scope("oem", oem.code)] if oem else []), Scope("state", state.code)]
        steps = self.settings.get_or("order.validationSteps", DEFAULT_STEPS, scopes)
        rules = StateRules.of(self.settings.get_or("state.rules", {}, [Scope("state", state.code)]))
        cutoff = datetime.fromisoformat(self.settings.get_or("order.newVehicleCutoff", "2019-04-01")[:10])

        results: list[tuple[str, StepResult]] = []
        reply: VahanLookupReply | None = None
        category = None
        for step in steps:
            if step == "oem-catalogue-check":
                if oem is None:
                    res = StepResult(True, "Not an OEM order")
                else:
                    hit = self.calls.track(
                        lambda oem=oem: self.catalog.check(oem.code, order.chassis_no),
                        system="OEM",
                        operation="catalogue-check",
                        subject_type=SUBJECT.order,
                        subject_id=order.id,
                        request={"oem": oem.code, "chassisNo": order.chassis_no},
                    )
                    res = StepResult(True, f"Catalogue model {hit['model']}") if hit["found"] else StepResult(False, reason=f"Chassis {order.chassis_no} is not in {oem.name}'s catalogue")
            elif step == "oem-vehicle-data":
                record = self.oem_data.facts(order.chassis_no, order.oem_id) if order.order_type == "NEW" else None
                res = judge_oem_vehicle(order.order_type, order.chassis_no, order.engine_no, record, oem.name if oem else None, dealer.code if dealer else None)
            elif step == "vahan-check":
                req = VahanLookupRequest(order.regn_no, order.chassis_no[-5:], order.engine_no[-5:], self.settings.get_or("vahan.userId", "HSRPDEMO"))
                # RegistryUnavailableError propagates: the outbox retries this delivery with back-off.
                reply = self.calls.track(lambda req=req: self.vahan.lookup(req), system="VAHAN", operation="lookup", subject_type=SUBJECT.order, subject_id=order.id, request=req)
                category = self.masters.vehicle_category(reply.vch_catg) if reply.vch_catg else None
                res = judge_vahan_reply(order.order_type, order.state_code, reply, cutoff, category)
                res.data = reply
            elif step == "state-eligibility-rules":
                res = judge_state_rules(order.mobile, rules, category.vehicle_class if category else None, reply.off_cd if reply else None)
            else:
                res = StepResult(False, reason=f"Unknown validation step {step}")
            results.append((step, res))
            if not res.ok:
                break

        failed = next(((step, r) for step, r in results if not r.ok), None)
        with self.db.tx() as s:
            for step, r in results:
                self.orders.save_validation(s, order.id, step, "PASS" if r.ok else "FAIL", r.message if r.ok else r.reason, r.data)
            if failed:
                step, r = failed
                self.orders.transition(s, order.id, "REJECTED", f"validation:{step}", {"rejection_reason": r.reason}, r.reason)
                return
            patch = self._vehicle_patch(reply, category)
            if not patch["vehicle_class"]:
                self.orders.transition(
                    s,
                    order.id,
                    "REJECTED",
                    "validation:vehicle-class",
                    {"rejection_reason": "Vehicle class unknown: enable the vahan-check step for this OEM/state"},
                    "Vehicle class unknown",
                )
                return
            try:
                quote = self.pricing.quote(
                    PriceQuery(order.state_code, patch["vehicle_class"], order.order_type, order.plate_set, utcnow(), patch["vehicle_type"], oem.code if oem else None),
                    {"greenStrip": patch["green_strip"], "channel": order.channel},
                    s,
                )
            except Problem as e:
                self.orders.save_validation(s, order.id, "pricing", "FAIL", e.detail)
                self.orders.transition(s, order.id, "REJECTED", "validation:pricing", {"rejection_reason": e.detail}, e.detail)
                return
            self.orders.save_validation(s, order.id, "pricing", "PASS", f"₹{quote['totalPaise'] / 100:.2f}", quote)
            validated = self.orders.transition(s, order.id, "VALIDATED", "validation-passed", {**patch, "amount_paise": quote["totalPaise"]})
            self._route(s, validated)

    @staticmethod
    def _vehicle_patch(reply: VahanLookupReply | None, category: Any) -> dict[str, Any]:
        return {
            "vehicle_class": category.vehicle_class if category else None,
            "vehicle_type": category.vehicle_type if category else None,
            "vahan_category": category.vahan_category if category else None,
            "front_product_code": category.front_product_code if category else None,
            "rear_product_code": category.rear_product_code if category else None,
            "sticker_required": category.sticker_required if category else False,
            "fuel": reply.fuel if reply else None,
            "maker": reply.maker if reply else None,
            "norms": reply.norms if reply else None,
            "regn_date": reply.regn_date if reply else None,
            "green_strip": "VI" in (reply.norms if reply else "").upper(),
        }

    def _route(self, s: Session, order: Order) -> None:
        """After VALIDATED: approval, payment or wallet."""
        nxt = route_after_validation(order.order_type, order.channel)
        # Postpaid OEMs (D46) are billed per cycle by the billing module: no wallet hold.
        postpaid = self.is_postpaid(order)
        if order.channel != "CUSTOMER_PORTAL" and not postpaid:
            if not self._hold_wallet(s, order):
                return  # stays VALIDATED until the wallet has funds; retried by a scheduled job
        if nxt == "AWAITING_APPROVAL":
            appr = self.approvals.request(
                s,
                APPROVAL.replacement_order,
                SUBJECT.order,
                order.id,
                "OPERATIONS",
                f"Replacement {order.order_no} · {order.regn_no} · {order.replacement_reason}",
                {
                    "orderNo": order.order_no,
                    "regnNo": order.regn_no,
                    "reason": order.replacement_reason,
                    "evidenceFileId": order.evidence_file_id,
                    "plateSet": order.plate_set,
                },
            )
            self.orders.transition(s, order.id, "AWAITING_APPROVAL", "replacement-needs-approval", {"approval_id": appr.id})
        elif nxt == "AWAITING_PAYMENT":
            self._await_payment(s, order)
        else:
            self.confirm(s, order.id, "postpaid" if postpaid else "wallet-captured")

    def is_postpaid(self, order: Order) -> bool:
        """The OEM's payment mode (setting billing.paymentMode, scope oem); orders without an OEM are prepaid."""
        if not order.oem_id or order.channel == "CUSTOMER_PORTAL":
            return False
        oem = self.masters.oem(order.oem_id)
        return oem is not None and self.settings.get_or("billing.paymentMode", "PREPAID", [Scope("oem", oem.code)]) == "POSTPAID"

    def _await_payment(self, s: Session, order: Order) -> None:
        p = self.payments.create_payment(
            order.amount_paise or 0,
            {k: v for k, v in {"name": order.owner_name or "Customer", "email": order.email, "mobile": order.mobile}.items() if v is not None},
            SUBJECT.order,
            order.id,
            f"{env.public_web_url}/portal/payment-return?orderId={order.id}",
            f"HSRP {order.order_no}",
            s=s,
        )
        self.orders.transition(s, order.id, "AWAITING_PAYMENT", "awaiting-payment", {"payment_id": p.id})

    def _payer_wallet(self, order: Order) -> str | None:
        """Who pays: OEM orders draw on the OEM's wallet (with credit), others on the dealer's (possibly shared) wallet."""
        if order.oem_id and order.channel in ("OEM_API", "OEM_FILE"):
            oem = self.masters.oem(order.oem_id)
            return oem.wallet_account_id if oem else None
        if order.dealer_id:
            return self.masters.dealer(order.dealer_id).wallet_account_id
        return None

    def _hold_wallet(self, s: Session, order: Order) -> bool:
        if order.wallet_hold_id:
            return True
        wallet_id = self._payer_wallet(order)
        if not wallet_id:
            raise NonRetryableError(f"Order {order.order_no} has no wallet to charge")
        try:
            # A savepoint, so a refused hold leaves the rest of the transaction usable.
            with s.begin_nested():
                hold = self.wallets.hold(wallet_id, order.amount_paise or 0, SUBJECT.order, order.id, s=s)
        except Problem as e:
            if e.status == 402:
                self.orders.update(s, order.id, remarks=f"Waiting for wallet funds: {e.detail}")
                return False
            raise
        self.orders.update(s, order.id, wallet_hold_id=hold.id, remarks=None)
        return True

    def confirm(self, s: Session, order_id: str, trigger: str) -> Order:
        """CONFIRMED: capture any wallet hold and copy the VAHAN reply and price onto the order (snapshots)."""
        order = self.orders.get(order_id, s)
        if order.wallet_hold_id:
            self.wallets.capture(order.wallet_hold_id, s=s)
        validations = s.scalars(select(OrderValidation).where(OrderValidation.order_id == order_id).order_by(OrderValidation.created_at.desc())).all()
        vahan = next((v.data for v in validations if v.step == "vahan-check" and v.outcome == "PASS"), None)
        price = next((v.data for v in validations if v.step == "pricing" and v.outcome == "PASS"), None)
        return self.orders.transition(s, order_id, "CONFIRMED", trigger, {"confirmed_at": utcnow(), "vahan_snapshot": vahan, "price_snapshot": price})

    def retry_awaiting_funds(self, order_id: str | None = None) -> int:
        """Retries VALIDATED dealer/OEM orders that were waiting for wallet funds."""
        filters: dict[str, Any] = {"status": "VALIDATED", "wallet_hold_id": None, "channel": {"not": "CUSTOMER_PORTAL"}}
        if order_id:
            filters["id"] = order_id
        waiting = self.orders.find(filters, limit=100)
        for o in waiting:
            with self.db.tx() as s:
                fresh = self.orders.get(o.id, s)
                if fresh.status == "VALIDATED":
                    self._route(s, fresh)
        return len(waiting)

    # ------------------------------------------------------------ event handlers

    def _on_payment_succeeded(self, e: DeliveredEvent) -> None:
        if e.payload.get("subjectType") != SUBJECT.order:
            return
        order = self.orders.get(str(e.payload.get("subjectId")))
        if order.status == "AWAITING_PAYMENT":
            with self.db.tx() as s:
                self.confirm(s, order.id, "payment-succeeded")
                if order.email:
                    self.notify.send(
                        "PAYMENT_RECEIPT",
                        "EMAIL",
                        order.email,
                        {"orderNo": order.order_no, "regnNo": order.regn_no, "amount": f"{(order.amount_paise or 0) / 100:.2f}"},
                        SUBJECT.order,
                        order.id,
                        s=s,
                    )
        elif order.status == "CANCELLED":
            self.payments.request_refund(str(e.payload.get("paymentId")), int(e.payload.get("amountPaise") or 0), "Order was cancelled before payment completed")

    def _on_approval_decided(self, e: DeliveredEvent) -> None:
        if e.payload.get("approvalType") != APPROVAL.replacement_order:
            return
        order = self.orders.get(str(e.payload.get("subjectId")))
        if order.status != "AWAITING_APPROVAL":
            return
        with self.db.tx() as s:
            if e.payload.get("decision") == "APPROVED":
                if route_after_approval(order.channel) == "AWAITING_PAYMENT":
                    self._await_payment(s, order)
                else:
                    self.confirm(s, order.id, "replacement-approved")
            else:
                remarks = str(e.payload.get("remarks"))
                self.orders.transition(s, order.id, "REJECTED", "replacement-rejected", {"rejection_reason": f"Replacement rejected: {remarks}"}, remarks)

    def _settle_money(self, order_id: str) -> None:
        """On REJECTED or CANCELLED: release a held amount, refund a captured one, refund a gateway payment."""
        order = self.orders.get(order_id)
        with self.db.tx() as s:
            if order.wallet_hold_id:
                hold = self.wallets.get_hold(order.wallet_hold_id, s)
                if hold is not None and hold.status == "HELD":
                    self.wallets.release(hold.id, s=s)
                elif hold is not None and hold.status == "CAPTURED":
                    self.wallets.refund_captured(hold.id, s=s)
        if order.payment_id:
            p = self.payments.get(order.payment_id)
            if p.status == "SUCCESS":
                self.payments.request_refund(p.id, p.amount_paise - p.refunded_paise, f"Order {order.status.lower()}")

    def _notify_customer(self, e: DeliveredEvent) -> None:
        order = self.orders.get(str(e.payload.get("orderId")))
        if not order.mobile:
            return
        status = str(e.payload.get("status"))
        rules = StateRules.of(self.settings.get_or("state.rules", {}, [Scope("state", order.state_code)]))
        variables = {"orderNo": order.order_no, "regnNo": order.regn_no}
        send: tuple[str, dict[str, str]] | None = None
        if status == "REJECTED":
            send = ("ORDER_REJECTED", {**variables, "reason": (order.rejection_reason or "see details")[:80]})
        elif status == "CONFIRMED" and (order.channel == "CUSTOMER_PORTAL" or rules.sms_status_updates):
            send = ("ORDER_CONFIRMED", variables)
        elif rules.sms_status_updates and status in ("DISPATCHED", "INWARDED", "CANCELLED"):
            send = ("ORDER_STATUS", {**variables, "status": status.replace("_", " ", 1).lower()})
        if send:
            self.notify.send(send[0], "SMS", order.mobile, send[1], SUBJECT.order, order.id)

    def _oem_callback(self, e: DeliveredEvent) -> None:
        """'Reason sent to the source': OEM orders get status callbacks on key changes."""
        status = str(e.payload.get("status"))
        if str(e.payload.get("channel")) not in ("OEM_API", "OEM_FILE"):
            return
        if status not in ("REJECTED", "CONFIRMED", "DISPATCHED", "COMPLETED", "CANCELLED"):
            return
        order = self.orders.get(str(e.payload.get("orderId")))
        oem = self.masters.oem(order.oem_id) if order.oem_id else None
        if oem is None or not order.source_ref:
            return
        reason = order.rejection_reason if status == "REJECTED" else None
        self.calls.track(
            lambda: self.order_source.notify_status(oem.code, order.source_ref, status, reason),
            system="OEM",
            operation="status-callback",
            subject_type=SUBJECT.order,
            subject_id=order.id,
            request={"oem": oem.code, "ref": order.source_ref, "status": status},
        )

    def cancel(self, order_id: str, reason: str) -> Order:
        """Cancel before ISSUED; money is settled by the OrderCancelled subscriber."""
        order = self.orders.get_scoped(order_id)
        with self.db.tx() as s:
            self.orders.transition(s, order.id, "CANCELLED", "cancelled", {"cancel_reason": reason}, reason)
        log.info("Order %s cancelled by %s", order.order_no, request_context.actor_id())
        return self.orders.get(order_id)
