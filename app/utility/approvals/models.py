"""Tables owned by app.utility.approvals (architecture rule 7).

Generated from prisma/schema/util-approvals.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, FetchedValue, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.utility.approvals"


class ApprovalRequest(Base):
    __tablename__ = "util_approval_request"
    __table_args__ = (
        Index("util_approval_request_tenant_id_type_status_idx", "tenant_id", "type", "status"),
        Index("util_approval_request_tenant_id_subject_type_subject_id_idx", "tenant_id", "subject_type", "subject_id"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    type: Mapped[str] = mapped_column("type", Text)
    subject_type: Mapped[str] = mapped_column("subject_type", Text)
    subject_id: Mapped[str] = mapped_column("subject_id", Text)
    required_role: Mapped[str] = mapped_column("required_role", Text)
    scope_org_id: Mapped[str | None] = mapped_column("scope_org_id", Text, nullable=True)
    status: Mapped[str] = mapped_column("status", Text, default="PENDING")
    title: Mapped[str] = mapped_column("title", Text)
    details: Mapped[Any | None] = mapped_column("details", JSONB(none_as_null=True), nullable=True)
    requested_by: Mapped[str | None] = mapped_column("requested_by", Text, nullable=True)
    decided_by: Mapped[str | None] = mapped_column("decided_by", Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column("remarks", Text, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column("decided_at", DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
