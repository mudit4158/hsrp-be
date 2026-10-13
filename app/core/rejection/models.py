"""Tables owned by app.core.rejection (architecture rule 7).

Generated from prisma/schema/core-rejection.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.core.rejection"


class RejectionCase(Base):
    __tablename__ = "core_rej_case"
    __table_args__ = (
        Index("core_rej_case_tenant_id_status_idx", "tenant_id", "status"),
        Index("core_rej_case_order_id_idx", "order_id"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    order_id: Mapped[str] = mapped_column("order_id", Text)
    station_id: Mapped[str | None] = mapped_column("station_id", Text, nullable=True)
    source: Mapped[str] = mapped_column("source", Text)
    positions: Mapped[list[str]] = mapped_column("positions", ARRAY(Text), default=list, nullable=True)
    reason: Mapped[str] = mapped_column("reason", Text)
    status: Mapped[str] = mapped_column("status", Text, default="PENDING")
    approval_id: Mapped[str | None] = mapped_column("approval_id", Text, nullable=True)
    # Where the order goes if the station disapproves the rejection.
    return_status: Mapped[str] = mapped_column("return_status", Text)
    challan_id: Mapped[str | None] = mapped_column("challan_id", Text, nullable=True)
    decided_by: Mapped[str | None] = mapped_column("decided_by", Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column("remarks", Text, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column("decided_at", DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
