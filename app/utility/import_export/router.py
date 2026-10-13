import json

from fastapi import Depends, File, Form, UploadFile
from fastapi.responses import Response
from sqlalchemy import select

from app.platform.context import request_context
from app.platform.http.decorators import require
from app.platform.http.pagination import Page, page_query, paginate
from app.platform.http.problem import Problem
from app.platform.http.routing import router as api_router
from app.platform.registry import services
from app.utility.import_export.models import ImportJob, ImportProfile

router = api_router("/imports", ["imports"], perms=["imports.run"])


@router.get("/profiles")
def profiles():
    with services().db.tx() as s:
        return list(s.scalars(select(ImportProfile).where(ImportProfile.tenant_id == request_context.tenant_id()).order_by(ImportProfile.code)))


@router.get("/profiles/{code}/template")
def template(code: str):
    t = services().imports.template(code)
    return Response(t["csv"], media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{t["filename"]}"'})


@router.post("")
@require("imports.run")
async def start(file: UploadFile | None = File(None), profileCode: str | None = Form(None), context: str | None = Form(None)):  # noqa: N803
    if file is None:
        raise Problem.bad_request('Attach the CSV in the "file" field')
    if not profileCode:
        raise Problem.bad_request("profileCode is required")
    ctx = None
    if context:
        try:
            ctx = json.loads(context)
        except ValueError:
            raise Problem.bad_request("context must be JSON") from None
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise Problem(413, "Payload too large", "File too large", "http")
    return services().imports.start(profileCode, file.filename or "upload.csv", data, ctx)


@router.get("")
def jobs(q: Page = Depends(page_query)):
    stmt = select(ImportJob).where(ImportJob.tenant_id == request_context.tenant_id())
    if q.get("profileCode"):
        stmt = stmt.where(ImportJob.profile_code == q.get("profileCode"))
    with services().db.tx() as s:
        return paginate(s, stmt.order_by(ImportJob.created_at.desc()), q)


@router.get("/{id}")
def job(id: str):
    imports = services().imports
    return {"job": imports.job(id), "rows": imports.rows(id)}


@router.get("/{id}/error-report")
def error_report(id: str):
    csv = services().imports.error_report(id)
    return Response(csv, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="import-{id}-errors.csv"'})
