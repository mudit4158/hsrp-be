"""Append-only audit trail: who did what to which subject, with before/after, device and IP."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.platform.context import request_context
from app.platform.db.session import Database
from app.platform.http.json import to_jsonable
from app.utility.audit.models import AuditLog


class AuditService:
    def __init__(self, db: Database):
        self.db = db

    def record(
        self,
        action: str,
        subject_type: str | None = None,
        subject_id: str | None = None,
        before: Any = None,
        after: Any = None,
        *,
        actor_id: str | None = None,
        actor_type: str | None = None,
        actor_name: str | None = None,
        s: Session | None = None,
    ) -> None:
        """`actor_*` override the caller (e.g. a failed login, where nobody is signed in yet). Pass `s` to write in the caller's transaction."""
        ctx = request_context.get()
        actor = ctx.actor
        with self.db.use(s) as session:
            session.add(
                AuditLog(
                    tenant_id=ctx.tenant_id,
                    actor_id=actor_id or (actor.id if actor else None),
                    actor_type=actor_type or (actor.type if actor else "anonymous"),
                    actor_name=actor_name or (actor.name if actor else None),
                    action=action,
                    subject_type=subject_type,
                    subject_id=subject_id,
                    before=to_jsonable(before),
                    after=to_jsonable(after),
                    device=ctx.device_id,
                    ip=ctx.ip,
                )
            )
            session.flush()

    def for_subject(self, subject_type: str, subject_id: str) -> list[AuditLog]:
        with self.db.tx() as s:
            return list(
                s.scalars(
                    select(AuditLog)
                    .where(AuditLog.tenant_id == request_context.tenant_id(), AuditLog.subject_type == subject_type, AuditLog.subject_id == subject_id)
                    .order_by(AuditLog.created_at)
                    .limit(500)
                )
            )
