"""Tables owned by app.core.fitment (architecture rule 7).

Generated from prisma/schema/core-fitment.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, FetchedValue, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.core.fitment"


class Fitment(Base):
    __tablename__ = "core_fit_fitment"
    __table_args__ = (
        Index("core_fit_fitment_order_id_key", "order_id", unique=True),
        Index("core_fit_fitment_tenant_id_vahan_status_idx", "tenant_id", "vahan_status"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    order_id: Mapped[str] = mapped_column("order_id", Text)
    dealer_id: Mapped[str] = mapped_column("dealer_id", Text)
    front_laser_code: Mapped[str | None] = mapped_column("front_laser_code", Text, nullable=True)
    rear_laser_code: Mapped[str | None] = mapped_column("rear_laser_code", Text, nullable=True)
    front_photo_id: Mapped[str | None] = mapped_column("front_photo_id", Text, nullable=True)
    rear_photo_id: Mapped[str | None] = mapped_column("rear_photo_id", Text, nullable=True)
    chassis_photo_id: Mapped[str | None] = mapped_column("chassis_photo_id", Text, nullable=True)
    fitted_at: Mapped[datetime] = mapped_column("fitted_at", DateTime)
    recorded_by: Mapped[str | None] = mapped_column("recorded_by", Text, nullable=True)
    device_id: Mapped[str | None] = mapped_column("device_id", Text, nullable=True)
    latitude: Mapped[float | None] = mapped_column("latitude", Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column("longitude", Float, nullable=True)
    vahan_status: Mapped[str] = mapped_column("vahan_status", Text, default="PENDING")
    vahan_reply: Mapped[str | None] = mapped_column("vahan_reply", Text, nullable=True)
    posted_at: Mapped[datetime | None] = mapped_column("posted_at", DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class FitmentPhotoCheck(Base):
    """Every OCR reading of a fitment photo (D45), kept also when the fitment is refused because a plate photo does not read the order's registration number. fitmentId is set when the fitment was recorded."""

    __tablename__ = "core_fit_photo_check"
    __table_args__ = (
        Index("core_fit_photo_check_order_id_idx", "order_id"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    order_id: Mapped[str] = mapped_column("order_id", Text)
    fitment_id: Mapped[str | None] = mapped_column("fitment_id", Text, nullable=True)
    position: Mapped[str] = mapped_column("position", Text)
    file_id: Mapped[str | None] = mapped_column("file_id", Text, nullable=True)
    expected: Mapped[str] = mapped_column("expected", Text)
    read_text: Mapped[str | None] = mapped_column("read_text", Text, nullable=True)
    confidence: Mapped[int | None] = mapped_column("confidence", Integer, nullable=True)
    engine: Mapped[str] = mapped_column("engine", Text)
    result: Mapped[str] = mapped_column("result", Text)
    reason: Mapped[str] = mapped_column("reason", Text)
    actor_id: Mapped[str | None] = mapped_column("actor_id", Text, nullable=True)
    device_id: Mapped[str | None] = mapped_column("device_id", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
