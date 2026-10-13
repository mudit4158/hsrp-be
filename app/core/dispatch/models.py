"""Tables owned by app.core.dispatch (architecture rule 7).

Generated from prisma/schema/core-dispatch.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.core.dispatch"


class Challan(Base):
    """Immutable once created: cancel and recreate only. Inwarded once."""

    __tablename__ = "core_dsp_challan"
    __table_args__ = (
        Index("core_dsp_challan_tenant_id_challan_no_key", "tenant_id", "challan_no", unique=True),
        Index("core_dsp_challan_tenant_id_dealer_id_status_idx", "tenant_id", "dealer_id", "status"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    challan_no: Mapped[str] = mapped_column("challan_no", Text)
    station_id: Mapped[str] = mapped_column("station_id", Text)
    dealer_id: Mapped[str] = mapped_column("dealer_id", Text)
    status: Mapped[str] = mapped_column("status", Text, default="CREATED")
    created_by: Mapped[str | None] = mapped_column("created_by", Text, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column("cancel_reason", Text, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column("cancelled_at", DateTime, nullable=True)
    inwarded_at: Mapped[datetime | None] = mapped_column("inwarded_at", DateTime, nullable=True)
    inwarded_by: Mapped[str | None] = mapped_column("inwarded_by", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class ChallanLine(Base):
    __tablename__ = "core_dsp_challan_line"
    __table_args__ = (
        Index("core_dsp_challan_line_challan_id_idx", "challan_id"),
        Index("core_dsp_challan_line_order_id_idx", "order_id"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    challan_id: Mapped[str] = mapped_column("challan_id", Text)
    order_id: Mapped[str] = mapped_column("order_id", Text)
    allocation_id: Mapped[str] = mapped_column("allocation_id", Text)
    laser_code: Mapped[str] = mapped_column("laser_code", Text)
    position: Mapped[str] = mapped_column("position", Text)
    inward_status: Mapped[str] = mapped_column("inward_status", Text, default="PENDING")
    reject_reason: Mapped[str | None] = mapped_column("reject_reason", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
