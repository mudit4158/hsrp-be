from app.contracts.schemas import BoxLockRequest
from app.platform.http.decorators import require
from app.platform.http.problem import Problem
from app.platform.http.routing import router as api_router
from app.platform.registry import services

router = api_router("/inventory", ["inventory"])


class LockBody(BoxLockRequest):
    station_id: str


def _station(requested: str | None) -> str | None:
    sc = services().scope.current()
    if sc.all:
        return requested
    if not sc.station_id:
        raise Problem.forbidden()
    if requested and requested != sc.station_id:
        raise Problem.forbidden("That is another station")
    return sc.station_id


@router.get("/stock")
@require("inventory.read")
def stock():
    return services().inventory.stock_by_station()


@router.get("/boxes")
@require("inventory.read")
def boxes(stationId: str | None = None, status: str | None = None, q: str | None = None):  # noqa: N803
    return services().inventory.boxes(_station(stationId), status, q)


@router.get("/plates")
@require("inventory.read")
def plates(boxNo: str | None = None, laserCode: str | None = None, status: str | None = None):  # noqa: N803
    return services().inventory.plates(boxNo, laserCode, status)


@router.get("/plates/{laserCode}/history")
@require("inventory.read", "orders.read")
def history(laserCode: str):  # noqa: N803
    return services().inventory.plate_history(laserCode)


@router.post("/boxes/lock", status_code=200)
@require("station.operate")
def lock(body: LockBody):
    return services().inventory.lock_boxes(_station(body.station_id), body.box_nos)


@router.post("/boxes/release", status_code=200)
@require("station.operate")
def release(body: BoxLockRequest):
    services().inventory.release_boxes(body.box_nos)
    return {"released": body.box_nos}
