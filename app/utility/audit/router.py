from fastapi import Depends
from sqlalchemy import select

from app.platform.context import request_context
from app.platform.http.decorators import require
from app.platform.http.pagination import Page, page_query, paginate
from app.platform.http.routing import router as api_router
from app.platform.registry import services
from app.utility.audit.models import AuditLog

router = api_router("/audit", ["audit"])


@router.get("")
@require("audit.read", "orders.read")
def list_audit(q: Page = Depends(page_query)):
    stmt = select(AuditLog).where(AuditLog.tenant_id == request_context.tenant_id())
    if q.get("subjectType"):
        stmt = stmt.where(AuditLog.subject_type == q.get("subjectType"))
    if q.get("subjectId"):
        stmt = stmt.where(AuditLog.subject_id == q.get("subjectId"))
    if q.get("actorId"):
        stmt = stmt.where(AuditLog.actor_id == q.get("actorId"))
    if q.get("action"):
        stmt = stmt.where(AuditLog.action.contains(q.get("action"), autoescape=True))
    with services().db.tx() as s:
        return paginate(s, stmt.order_by(AuditLog.created_at.desc()), q)
