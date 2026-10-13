"""Request → approve or reject with mandatory remarks, by role (and optionally by organisation). The decision is
announced as ApprovalDecided { subjectType, subjectId, approvalType, decision }."""

from __future__ import annotations

from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.platform.context import request_context
from app.platform.db.base import utcnow
from app.platform.db.session import Database
from app.platform.http.problem import Problem
from app.utility.approvals.models import ApprovalRequest
from app.utility.audit.service import AuditService
from app.utility.integration_hub.event_bus import EventBus

# Roles that may decide any approval regardless of the required role or organisation scope.
OVERRIDE_ROLES = {"ADMIN"}


class ApprovalsService:
    def __init__(self, db: Database, bus: EventBus, audit: AuditService):
        self.db = db
        self.bus = bus
        self.audit = audit

    def request(
        self,
        s: Session,
        type: str,
        subject_type: str,
        subject_id: str,
        required_role: str,
        title: str,
        details: dict[str, Any] | None = None,
        scope_org_id: str | None = None,
    ) -> ApprovalRequest:
        tenant_id = request_context.tenant_id()
        open_ = s.scalar(
            select(ApprovalRequest).where(
                ApprovalRequest.tenant_id == tenant_id,
                ApprovalRequest.type == type,
                ApprovalRequest.subject_type == subject_type,
                ApprovalRequest.subject_id == subject_id,
                ApprovalRequest.status == "PENDING",
            )
        )
        if open_ is not None:
            return open_
        req = ApprovalRequest(
            tenant_id=tenant_id,
            type=type,
            subject_type=subject_type,
            subject_id=subject_id,
            required_role=required_role,
            scope_org_id=scope_org_id,
            title=title,
            details=details or {},
            requested_by=request_context.actor_id(),
        )
        s.add(req)
        s.flush()
        self.bus.publish(s, "ApprovalRequested", subject_type, subject_id, {"approvalId": req.id, "approvalType": type})
        return req

    def decide(self, id: str, decision: str, remarks: str) -> ApprovalRequest:
        if not remarks or len(remarks.strip()) < 3:
            raise Problem.bad_request("Remarks are mandatory", "remarks-required")
        actor = request_context.actor()
        if actor is None:
            raise Problem.unauthorized()
        with self.db.tx() as s:
            locked = s.execute(select(ApprovalRequest.status).where(ApprovalRequest.id == id).with_for_update()).first()
            req = s.scalar(select(ApprovalRequest).where(ApprovalRequest.id == id, ApprovalRequest.tenant_id == request_context.tenant_id()))
            if req is None or locked is None:
                raise Problem.not_found("Approval request")
            if locked.status != "PENDING":
                raise Problem.conflict(f"Already {locked.status.lower()}", "already-decided")
            override = any(r in OVERRIDE_ROLES for r in actor.roles)
            if not override and req.required_role not in actor.roles:
                raise Problem.forbidden(f"Only {req.required_role} can decide this")
            if not override and req.scope_org_id and actor.org_id != req.scope_org_id:
                raise Problem.forbidden("This request belongs to another organisation")
            status = "APPROVED" if decision == "APPROVE" else "REJECTED"
            req.status, req.remarks, req.decided_by, req.decided_at = status, remarks.strip(), actor.id, utcnow()
            s.flush()
            self.bus.publish(
                s,
                "ApprovalDecided",
                req.subject_type,
                req.subject_id,
                {
                    "approvalId": id,
                    "approvalType": req.type,
                    "decision": status,
                    "remarks": remarks.strip(),
                    "decidedBy": actor.id,
                    "subjectType": req.subject_type,
                    "subjectId": req.subject_id,
                },
            )
            self.audit.record(
                f"approval.{status.lower()}",
                req.subject_type,
                req.subject_id,
                {"status": "PENDING"},
                {"status": status, "remarks": remarks, "approvalId": id, "type": req.type},
                s=s,
            )
            return req

    def list(self, type: str | None = None, status: str | None = None, subject_id: str | None = None, page: int = 1, page_size: int = 100) -> list[ApprovalRequest]:
        actor = request_context.actor()
        override = actor is not None and any(r in OVERRIDE_ROLES or r == "OPERATIONS" for r in actor.roles)
        q = select(ApprovalRequest).where(ApprovalRequest.tenant_id == request_context.tenant_id())
        if type:
            q = q.where(ApprovalRequest.type.in_(type.split(",")))
        if status:
            q = q.where(ApprovalRequest.status == status)
        if subject_id:
            q = q.where(ApprovalRequest.subject_id == subject_id)
        if not override:
            q = q.where(
                ApprovalRequest.required_role.in_(actor.roles if actor else []),
                or_(ApprovalRequest.scope_org_id.is_(None), ApprovalRequest.scope_org_id == ((actor.org_id if actor else None) or "__none__")),
            )
        with self.db.tx() as s:
            return list(s.scalars(q.order_by(ApprovalRequest.created_at.desc()).limit(page_size).offset((page - 1) * page_size)))

    def for_subject(self, subject_type: str, subject_id: str) -> list[ApprovalRequest]:
        with self.db.tx() as s:
            return list(
                s.scalars(
                    select(ApprovalRequest)
                    .where(ApprovalRequest.tenant_id == request_context.tenant_id(), ApprovalRequest.subject_type == subject_type, ApprovalRequest.subject_id == subject_id)
                    .order_by(ApprovalRequest.created_at)
                )
            )
