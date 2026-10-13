from typing import Annotated

from fastapi import File, Query, UploadFile
from starlette.concurrency import run_in_threadpool

from app.contracts.enums import VehicleClass, VehicleType
from app.contracts.schemas import IssuanceRequest, QcRequest, StickerPrintRequest, SwitchLaserRequest
from app.core.shared.subjects import pdf_response
from app.core.shared.uploads import Photo
from app.platform.http.decorators import require
from app.platform.http.json import ApiModel
from app.platform.http.problem import Problem
from app.platform.http.routing import router as api_router
from app.platform.registry import services

router = api_router("/station", ["station"])

MAX_PHOTO = 8 * 1024 * 1024


class PendingQuery(ApiModel):
    station_id: str | None = None
    dealer_id: str | None = None
    date: str | None = None
    vehicle_class: VehicleClass | None = None
    vehicle_type: VehicleType | None = None


@router.get("/issuance/pending")
@require("station.operate", "station.read")
def pending(q: Annotated[PendingQuery, Query()]):
    return services().production.pending(q.station_id, q.dealer_id, q.date, q.vehicle_class, q.vehicle_type)


@router.post("/issuance")
@require("station.operate")
def issue(body: IssuanceRequest):
    return services().production.issue(body)


@router.get("/job-cards")
@require("station.operate", "station.read")
def job_cards(stationId: str | None = None):  # noqa: N803
    return services().production.job_cards(stationId)


@router.get("/job-cards/{id}/pdf")
@require("station.operate", "station.read")
def job_card_pdf(id: str):
    return pdf_response(*services().production.job_card_pdf(id))


@router.get("/qc")
@require("station.operate", "station.read")
def qc_queue(stationId: str | None = None):  # noqa: N803
    return services().production.qc_queue(stationId)


async def _photo(f: UploadFile | None) -> Photo | None:
    if f is None:
        return None
    data = await f.read()
    if len(data) > MAX_PHOTO:
        raise Problem(413, "PayloadTooLarge", "File too large", "http")
    return Photo(data, f.content_type or "application/octet-stream", f.filename)


@router.post("/qc/{orderId}/plate-photos")
@require("station.operate")
async def plate_photos(orderId: str, front: UploadFile | None = File(None), rear: UploadFile | None = File(None)):  # noqa: N803
    """Multipart: photo files `front` and/or `rear` of the embossed plates; each is read by OCR (D45)."""
    photos = {k: v for k, v in {"FRONT": await _photo(front), "REAR": await _photo(rear)}.items() if v}
    return await run_in_threadpool(services().production.check_plate_photos, orderId, photos)


@router.post("/qc/{orderId}")
@require("station.operate")
def qc(orderId: str, body: QcRequest):  # noqa: N803
    return services().production.qc(orderId, body)


@router.post("/qc/{orderId}/switch-laser")
@require("station.operate")
def switch_laser(orderId: str, body: SwitchLaserRequest):  # noqa: N803
    return services().production.switch_laser(orderId, body.position, body.new_laser_code, body.reason)


@router.get("/stickers")
@require("station.operate", "station.read")
def sticker_queue(stationId: str | None = None):  # noqa: N803
    return services().production.sticker_queue(stationId)


@router.post("/stickers/{orderId}/print")
@require("station.operate")
def print_sticker(orderId: str, body: StickerPrintRequest):  # noqa: N803
    return pdf_response(*services().production.print_sticker(orderId, body.reprint, body.reason))
