from typing import Annotated, Any

from pydantic import ConfigDict, StringConstraints

from app.platform.http.decorators import require
from app.platform.http.json import ApiModel
from app.platform.http.routing import router as api_router
from app.platform.registry import services

router = api_router("/documents", ["documents"])


class LayoutBody(ApiModel):
    # Other layout keys (page, margin, repeatFor) pass through, as with zod's passthrough().
    model_config = ConfigDict(extra="allow")
    elements: list[dict[str, Any]]


class TemplateBody(ApiModel):
    name: Annotated[str, StringConstraints(min_length=2)]
    layout: LayoutBody


@router.get("/templates")
@require("config.read", "config.manage")
def list_templates():
    return services().documents.list_templates()


@router.put("/templates/{code}")
@require("config.manage")
def put_template(code: str, body: TemplateBody):
    c = services()
    layout = body.layout.model_dump(by_alias=True)
    t = c.documents.upsert_template(code, body.name, layout)
    c.audit.record("document.template.update", "doc-template", code, after=layout)
    return t
