"""Tickets with a category, owner, time limit and history."""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.platform.context import request_context
from app.platform.db.base import utcnow
from app.platform.db.session import Database
from app.platform.http.json import row
from app.platform.http.problem import Problem
from app.utility.documents.service import DocumentsService
from app.utility.integration_hub.event_bus import EventBus
from app.utility.tickets.models import Ticket, TicketCategory, TicketEvent

DAY_S = 86400
CLOSED = ("RESOLVED", "CLOSED")


def ageing(created_at: datetime, due_at: datetime, status: str, resolved_at: datetime | None = None, now: datetime | None = None) -> dict[str, Any]:
    """Ageing against the category's time limit."""
    now = now or utcnow()
    end = resolved_at or now
    age_days = math.floor((end - created_at).total_seconds() / DAY_S)
    is_open = status not in CLOSED
    days_left = math.ceil((due_at - now).total_seconds() / DAY_S)
    return {
        "ageDays": age_days,
        "daysLeft": days_left if is_open else None,
        "overdue": now > due_at if is_open else (resolved_at or now) > due_at,
    }


def _with_ageing(t: Ticket) -> dict[str, Any]:
    return {**row(t), **ageing(t.created_at, t.due_at, t.status, t.resolved_at)}


class TicketsService:
    def __init__(self, db: Database, docs: DocumentsService, bus: EventBus):
        self.db = db
        self.docs = docs
        self.bus = bus

    def create(
        self,
        category_code: str,
        title: str,
        description: str,
        raised_by_name: str,
        raised_by_contact: str,
        subject_type: str | None = None,
        subject_id: str | None = None,
        s: Session | None = None,
    ) -> Ticket:
        with self.db.use(s) as tx:
            tenant_id = request_context.tenant_id()
            cat = tx.scalar(select(TicketCategory).where(TicketCategory.tenant_id == tenant_id, TicketCategory.code == category_code))
            if cat is None:
                raise Problem.bad_request("Unknown complaint category", "category-unknown")
            ticket_no = self.docs.next_number("ticket", tx)
            t = Ticket(
                tenant_id=tenant_id,
                ticket_no=ticket_no,
                category_code=category_code,
                title=title,
                description=description,
                raised_by_name=raised_by_name,
                raised_by_contact=raised_by_contact,
                subject_type=subject_type,
                subject_id=subject_id,
                due_at=utcnow() + timedelta(days=cat.sla_days),
            )
            tx.add(t)
            tx.flush()
            tx.add(TicketEvent(tenant_id=tenant_id, ticket_id=t.id, kind="CREATED", message=description, to_status="OPEN", actor=raised_by_name, is_public=True))
            self.bus.publish(tx, "TicketCreated", "ticket", t.id, {"ticketId": t.id, "ticketNo": ticket_no, "contact": raised_by_contact})
            return t

    def reply(self, ticket_id: str, message: str, status: str | None = None, is_public: bool = True) -> Ticket:
        with self.db.tx() as tx:
            t = tx.scalar(select(Ticket).where(Ticket.id == ticket_id, Ticket.tenant_id == request_context.tenant_id()))
            if t is None:
                raise Problem.not_found("Ticket")
            new_status = status or ("IN_PROGRESS" if t.status == "OPEN" else t.status)
            actor = request_context.actor()
            tx.add(
                TicketEvent(
                    tenant_id=t.tenant_id,
                    ticket_id=ticket_id,
                    kind="STATUS" if new_status != t.status else "COMMENT",
                    message=message,
                    from_status=t.status,
                    to_status=new_status,
                    actor=(actor.name if actor else None) or request_context.actor_id(),
                    is_public=is_public,
                )
            )
            t.status = new_status
            t.owner_user_id = t.owner_user_id or request_context.actor_id()
            t.resolved_at = (t.resolved_at or utcnow()) if new_status in CLOSED else None
            tx.flush()
            self.bus.publish(
                tx,
                "TicketUpdated",
                "ticket",
                t.id,
                {"ticketId": t.id, "ticketNo": t.ticket_no, "status": new_status, "contact": t.raised_by_contact, "isPublic": is_public},
            )
            return t

    def by_number(self, ticket_no: str, public_only: bool) -> dict[str, Any]:
        with self.db.tx() as s:
            t = s.scalar(select(Ticket).where(Ticket.ticket_no == ticket_no, Ticket.tenant_id == request_context.tenant_id()))
            if t is None:
                raise Problem.not_found("Ticket")
            q = select(TicketEvent).where(TicketEvent.ticket_id == t.id)
            if public_only:
                q = q.where(TicketEvent.is_public.is_(True))
            events = list(s.scalars(q.order_by(TicketEvent.created_at)))
        return {**_with_ageing(t), "events": events}

    def get(self, id: str) -> dict[str, Any]:
        with self.db.tx() as s:
            t = s.scalar(select(Ticket).where(Ticket.id == id, Ticket.tenant_id == request_context.tenant_id()))
        if t is None:
            raise Problem.not_found("Ticket")
        return self.by_number(t.ticket_no, False)

    def list(self, status: str | None, overdue: bool, page: int, page_size: int) -> dict[str, Any]:
        q = select(Ticket).where(Ticket.tenant_id == request_context.tenant_id())
        if status:
            q = q.where(Ticket.status.in_(status.split(",")))
        if overdue:
            q = q.where(Ticket.due_at < utcnow(), Ticket.status.not_in(CLOSED))
        with self.db.tx() as s:
            total = s.scalar(select(func.count()).select_from(q.subquery())) or 0
            items = s.scalars(q.order_by(Ticket.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
        return {"items": [_with_ageing(t) for t in items], "total": total, "page": page, "pageSize": page_size}

    def categories(self) -> list[TicketCategory]:
        with self.db.tx() as s:
            return list(s.scalars(select(TicketCategory).where(TicketCategory.tenant_id == request_context.tenant_id()).order_by(TicketCategory.name)))
