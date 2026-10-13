from typing import Annotated

from fastapi import Depends, Query

from app.contracts.schemas import CancelOrderRequest, CreateOrderRequest, OemOrderRequest
from app.core.order_intake.orders import NewOrder
from app.platform.context import request_context
from app.platform.http.decorators import api_client_auth, idempotent, require
from app.platform.http.json import ApiModel
from app.platform.http.pagination import Page, page_query
from app.platform.http.problem import Problem
from app.platform.http.routing import router as api_router
from app.platform.registry import services

orders_router = api_router("/orders", ["orders"])
oem_router = api_router("/oem", ["oem"])
oem_vehicles_router = api_router("/oem-vehicles", ["oem"])


class OrderListQuery(ApiModel):
    page: int = 1
    page_size: int = 25
    status: str | None = None
    channel: str | None = None
    dealer_id: str | None = None
    station_id: str | None = None
    state_code: str | None = None
    q: str | None = None
    from_: str | None = None
    to: str | None = None


def _order_list_query(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=500, alias="pageSize"),
    status: str | None = None,
    channel: str | None = None,
    dealer_id: str | None = Query(None, alias="dealerId"),
    station_id: str | None = Query(None, alias="stationId"),
    state_code: str | None = Query(None, alias="stateCode"),
    q: str | None = None,
    from_: str | None = Query(None, alias="from"),
    to: str | None = None,
) -> OrderListQuery:
    return OrderListQuery(
        page=page, page_size=page_size, status=status, channel=channel, dealer_id=dealer_id, station_id=station_id, state_code=state_code, q=q, from_=from_, to=to
    )


@orders_router.post("")
@require("orders.create")
@idempotent
def create(body: CreateOrderRequest):
    """Dealer app / dealer web / staff web order. Dealers order for themselves; staff name the dealer."""
    c = services()
    sc = c.scope.current()
    dealer_id = sc.dealer_id
    if not dealer_id:
        if not sc.all:
            raise Problem.forbidden("Only dealers and staff place orders here")
        if not body.dealer_code:
            raise Problem.bad_request("dealerCode is required for staff orders", "dealer-required")
        dealer_id = c.masters.dealer_by_code(body.dealer_code).id
    oem_id = c.masters.oem_by_code(body.oem_code).id if body.oem_code else None
    with c.db.tx() as s:
        order = c.orders.create(
            s,
            NewOrder(
                regn_no=body.regn_no,
                chassis_no=body.chassis_no,
                engine_no=body.engine_no,
                channel="DEALER_APP" if sc.dealer_id else "STAFF_WEB",
                order_type=body.order_type,
                plate_set=body.plate_set,
                replacement_reason=body.replacement_reason,
                evidence_file_id=body.evidence_file_id,
                state_code=body.state_code,
                owner_name=body.owner_name,
                mobile=body.mobile,
                email=body.email,
                remarks=body.remarks,
                dealer_id=dealer_id,
                oem_id=oem_id,
            ),
        )
        return {"id": order.id, "orderNo": order.order_no, "status": order.status}


@orders_router.get("")
@require("orders.read")
def list_orders(q: OrderListQuery = Depends(_order_list_query)):
    return services().orders.list(q.page, q.page_size, q.status, q.channel, q.dealer_id, q.station_id, q.state_code, q.q, q.from_, q.to)


@orders_router.get("/{id}")
@require("orders.read")
def get(id: str):
    return services().orders.get_scoped(id)


@orders_router.get("/{id}/history")
@require("orders.read")
def history(id: str):
    orders = services().orders
    orders.get_scoped(id)
    return {"history": orders.history(id), "validations": orders.validations(id)}


@orders_router.post("/{id}/cancel", status_code=200)
@require("orders.cancel")
def cancel(id: str, body: CancelOrderRequest):
    return services().order_flow.cancel(id, body.reason)


@orders_router.post("/{id}/retry-confirmation", status_code=200)
@require("orders.create")
def retry(id: str):
    """Re-tries the wallet hold for an order waiting for funds (after a top-up)."""
    c = services()
    c.orders.get_scoped(id)
    c.order_flow.retry_awaiting_funds(id)
    return c.orders.get(id)


@oem_router.post("/{oemCode}/orders", status_code=202)
@api_client_auth
@require("oem.orders.push")
@idempotent
def push(oemCode: str, body: OemOrderRequest):  # noqa: N803
    """OEM order push: X-Api-Key, X-Signature (HMAC-SHA256 of the raw body) and Idempotency-Key."""
    return services().oem_intake.push(oemCode, body.model_dump(by_alias=True))


@oem_router.get("/{oemCode}/orders/{ref}")
@api_client_auth
@require("oem.orders.push")
def status(oemCode: str, ref: str):  # noqa: N803
    actor = request_context.actor()
    if actor is None or actor.type != "api-client":
        raise Problem.forbidden()
    return services().oem_intake.status(oemCode, ref)


@oem_vehicles_router.get("")
@require("masters.read")
def oem_vehicles(q: Annotated[Page, Depends(page_query)]):
    """OEM vehicle data loaded from the OEMs' vehicle data files (staff only)."""
    return services().oem_data.list(q.page, q.page_size, q.get("oemCode"), q.get("q"), q.get("importJobId"))
