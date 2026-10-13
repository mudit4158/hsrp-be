from fastapi import Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select

from app.platform.context import request_context
from app.platform.http.decorators import public, require
from app.platform.http.pagination import Page, page_query, paginate
from app.platform.http.routing import router as api_router
from app.platform.registry import services
from app.utility.payments.models import Payment, PaymentEvent

router = api_router("/payments", ["payments"])


async def _body(request: Request) -> dict[str, str]:
    """Gateways post a form; tests and tools may send JSON."""
    if request.headers.get("content-type", "").startswith("application/json"):
        data = await request.json()
        return {k: str(v) for k, v in (data or {}).items()}
    form = await request.form()
    return {k: str(v) for k, v in form.items()}


@router.post("/webhook/{provider}", status_code=200)
@public
async def webhook(provider: str, request: Request):
    """Gateway → API server-to-server notification (form or JSON body)."""
    return services().payments.handle_webhook(await _body(request))


@router.post("/return/{provider}")
@public
async def return_post(provider: str, request: Request):
    """Browser return (success and failure URL). Queues a verify and redirects to the caller's return page."""
    return RedirectResponse(services().payments.handle_return(await _body(request)), status_code=303)


@router.post("/{id}/checkout")
@require("payments.pay")
def checkout(id: str):
    return services().payments.checkout(id)


@router.post("/{id}/verify")
@require("payments.pay", "payments.read")
def verify(id: str):
    return services().payments.request_verify(id)


@router.get("")
@require("payments.read")
def list_payments(q: Page = Depends(page_query)):
    stmt = select(Payment).where(Payment.tenant_id == request_context.tenant_id())
    if q.get("status"):
        stmt = stmt.where(Payment.status == q.get("status"))
    with services().db.tx() as s:
        return paginate(s, stmt.order_by(Payment.created_at.desc()), q)


@router.get("/{id}/events")
@require("payments.read")
def events(id: str):
    with services().db.tx() as s:
        return list(s.scalars(select(PaymentEvent).where(PaymentEvent.payment_id == id).order_by(PaymentEvent.created_at)))
