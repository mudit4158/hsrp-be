from fastapi import Request
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from app.contracts.schemas import FitmentRequest
from app.core.shared.uploads import Photo
from app.platform.http.decorators import idempotent, require
from app.platform.http.problem import Problem
from app.platform.http.routing import router as api_router
from app.platform.registry import services

router = api_router("/fitments", ["fitment"])

MAX_PHOTO = 8 * 1024 * 1024


@router.get("/search")
@require("fitment.record", "orders.read")
def search(regnNo: str | None = None):  # noqa: N803
    return services().fitment.search(regnNo or "")


@router.post("")
@require("fitment.record")
@idempotent
async def record(request: Request):
    """Multipart: fields of FitmentRequest plus photo files `front`, `rear`, `chassis`. Safe to retry with the same
    Idempotency-Key (offline sync)."""
    form = await request.form()
    fields: dict[str, str] = {}
    photos: dict[str, Photo] = {}
    for key, value in form.multi_items():
        if isinstance(value, UploadFile):
            if key in ("front", "rear", "chassis") and key not in photos:
                data = await value.read()
                if len(data) > MAX_PHOTO:
                    raise Problem(413, "PayloadTooLarge", "File too large", "http")
                photos[key] = Photo(data, value.content_type or "application/octet-stream", value.filename)
        else:
            fields[key] = value
    # Parsed here, as the NestJS controller did (a validation error answers 400 validation).
    req = FitmentRequest.model_validate(fields)
    return await run_in_threadpool(services().fitment.record, req, photos)


@router.get("/vahan-pending")
@require("integration.monitor", "orders.read")
def pending():
    return services().fitment.pending_vahan()


@router.post("/vahan-eod-alert")
@require("integration.replay")
def eod_alert():
    return services().fitment.end_of_day_alert(True)
