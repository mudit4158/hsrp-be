from app.platform.http.decorators import require
from app.platform.http.json import row
from app.platform.http.routing import router as api_router
from app.platform.registry import services

router = api_router("/rejections", ["rejections"])


@router.get("")
@require("approvals.read", "station.operate")
def list_rejections(status: str | None = None):
    """Rejection approval queue, enriched with the order. Decide through POST /approvals/:approvalId/decision."""
    c = services()
    sc = c.scope.current()
    filters = {}
    if status:
        filters["status"] = status
    if sc.station_id:
        filters["station_id"] = sc.station_id
    cases = c.rejections.list(filters)
    orders = {o.id: o for o in c.orders.by_ids(list({x.order_id for x in cases}))}
    out = []
    for x in cases:
        o = orders.get(x.order_id)
        out.append({**row(x), "orderNo": o.order_no if o else None, "regnNo": o.regn_no if o else None, "orderStatus": o.status if o else None})
    return out
