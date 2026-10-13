"""Tables owned by app.utility.notification (architecture rule 7).

Generated from prisma/schema/util-notification.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.utility.notification"


class NotifyTemplate(Base):
    __tablename__ = "util_notify_template"
    __table_args__ = (
        Index("util_notify_template_tenant_id_code_channel_key", "tenant_id", "code", "channel", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    code: Mapped[str] = mapped_column("code", Text)
    channel: Mapped[str] = mapped_column("channel", Text)
    sender_id: Mapped[str] = mapped_column("sender_id", Text)
    dlt_template_id: Mapped[str | None] = mapped_column("dlt_template_id", Text, nullable=True)
    subject: Mapped[str | None] = mapped_column("subject", Text, nullable=True)
    body: Mapped[str] = mapped_column("body", Text)
    active: Mapped[bool] = mapped_column("active", Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class NotifyMessage(Base):
    __tablename__ = "util_notify_message"
    __table_args__ = (
        Index("util_notify_message_tenant_id_created_at_idx", "tenant_id", "created_at"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    template_code: Mapped[str] = mapped_column("template_code", Text)
    channel: Mapped[str] = mapped_column("channel", Text)
    recipient: Mapped[str] = mapped_column("recipient", Text)
    sender_id: Mapped[str] = mapped_column("sender_id", Text)
    dlt_template_id: Mapped[str | None] = mapped_column("dlt_template_id", Text, nullable=True)
    subject: Mapped[str | None] = mapped_column("subject", Text, nullable=True)
    body: Mapped[str] = mapped_column("body", Text)
    variables: Mapped[Any] = mapped_column("variables", JSONB)
    status: Mapped[str] = mapped_column("status", Text, default="QUEUED")
    provider_ref: Mapped[str | None] = mapped_column("provider_ref", Text, nullable=True)
    error: Mapped[str | None] = mapped_column("error", Text, nullable=True)
    subject_type: Mapped[str | None] = mapped_column("subject_type", Text, nullable=True)
    subject_id: Mapped[str | None] = mapped_column("subject_id", Text, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column("sent_at", DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
