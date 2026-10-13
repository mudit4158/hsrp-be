from typing import Annotated

from fastapi import Depends
from pydantic import StringConstraints
from sqlalchemy import select

from app.platform.context import request_context
from app.platform.http.decorators import require
from app.platform.http.json import ApiModel, row
from app.platform.http.pagination import Page, page_query, paginate
from app.platform.http.problem import Problem
from app.platform.http.routing import router as api_router
from app.platform.registry import services
from app.utility.notification.models import NotifyMessage, NotifyTemplate

router = api_router("/notifications", ["notification"])


class TemplatePatchBody(ApiModel):
    body: Annotated[str, StringConstraints(min_length=2)] | None = None
    subject: str | None = None
    sender_id: str | None = None
    dlt_template_id: str | None = None
    active: bool | None = None


@router.get("/messages")
@require("notifications.read")
def messages(q: Page = Depends(page_query)):
    stmt = select(NotifyMessage).where(NotifyMessage.tenant_id == request_context.tenant_id())
    if q.get("channel"):
        stmt = stmt.where(NotifyMessage.channel == q.get("channel"))
    if q.get("recipient"):
        stmt = stmt.where(NotifyMessage.recipient.contains(q.get("recipient"), autoescape=True))
    if q.get("templateCode"):
        stmt = stmt.where(NotifyMessage.template_code == q.get("templateCode"))
    with services().db.tx() as s:
        return paginate(s, stmt.order_by(NotifyMessage.created_at.desc()), q)


@router.get("/templates")
@require("notifications.read")
def templates():
    with services().db.tx() as s:
        return list(s.scalars(select(NotifyTemplate).where(NotifyTemplate.tenant_id == request_context.tenant_id()).order_by(NotifyTemplate.code)))


@router.patch("/templates/{id}")
@require("config.manage")
def patch_template(id: str, body: TemplatePatchBody):
    patch = body.model_dump(exclude_unset=True)
    c = services()
    with c.db.tx() as s:
        tpl = s.scalar(select(NotifyTemplate).where(NotifyTemplate.id == id, NotifyTemplate.tenant_id == request_context.tenant_id()))
        if tpl is None:
            raise Problem(404, "Not found", "Record not found", "not-found")
        before = row(tpl)
        for k, v in patch.items():
            setattr(tpl, k, v)
        s.flush()
        c.audit.record("notification.template.update", "notify-template", id, before, row(tpl), s=s)
        return tpl
