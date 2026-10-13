"""The mock payment gateway's hosted page (served outside /api/v1, like the NestJS app). Nothing here talks to a real
gateway. On a choice it records the outcome, fires a webhook to the API, and posts the browser back to surl/furl."""

import html
import json
import logging
import secrets
import threading
import urllib.request

from fastapi import Request
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.adapters.models import MockPayuTxn
from app.adapters.payment.payu_hash import request_hash, response_hash
from app.platform.config import env
from app.platform.db.base import new_id, utcnow
from app.platform.http.decorators import public
from app.platform.http.routing import router as api_router
from app.platform.registry import services

log = logging.getLogger("MockPayU")
router = api_router("/mock-gateway/payu", ["mock-gateway"])
router.include_in_schema = False

_STYLE = (
    "body{font-family:system-ui,sans-serif;background:#f3f4f6;margin:0;padding:24px}main{max-width:440px;margin:0 auto;background:#fff;"
    "border-radius:12px;padding:24px;box-shadow:0 1px 4px #0002}h1{font-size:20px;margin:0 0 4px}.tag{display:inline-block;"
    "background:#fef3c7;color:#92400e;font-size:12px;padding:2px 8px;border-radius:99px;margin-bottom:16px}dl{display:grid;"
    "grid-template-columns:auto 1fr;gap:6px 12px;font-size:14px}dt{color:#6b7280}dd{margin:0;font-weight:600}button{width:100%;"
    "padding:12px;margin-top:10px;border:0;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}.ok{background:#16a34a;"
    "color:#fff}.bad{background:#dc2626;color:#fff}.cancel{background:#e5e7eb;color:#111}"
)


def _esc(s: str | None) -> str:
    return html.escape(s or "", quote=True).replace("&#x27;", "&#39;")


def _page(title: str, inner: str, status: int = 200) -> HTMLResponse:
    body = (
        f'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{title}</title><style>{_STYLE}</style></head><body><main>{inner}</main></body></html>"
    )
    return HTMLResponse(body, status_code=status)


async def _form(request: Request) -> dict[str, str]:
    if request.headers.get("content-type", "").startswith("application/json"):
        return {k: str(v) for k, v in (await request.json()).items()}
    return {k: str(v) for k, v in (await request.form()).items()}


@router.post("/_payment", status_code=200)
@public
async def payment(request: Request):
    f = await _form(request)
    if f.get("key") != env.payu_key or request_hash(f, env.payu_salt) != f.get("hash"):
        return _page("Invalid request", "<h1>Invalid payment request</h1><p>Hash check failed. The request was not signed with the merchant salt.</p>", 400)
    now = utcnow()
    with services().db.tx() as s:
        s.execute(
            insert(MockPayuTxn)
            .values(id=new_id(), tenant_id=env.default_tenant_id, txnid=f["txnid"], amount=f["amount"], status="initiated", request=f, created_at=now, updated_at=now)
            .on_conflict_do_update(index_elements=["txnid"], set_={"request": f, "updated_at": now})
        )
    hidden = f'<input type="hidden" name="txnid" value="{_esc(f["txnid"])}">'
    buttons = "".join(
        f'<form method="post" action="complete">{hidden}<input type="hidden" name="outcome" value="{outcome}"><button class="{cls}">{label}</button></form>'
        for outcome, cls, label in (("success", "ok", "Pay (simulate success)"), ("failure", "bad", "Simulate failure"), ("cancel", "cancel", "Cancel"))
    )
    return _page(
        "Mock payment gateway",
        '<h1>Mock payment gateway</h1><span class="tag">Prototype — no real money moves</span>'
        f"<dl><dt>Amount</dt><dd>₹ {_esc(f.get('amount'))}</dd><dt>For</dt><dd>{_esc(f.get('productinfo'))}</dd>"
        f"<dt>Payer</dt><dd>{_esc(f.get('firstname'))}</dd><dt>Txn</dt><dd>{_esc(f.get('txnid'))}</dd></dl>{buttons}",
    )


def _send_webhook(fields: dict[str, str]) -> None:
    try:
        req = urllib.request.Request(
            f"{env.internal_api_url}/api/v1/payments/webhook/payu",
            data=json.dumps(fields).encode(),
            headers={"content-type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=10).close()
    except Exception as e:  # the browser return still queues a verify
        log.warning("Webhook delivery failed: %s", e)


@router.post("/complete", status_code=200)
@public
async def complete(request: Request):
    body = await _form(request)
    with services().db.tx() as s:
        t = s.scalar(select(MockPayuTxn).where(MockPayuTxn.txnid == body.get("txnid")))
        if t is None:
            return _page("Not found", "<h1>Unknown transaction</h1>", 404)
        req = dict(t.request)
        outcome = body.get("outcome")
        status = "success" if outcome == "success" else "failure"
        mihpayid = str(secrets.randbelow(899_999_999) + 100_000_000)
        t.status, t.mihpayid = ("cancelled" if outcome == "cancel" else status), mihpayid
    fields = {
        "key": req.get("key", ""),
        "txnid": req.get("txnid", ""),
        "amount": req.get("amount", ""),
        "productinfo": req.get("productinfo", ""),
        "firstname": req.get("firstname", ""),
        "email": req.get("email", ""),
        "phone": req.get("phone", ""),
        "status": status,
        "mihpayid": mihpayid,
        "mode": "MOCK",
    }
    if outcome == "cancel":
        fields["unmappedstatus"] = "userCancelled"
    fields["hash"] = response_hash(fields, env.payu_salt)

    # Server-to-server webhook, as a real gateway would send independently of the browser.
    threading.Timer(0.3, _send_webhook, args=(fields,)).start()

    target = req.get("surl") if status == "success" else req.get("furl")
    inputs = "".join(f'<input type="hidden" name="{_esc(k)}" value="{_esc(v)}">' for k, v in fields.items())
    return _page(
        "Returning…",
        f'<h1>Returning to the merchant…</h1><form id="f" method="post" action="{_esc(target)}">{inputs}<button class="cancel">Continue</button></form>'
        "<script>document.getElementById('f').submit()</script>",
    )
