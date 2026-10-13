"""Tables owned by app.core.inventory (architecture rule 7).

Generated from prisma/schema/core-inventory.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.core.inventory"


class PlateBox(Base):
    __tablename__ = "core_inv_box"
    __table_args__ = (
        Index("core_inv_box_tenant_id_box_no_key", "tenant_id", "box_no", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    box_no: Mapped[str] = mapped_column("box_no", Text)
    station_id: Mapped[str] = mapped_column("station_id", Text)
    product_code: Mapped[str] = mapped_column("product_code", Text)
    plate_count: Mapped[int] = mapped_column("plate_count", Integer)
    status: Mapped[str] = mapped_column("status", Text, default="OPEN")
    locked_by: Mapped[str | None] = mapped_column("locked_by", Text, nullable=True)
    locked_until: Mapped[datetime | None] = mapped_column("locked_until", DateTime, nullable=True)
    received_at: Mapped[datetime] = mapped_column("received_at", DateTime, default=utcnow)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class Plate(Base):
    __tablename__ = "core_inv_plate"
    __table_args__ = (
        Index("core_inv_plate_tenant_id_laser_code_key", "tenant_id", "laser_code", unique=True),
        Index("core_inv_plate_box_id_status_idx", "box_id", "status"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    laser_code: Mapped[str] = mapped_column("laser_code", Text)
    box_id: Mapped[str] = mapped_column("box_id", Text)
    station_id: Mapped[str] = mapped_column("station_id", Text)
    product_code: Mapped[str] = mapped_column("product_code", Text)
    status: Mapped[str] = mapped_column("status", Text, default="AVAILABLE")
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class PlateAllocation(Base):
    """History of laser code ↔ order allocations. A partial unique index (migration 0002) allows only one ACTIVE row per laser code and per (order, position)."""

    __tablename__ = "core_inv_allocation"
    __table_args__ = (
        Index("core_inv_allocation_order_id_idx", "order_id"),
        Index("core_inv_allocation_laser_code_idx", "laser_code"),
        Index("core_inv_allocation_active_laser_code", "tenant_id", "laser_code", unique=True, postgresql_where=text("status = 'ACTIVE'")),
        Index("core_inv_allocation_active_order_position", "order_id", "position", unique=True, postgresql_where=text("status = 'ACTIVE'")),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    plate_id: Mapped[str] = mapped_column("plate_id", Text)
    laser_code: Mapped[str] = mapped_column("laser_code", Text)
    order_id: Mapped[str] = mapped_column("order_id", Text)
    position: Mapped[str] = mapped_column("position", Text)
    status: Mapped[str] = mapped_column("status", Text, default="ACTIVE")
    job_card_id: Mapped[str | None] = mapped_column("job_card_id", Text, nullable=True)
    close_reason: Mapped[str | None] = mapped_column("close_reason", Text, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column("closed_at", DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
