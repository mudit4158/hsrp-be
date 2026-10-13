from app.contracts.schemas import CancelOrderRequest, CreateChallanRequest, InwardRequest
from app.core.shared.subjects import pdf_response
from app.platform.http.decorators import idempotent, require
from app.platform.http.problem import Problem
from app.platform.http.routing import router as api_router
from app.platform.registry import services

router = api_router("/dispatch", ["dispatch"])


def _station(requested: str | None) -> str:
    sc = services().scope.current()
    if sc.station_id:
        return sc.station_id
    if not sc.all or not requested:
        raise Problem.bad_request("stationId is required", "station-required")
    return requested


@router.get("/ready")
@require("station.operate", "station.read")
def ready(stationId: str | None = None, dealerId: str | None = None):  # noqa: N803
    return services().dispatch.ready(_station(stationId), dealerId)


@router.post("/challans")
@require("station.operate")
def create(body: CreateChallanRequest):
    return services().dispatch.create(_station(body.station_id), body.dealer_id, body.order_ids)


@router.get("/challans")
@require("orders.read")
def list_challans(status: str | None = None, dealerId: str | None = None, stationId: str | None = None):  # noqa: N803
    return services().dispatch.list(status, dealerId, stationId)


@router.get("/challans/{id}")
@require("orders.read")
def get(id: str):
    return services().dispatch.get(id)


@router.get("/challans/{id}/pdf")
@require("orders.read")
def pdf(id: str):
    return pdf_response(*services().dispatch.pdf(id))


@router.post("/challans/{id}/cancel", status_code=200)
@require("station.operate")
def cancel(id: str, body: CancelOrderRequest):
    return services().dispatch.cancel(id, body.reason)


@router.post("/challans/{id}/inward", status_code=200)
@require("inward.record")
@idempotent
def inward(id: str, body: InwardRequest):
    return services().dispatch.inward(id, body)
