"""Tables owned by app.utility.audit (architecture rule 7).

Generated from prisma/schema/util-audit.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.utility.audit"


class AuditLog(Base):
    """Append-only. A database trigger rejects UPDATE and DELETE (see migration 0002)."""

    __tablename__ = "util_audit_log"
    __table_args__ = (
        Index("util_audit_log_tenant_id_subject_type_subject_id_idx", "tenant_id", "subject_type", "subject_id"),
        Index("util_audit_log_tenant_id_created_at_idx", "tenant_id", "created_at"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    actor_id: Mapped[str | None] = mapped_column("actor_id", Text, nullable=True)
    actor_type: Mapped[str] = mapped_column("actor_type", Text)
    actor_name: Mapped[str | None] = mapped_column("actor_name", Text, nullable=True)
    action: Mapped[str] = mapped_column("action", Text)
    subject_type: Mapped[str | None] = mapped_column("subject_type", Text, nullable=True)
    subject_id: Mapped[str | None] = mapped_column("subject_id", Text, nullable=True)
    before: Mapped[Any | None] = mapped_column("before", JSONB, nullable=True)
    after: Mapped[Any | None] = mapped_column("after", JSONB, nullable=True)
    device: Mapped[str | None] = mapped_column("device", Text, nullable=True)
    ip: Mapped[str | None] = mapped_column("ip", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow)
