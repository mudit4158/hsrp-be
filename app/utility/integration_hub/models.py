"""Tables owned by app.utility.integration_hub (architecture rule 7).

Generated from prisma/schema/util-integration-hub.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.utility.integration_hub"


class OutboxEvent(Base):
    """Transactional outbox: written in the same DB transaction as the state change it describes."""

    __tablename__ = "util_hub_outbox_event"
    __table_args__ = (
        Index("util_hub_outbox_event_dispatched_at_seq_idx", "dispatched_at", "seq"),
        Index("util_hub_outbox_event_tenant_id_subject_type_subject_id_idx", "tenant_id", "subject_type", "subject_id"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    seq: Mapped[int] = mapped_column("seq", Integer, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    event_type: Mapped[str] = mapped_column("event_type", Text)
    subject_type: Mapped[str | None] = mapped_column("subject_type", Text, nullable=True)
    subject_id: Mapped[str | None] = mapped_column("subject_id", Text, nullable=True)
    payload: Mapped[Any] = mapped_column("payload", JSONB)
    actor_id: Mapped[str | None] = mapped_column("actor_id", Text, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column("occurred_at", DateTime, default=utcnow)
    dispatched_at: Mapped[datetime | None] = mapped_column("dispatched_at", DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class OutboxDelivery(Base):
    """One row per (event, subscriber). Retried with exponential back-off; DEAD = dead-letter / manual queue."""

    __tablename__ = "util_hub_outbox_delivery"
    __table_args__ = (
        Index("util_hub_outbox_delivery_event_id_subscriber_key", "event_id", "subscriber", unique=True),
        Index("util_hub_outbox_delivery_status_next_attempt_at_idx", "status", "next_attempt_at"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    event_id: Mapped[str] = mapped_column("event_id", Text)
    event_type: Mapped[str] = mapped_column("event_type", Text)
    subscriber: Mapped[str] = mapped_column("subscriber", Text)
    status: Mapped[str] = mapped_column("status", Text, default="PENDING")
    attempts: Mapped[int] = mapped_column("attempts", Integer, default=0)
    max_attempts: Mapped[int] = mapped_column("max_attempts", Integer, default=8)
    next_attempt_at: Mapped[datetime] = mapped_column("next_attempt_at", DateTime, default=utcnow)
    locked_until: Mapped[datetime | None] = mapped_column("locked_until", DateTime, nullable=True)
    last_error: Mapped[str | None] = mapped_column("last_error", Text, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column("completed_at", DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class IdempotencyKey(Base):
    __tablename__ = "util_hub_idempotency_key"
    __table_args__ = (
        Index("util_hub_idempotency_key_tenant_id_scope_key_key", "tenant_id", "scope", "key", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    scope: Mapped[str] = mapped_column("scope", Text)
    key: Mapped[str] = mapped_column("key", Text)
    request_hash: Mapped[str] = mapped_column("request_hash", Text)
    status: Mapped[str] = mapped_column("status", Text, default="IN_PROGRESS")
    response_code: Mapped[int | None] = mapped_column("response_code", Integer, nullable=True)
    response_body: Mapped[Any | None] = mapped_column("response_body", JSONB, nullable=True)
    expires_at: Mapped[datetime] = mapped_column("expires_at", DateTime)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class CallLog(Base):
    __tablename__ = "util_hub_call_log"
    __table_args__ = (
        Index("util_hub_call_log_tenant_id_system_created_at_idx", "tenant_id", "system", "created_at"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    system: Mapped[str] = mapped_column("system", Text)
    operation: Mapped[str] = mapped_column("operation", Text)
    subject_type: Mapped[str | None] = mapped_column("subject_type", Text, nullable=True)
    subject_id: Mapped[str | None] = mapped_column("subject_id", Text, nullable=True)
    request: Mapped[Any | None] = mapped_column("request", JSONB, nullable=True)
    response: Mapped[Any | None] = mapped_column("response", JSONB, nullable=True)
    outcome: Mapped[str] = mapped_column("outcome", Text)
    error: Mapped[str | None] = mapped_column("error", Text, nullable=True)
    duration_ms: Mapped[int] = mapped_column("duration_ms", Integer)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
