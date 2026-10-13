from fastapi import File, Form, UploadFile
from fastapi.responses import Response

from app.platform.http.decorators import public, require
from app.platform.http.json import row
from app.platform.http.problem import Problem
from app.platform.http.routing import router as api_router
from app.platform.registry import services

router = api_router("/files", ["files"])


@router.post("")
@require("files.upload")
async def upload(file: UploadFile | None = File(None), purpose: str | None = Form(None)):
    if file is None:
        raise Problem.bad_request('Attach a file in the "file" field')
    data = await file.read()
    files = services().files
    f = files.upload(data, file.filename or "file", file.content_type or "application/octet-stream", purpose)
    return {"id": f.id, "filename": f.filename, "mimeType": f.mime_type, "sizeBytes": f.size_bytes, "url": files.signed_path(f.id)}


@router.get("/{id}")
@require("files.read")
def meta(id: str):
    files = services().files
    f = files.meta(id)
    return {**row(f), "url": files.signed_path(f.id)}


@router.get("/{id}/content")
@public
def content(id: str, exp: str | None = None, sig: str | None = None):
    files = services().files
    try:
        expires = int(float(exp)) if exp else 0
    except ValueError:
        expires = 0
    files.verify_link(id, expires, sig)
    f, data = files.read(id)
    filename = f.filename.replace('"', "")
    return Response(data, media_type=f.mime_type, headers={"Content-Disposition": f'inline; filename="{filename}"'})
