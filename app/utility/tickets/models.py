"""Tables owned by app.utility.tickets (architecture rule 7).

Generated from prisma/schema/util-tickets.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.utility.tickets"


class TicketCategory(Base):
    __tablename__ = "util_ticket_category"
    __table_args__ = (
        Index("util_ticket_category_tenant_id_code_key", "tenant_id", "code", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    code: Mapped[str] = mapped_column("code", Text)
    name: Mapped[str] = mapped_column("name", Text)
    sla_days: Mapped[int] = mapped_column("sla_days", Integer)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class Ticket(Base):
    __tablename__ = "util_ticket"
    __table_args__ = (
        Index("util_ticket_ticket_no_key", "ticket_no", unique=True),
        Index("util_ticket_tenant_id_status_idx", "tenant_id", "status"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    ticket_no: Mapped[str] = mapped_column("ticket_no", Text)
    category_code: Mapped[str] = mapped_column("category_code", Text)
    title: Mapped[str] = mapped_column("title", Text)
    description: Mapped[str] = mapped_column("description", Text)
    status: Mapped[str] = mapped_column("status", Text, default="OPEN")
    raised_by_name: Mapped[str] = mapped_column("raised_by_name", Text)
    raised_by_contact: Mapped[str] = mapped_column("raised_by_contact", Text)
    owner_user_id: Mapped[str | None] = mapped_column("owner_user_id", Text, nullable=True)
    subject_type: Mapped[str | None] = mapped_column("subject_type", Text, nullable=True)
    subject_id: Mapped[str | None] = mapped_column("subject_id", Text, nullable=True)
    due_at: Mapped[datetime] = mapped_column("due_at", DateTime)
    resolved_at: Mapped[datetime | None] = mapped_column("resolved_at", DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class TicketEvent(Base):
    __tablename__ = "util_ticket_event"
    __table_args__ = (
        Index("util_ticket_event_ticket_id_idx", "ticket_id"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    ticket_id: Mapped[str] = mapped_column("ticket_id", Text)
    kind: Mapped[str] = mapped_column("kind", Text)
    message: Mapped[str | None] = mapped_column("message", Text, nullable=True)
    from_status: Mapped[str | None] = mapped_column("from_status", Text, nullable=True)
    to_status: Mapped[str | None] = mapped_column("to_status", Text, nullable=True)
    actor: Mapped[str | None] = mapped_column("actor", Text, nullable=True)
    is_public: Mapped[bool] = mapped_column("is_public", Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
