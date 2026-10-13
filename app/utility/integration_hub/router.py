"""Integration monitor: outbox deliveries, events, external call log, replay."""

from fastapi import Depends
from sqlalchemy import func, select, update

from app.platform.context import request_context
from app.platform.db.base import utcnow
from app.platform.http.decorators import require
from app.platform.http.json import row
from app.platform.http.pagination import Page, page_of, page_query, paginate
from app.platform.http.problem import Problem
from app.platform.http.routing import router as api_router
from app.platform.registry import services as container
from app.utility.integration_hub.models import CallLog, OutboxDelivery, OutboxEvent

router = api_router("/integration", ["integration-monitor"])


@router.get("/summary")
@require("integration.monitor")
def summary():
    tenant_id = request_context.tenant_id()
    with container().db.tx() as s:
        by_status = s.execute(
            select(OutboxDelivery.status, func.count()).where(OutboxDelivery.tenant_id == tenant_id).group_by(OutboxDelivery.status)
        ).all()
        open_ = s.execute(
            select(OutboxDelivery.subscriber, OutboxDelivery.status, func.count())
            .where(OutboxDelivery.tenant_id == tenant_id, OutboxDelivery.status.in_(["PENDING", "FAILED", "RUNNING", "DEAD"]))
            .group_by(OutboxDelivery.subscriber, OutboxDelivery.status)
        ).all()
        undispatched = s.scalar(select(func.count()).select_from(OutboxEvent).where(OutboxEvent.tenant_id == tenant_id, OutboxEvent.dispatched_at.is_(None)))
    return {
        "byStatus": dict(by_status),
        "open": [{"subscriber": sub, "status": st, "count": n} for sub, st, n in open_],
        "undispatchedEvents": undispatched,
        "subscriptions": container().bus.subscriptions(),
    }


@router.get("/deliveries")
@require("integration.monitor")
def deliveries(q: Page = Depends(page_query)):
    stmt = select(OutboxDelivery).where(OutboxDelivery.tenant_id == request_context.tenant_id())
    if q.get("status"):
        stmt = stmt.where(OutboxDelivery.status.in_(q.get("status").split(",")))
    if q.get("subscriber"):
        stmt = stmt.where(OutboxDelivery.subscriber.contains(q.get("subscriber"), autoescape=True))
    if q.get("eventType"):
        stmt = stmt.where(OutboxDelivery.event_type == q.get("eventType"))
    with container().db.tx() as s:
        result = paginate(s, stmt.order_by(OutboxDelivery.updated_at.desc()), q)
        events = {e.id: e for e in s.scalars(select(OutboxEvent).where(OutboxEvent.id.in_([i.event_id for i in result["items"]])))}
    items = []
    for dl in result["items"]:
        e = events.get(dl.event_id)
        items.append({**row(dl), "subjectType": e.subject_type if e else None, "subjectId": e.subject_id if e else None, "payload": e.payload if e else None})
    return page_of(items, result["total"], q)


@router.post("/deliveries/{id}/replay")
@require("integration.replay")
def replay(id: str):
    c = container()
    with c.db.tx() as s:
        dl = s.scalar(select(OutboxDelivery).where(OutboxDelivery.id == id, OutboxDelivery.tenant_id == request_context.tenant_id()))
        if dl is None:
            raise Problem.not_found("Delivery")
        if dl.status in ("DONE", "RUNNING"):
            raise Problem.conflict(f"Delivery is {dl.status}; nothing to replay")
        before = dl.status
        s.execute(
            update(OutboxDelivery)
            .where(OutboxDelivery.id == id)
            .values(status="PENDING", next_attempt_at=utcnow(), attempts=0 if before == "DEAD" else dl.attempts, updated_at=utcnow())
        )
        c.audit.record("integration.replay", "outbox-delivery", id, {"status": before}, {"status": "PENDING"}, s=s)
        s.refresh(dl)
        return dl


@router.post("/subscribers/{subscriber}/replay")
@require("integration.replay")
def replay_all(subscriber: str):
    """Replays every failed or dead delivery of one subscriber, e.g. all VAHAN posts once VAHAN is back."""
    c = container()
    count = c.bus.replay_all(subscriber)
    c.audit.record("integration.replay-all", "outbox-subscriber", subscriber, after={"count": count})
    return {"subscriber": subscriber, "requeued": count}


@router.get("/events")
@require("integration.monitor", "orders.read")
def events(q: Page = Depends(page_query)):
    stmt = select(OutboxEvent).where(OutboxEvent.tenant_id == request_context.tenant_id())
    if q.get("subjectType"):
        stmt = stmt.where(OutboxEvent.subject_type == q.get("subjectType"))
    if q.get("subjectId"):
        stmt = stmt.where(OutboxEvent.subject_id == q.get("subjectId"))
    if q.get("eventType"):
        stmt = stmt.where(OutboxEvent.event_type == q.get("eventType"))
    with container().db.tx() as s:
        return paginate(s, stmt.order_by(OutboxEvent.seq.desc()), q)


@router.get("/calls")
@require("integration.monitor")
def calls(q: Page = Depends(page_query)):
    stmt = select(CallLog).where(CallLog.tenant_id == request_context.tenant_id())
    if q.get("system"):
        stmt = stmt.where(CallLog.system == q.get("system"))
    if q.get("outcome"):
        stmt = stmt.where(CallLog.outcome == q.get("outcome"))
    with container().db.tx() as s:
        return paginate(s, stmt.order_by(CallLog.created_at.desc()), q)
