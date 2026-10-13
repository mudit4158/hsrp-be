"""Generic payments. A payment belongs to any subject (type + id). It is marked paid only through a gateway webhook or a
server-to-server verify — never because the browser came back to a success URL. Success is announced with the
generic event PaymentSucceeded { subjectType, subjectId }."""

import logging
import secrets
import time
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.platform.config import env
from app.platform.context import request_context
from app.platform.db.base import utcnow
from app.platform.db.session import Database
from app.platform.http.problem import NonRetryableError, Problem
from app.utility.integration_hub.call_log import CallLogService
from app.utility.integration_hub.event_bus import DeliveredEvent, EventBus
from app.utility.payments.models import Payment, PaymentEvent, PaymentRefund

log = logging.getLogger("Payments")


@dataclass
class CheckoutRequest:
    txn_id: str
    amount_paise: int
    product_info: str
    # {name, email?, mobile?}
    payer: dict[str, Any]
    success_url: str
    failure_url: str


@dataclass
class CallbackResult:
    txn_id: str
    # SUCCESS | FAILED | CANCELLED | PENDING
    status: str
    hash_valid: bool
    provider_ref: str | None = None
    amount_paise: int | None = None


class PaymentProvider(Protocol):
    """Port for a hosted-checkout payment gateway (shaped after PayU). Implementations live in app/adapters."""

    name: str

    def create_checkout(self, req: CheckoutRequest) -> dict[str, Any]:
        """A browser form post to the gateway's hosted page: {action, method: 'POST', fields}."""
        ...

    def parse_callback(self, body: dict[str, str]) -> CallbackResult: ...

    def verify(self, txn_id: str) -> dict[str, Any]:
        """{status, providerRef?, amountPaise?}"""
        ...

    def refund(self, txn_id: str, amount_paise: int, refund_ref: str) -> dict[str, Any]:
        """{providerRef, status: SUCCESS | PENDING | FAILED}"""
        ...


def _base36(n: int) -> str:
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = digits[r] + out
    return out or "0"


class PaymentsService:
    def __init__(self, db: Database, bus: EventBus, calls: CallLogService, provider: PaymentProvider):
        self.db = db
        self.bus = bus
        self.calls = calls
        self.provider = provider
        bus.subscribe("PaymentVerifyRequested", "payments.verify", self._run_verify)
        bus.subscribe("PaymentRefundRequested", "payments.refund", self._run_refund)

    def create_payment(
        self,
        amount_paise: int,
        payer: dict[str, Any],
        subject_type: str,
        subject_id: str,
        return_url: str,
        product_info: str,
        s: Session | None = None,
    ) -> Payment:
        if amount_paise <= 0:
            raise Problem.bad_request("Amount must be positive")
        with self.db.use(s) as session:
            p = Payment(
                tenant_id=request_context.tenant_id(),
                txn_id=f"TXN{_base36(int(time.time() * 1000)).upper()}{secrets.token_hex(3).upper()}",
                provider=self.provider.name,
                amount_paise=amount_paise,
                product_info=product_info,
                payer=payer,
                subject_type=subject_type,
                subject_id=subject_id,
                return_url=return_url,
            )
            session.add(p)
            session.flush()
            return p

    def checkout(self, payment_id: str, return_url: str | None = None) -> dict[str, Any]:
        """Builds the signed hosted-checkout form the browser posts to the gateway."""
        p = self.get(payment_id)
        if p.status == "SUCCESS":
            raise Problem.conflict("Already paid", "already-paid")
        callback = f"{env.public_api_url}/api/v1/payments/return/{self.provider.name}"
        form = self.provider.create_checkout(CheckoutRequest(p.txn_id, p.amount_paise, p.product_info, p.payer, callback, callback))
        with self.db.tx() as s:
            row = s.get_one(Payment, p.id)
            if return_url and return_url != row.return_url:
                row.return_url = return_url
            row.status = "PENDING"
        self._log_event(p.id, p.txn_id, "CHECKOUT", {"action": form["action"], "txnid": p.txn_id, "amount": form["fields"].get("amount")})
        return {"paymentId": p.id, **form}

    def handle_webhook(self, body: dict[str, str]) -> dict[str, bool]:
        """Server-to-server notification from the gateway. The only callback that can mark a payment paid."""
        cb = self.provider.parse_callback(body)
        p = self._by_txn(cb.txn_id)
        self._log_event(p.id if p else None, cb.txn_id, "WEBHOOK", body, cb.hash_valid, cb.status)
        if p is None:
            raise Problem.not_found("Payment")
        if not cb.hash_valid:
            raise Problem.bad_request("Hash mismatch", "bad-hash")
        if cb.amount_paise is not None and cb.amount_paise != p.amount_paise:
            raise Problem.bad_request("Amount mismatch", "amount-mismatch")
        request_context.run_as_system(p.tenant_id, lambda: self._apply_status(p.id, cb.status, cb.provider_ref))
        return {"ok": True}

    def handle_return(self, body: dict[str, str]) -> str:
        """Browser return from the gateway: logged, then a verify is queued. Returns where to send the browser."""
        cb = self.provider.parse_callback(body)
        p = self._by_txn(cb.txn_id)
        self._log_event(p.id if p else None, cb.txn_id, "RETURN", body, cb.hash_valid, cb.status)
        if p is None:
            raise Problem.not_found("Payment")
        request_context.run_as_system(p.tenant_id, lambda: self.request_verify(p.id))
        sep = "&" if "?" in p.return_url else "?"
        return f"{p.return_url}{sep}paymentId={p.id}&result={cb.status.lower()}"

    def request_verify(self, payment_id: str) -> dict[str, Any]:
        """Queues a server-to-server status check (runs from the outbox)."""
        p = self.get(payment_id)
        with self.db.tx() as s:
            self.bus.publish(s, "PaymentVerifyRequested", "payment", p.id, {"paymentId": p.id})
        return {"status": p.status, "queued": True}

    def request_refund(self, payment_id: str, amount_paise: int, reason: str, s: Session | None = None) -> PaymentRefund:
        with self.db.use(s) as tx:
            p = tx.get(Payment, payment_id)
            if p is None:
                raise Problem(404, "Not found", "Record not found", "not-found")
            if p.status != "SUCCESS":
                raise Problem.conflict(f"Payment is {p.status}; only successful payments can be refunded")
            if amount_paise <= 0 or p.refunded_paise + amount_paise > p.amount_paise:
                raise Problem.bad_request("Refund amount exceeds the paid amount")
            r = PaymentRefund(tenant_id=p.tenant_id, payment_id=payment_id, amount_paise=amount_paise, status="PENDING", reason=reason)
            tx.add(r)
            tx.flush()
            self.bus.publish(tx, "PaymentRefundRequested", "payment", p.id, {"refundId": r.id})
            return r

    def reconcile(self) -> int:
        """Reconciliation: re-verify payments stuck in PENDING for more than two minutes."""
        with self.db.tx() as s:
            stuck = s.scalars(select(Payment).where(Payment.status == "PENDING", Payment.updated_at < utcnow() - timedelta(minutes=2)).limit(50)).all()
        for p in stuck:
            request_context.run_as_system(p.tenant_id, lambda p=p: self.request_verify(p.id))
        return len(stuck)

    def get(self, payment_id: str) -> Payment:
        with self.db.tx() as s:
            p = s.get(Payment, payment_id)
        if p is None:
            raise Problem.not_found("Payment")
        return p

    def for_subject(self, subject_type: str, subject_id: str, s: Session | None = None) -> list[Payment]:
        with self.db.use(s) as session:
            return list(
                session.scalars(
                    select(Payment)
                    .where(Payment.tenant_id == request_context.tenant_id(), Payment.subject_type == subject_type, Payment.subject_id == subject_id)
                    .order_by(Payment.created_at.desc())
                )
            )

    # ------------------------------------------------------------------

    def _by_txn(self, txn_id: str) -> Payment | None:
        with self.db.tx() as s:
            return s.scalar(select(Payment).where(Payment.txn_id == txn_id))

    def _run_verify(self, e: DeliveredEvent) -> None:
        with self.db.tx() as s:
            p = s.get(Payment, str(e.payload.get("paymentId")))
        if p is None:
            raise NonRetryableError("Payment not found")
        if p.status in ("SUCCESS", "REFUNDED"):
            return
        res = self.calls.track(
            lambda: self.provider.verify(p.txn_id),
            system="PAYMENT",
            operation="verify",
            subject_type="payment",
            subject_id=p.id,
            request={"txnId": p.txn_id},
        )
        self._log_event(p.id, p.txn_id, "VERIFY", res, True, res["status"])
        if res.get("amountPaise") is not None and res["amountPaise"] != p.amount_paise:
            raise NonRetryableError("Amount mismatch on verify")
        self._apply_status(p.id, res["status"], res.get("providerRef"), from_verify=True)

    def _run_refund(self, e: DeliveredEvent) -> None:
        with self.db.tx() as s:
            r = s.get(PaymentRefund, str(e.payload.get("refundId")))
            if r is None:
                raise NonRetryableError("Refund not found")
            if r.status == "SUCCESS":
                return
            p = s.get_one(Payment, r.payment_id)
        res = self.calls.track(
            lambda: self.provider.refund(p.txn_id, r.amount_paise, r.id),
            system="PAYMENT",
            operation="refund",
            subject_type="payment",
            subject_id=p.id,
            request={"txnId": p.txn_id, "amountPaise": r.amount_paise},
        )
        if res["status"] == "FAILED":
            raise RuntimeError("Gateway refused the refund")
        with self.db.tx() as s:
            ref = s.get_one(PaymentRefund, r.id)
            ref.status, ref.provider_ref = res["status"], res.get("providerRef")
            pay = s.get_one(Payment, p.id)
            refunded = p.refunded_paise + r.amount_paise
            pay.refunded_paise = refunded
            pay.status = "REFUNDED" if refunded >= p.amount_paise else p.status
            s.flush()
            self.bus.publish(s, "PaymentRefunded", p.subject_type, p.subject_id, {"paymentId": p.id, "amountPaise": r.amount_paise})

    def _apply_status(self, payment_id: str, status: str, provider_ref: str | None = None, from_verify: bool = False) -> None:
        with self.db.tx() as s:
            locked = s.execute(select(Payment.status).where(Payment.id == payment_id).with_for_update()).scalar_one()
            current = s.get_one(Payment, payment_id)
            if from_verify:
                current.last_verified_at = utcnow()
            if locked in ("SUCCESS", "REFUNDED") or status == "PENDING":
                return
            if status == "SUCCESS":
                current.status, current.provider_ref, current.succeeded_at = "SUCCESS", provider_ref, utcnow()
                s.flush()
                self.bus.publish(
                    s,
                    "PaymentSucceeded",
                    current.subject_type,
                    current.subject_id,
                    {"paymentId": payment_id, "amountPaise": current.amount_paise, "subjectType": current.subject_type, "subjectId": current.subject_id},
                )
            else:
                current.status, current.provider_ref = status, provider_ref
                s.flush()
                self.bus.publish(
                    s,
                    "PaymentFailed",
                    current.subject_type,
                    current.subject_id,
                    {"paymentId": payment_id, "status": status, "subjectType": current.subject_type, "subjectId": current.subject_id},
                )
        log.info("Payment %s → %s", payment_id, status)

    def _log_event(
        self,
        payment_id: str | None,
        txn_id: str | None,
        kind: str,
        payload: dict[str, Any],
        hash_valid: bool | None = None,
        result_status: str | None = None,
    ) -> None:
        with self.db.tx() as s:
            s.add(
                PaymentEvent(
                    tenant_id=request_context.tenant_id(),
                    payment_id=payment_id,
                    txn_id=txn_id,
                    kind=kind,
                    payload=payload,
                    hash_valid=hash_valid,
                    result_status=result_status,
                )
            )
