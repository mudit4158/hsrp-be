from datetime import UTC, datetime

from sqlalchemy import select

from app.adapters.models import MockPayuTxn
from app.adapters.payment.payu_hash import paise, request_hash, response_hash, rupees
from app.platform.config import env
from app.platform.db.session import Database
from app.utility.payments.service import CallbackResult, CheckoutRequest


def map_payu_status(status: str | None, unmapped: str | None = None) -> str:
    if status == "success":
        return "SUCCESS"
    if status in ("pending", "initiated"):
        return "PENDING"
    if unmapped == "userCancelled" or status == "cancelled":
        return "CANCELLED"
    return "FAILED"


class MockPayuAdapter:
    """PayU-shaped hosted checkout whose "gateway" is the mock page served by app/adapters/payment/gateway.py."""

    name = "payu"

    def __init__(self, db: Database):
        self.db = db

    def create_checkout(self, req: CheckoutRequest) -> dict:
        fields = {
            "key": env.payu_key,
            "txnid": req.txn_id,
            "amount": rupees(req.amount_paise),
            "productinfo": req.product_info,
            "firstname": req.payer.get("name", ""),
            "email": req.payer.get("email") or "customer@example.invalid",
            "phone": req.payer.get("mobile") or "",
            "surl": req.success_url,
            "furl": req.failure_url,
        }
        fields["hash"] = request_hash(fields, env.payu_salt)
        return {"action": f"{env.public_api_url}/mock-gateway/payu/_payment", "method": "POST", "fields": fields}

    def parse_callback(self, body: dict[str, str]) -> CallbackResult:
        hash_valid = bool(body.get("hash")) and response_hash(body, env.payu_salt) == body.get("hash")
        return CallbackResult(
            txn_id=body.get("txnid", ""),
            status=map_payu_status(body.get("status"), body.get("unmappedstatus")),
            hash_valid=hash_valid,
            provider_ref=body.get("mihpayid"),
            amount_paise=paise(body["amount"]) if body.get("amount") else None,
        )

    def verify(self, txn_id: str) -> dict:
        """Simulates PayU's verify_payment server-to-server API."""
        with self.db.tx() as s:
            t = s.scalar(select(MockPayuTxn).where(MockPayuTxn.txnid == txn_id))
        if t is None:
            return {"status": "PENDING"}
        out = {"status": map_payu_status(t.status), "amountPaise": paise(t.amount)}
        if t.mihpayid:
            out["providerRef"] = t.mihpayid
        return out

    def refund(self, txn_id: str, amount_paise: int, refund_ref: str) -> dict:
        with self.db.tx() as s:
            t = s.scalar(select(MockPayuTxn).where(MockPayuTxn.txnid == txn_id))
            if t is None or t.status != "success":
                return {"providerRef": "", "status": "FAILED"}
            stamp = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.") + f"{datetime.now(UTC).microsecond // 1000:03d}Z"
            t.refunds = [*(t.refunds or []), {"refundRef": refund_ref, "amount": rupees(amount_paise), "at": stamp}]
        return {"providerRef": f"RF{refund_ref[:8].upper()}", "status": "SUCCESS"}


class RealPayuAdapter:
    """Placeholder for the real PayU integration (not built in the prototype, D6)."""

    name = "payu"

    def __init__(self, db: Database):
        pass

    def _fail(self, *args, **kwargs):
        raise RuntimeError("Real payment adapter is not implemented. Set PAYMENT_ADAPTER=mock.")

    create_checkout = parse_callback = verify = refund = _fail
