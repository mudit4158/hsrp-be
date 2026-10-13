from datetime import UTC, datetime
from typing import Annotated

from fastapi import Request
from fastapi.responses import Response
from pydantic import StringConstraints

from app.platform.http.decorators import require
from app.platform.http.json import ApiModel
from app.platform.http.routing import router as api_router
from app.platform.registry import services

router = api_router("/reports", ["reports"], perms=["reports.read"])


class SaveReportBody(ApiModel):
    report_code: str
    name: Annotated[str, StringConstraints(min_length=2, max_length=100)]
    params: dict[str, str]


@router.get("")
def list_reports():
    return services().reporting.list()


@router.get("/saved")
def saved():
    return services().reporting.saved()


@router.post("/saved")
@require("reports.read")
def save(body: SaveReportBody):
    return services().reporting.save(body.report_code, body.name, body.params)


@router.get("/{code}")
def run(code: str, request: Request):
    return services().reporting.run(code, dict(request.query_params))


@router.get("/{code}/csv")
def csv(code: str, request: Request):
    body = services().reporting.csv(code, dict(request.query_params))
    day = datetime.now(UTC).strftime("%Y-%m-%d")
    return Response(body, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{code}-{day}.csv"'})
