"""Tables owned by app.core.production (architecture rule 7).

Generated from prisma/schema/core-production.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, FetchedValue, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.core.production"


class JobCard(Base):
    __tablename__ = "core_prd_job_card"
    __table_args__ = (
        Index("core_prd_job_card_tenant_id_job_card_no_key", "tenant_id", "job_card_no", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    job_card_no: Mapped[str] = mapped_column("job_card_no", Text)
    station_id: Mapped[str] = mapped_column("station_id", Text)
    dealer_id: Mapped[str] = mapped_column("dealer_id", Text)
    order_ids: Mapped[list[str]] = mapped_column("order_ids", ARRAY(Text), default=list, nullable=True)
    box_nos: Mapped[list[str]] = mapped_column("box_nos", ARRAY(Text), default=list, nullable=True)
    plate_count: Mapped[int] = mapped_column("plate_count", Integer)
    created_by: Mapped[str | None] = mapped_column("created_by", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class QcRecord(Base):
    __tablename__ = "core_prd_qc"
    __table_args__ = (
        Index("core_prd_qc_order_id_idx", "order_id"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    order_id: Mapped[str] = mapped_column("order_id", Text)
    result: Mapped[str] = mapped_column("result", Text)
    positions: Mapped[list[str]] = mapped_column("positions", ARRAY(Text), default=list, nullable=True)
    reason: Mapped[str | None] = mapped_column("reason", Text, nullable=True)
    actor_id: Mapped[str | None] = mapped_column("actor_id", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class StickerPrint(Base):
    __tablename__ = "core_prd_sticker_print"
    __table_args__ = (
        Index("core_prd_sticker_print_order_id_print_no_key", "order_id", "print_no", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    order_id: Mapped[str] = mapped_column("order_id", Text)
    print_no: Mapped[int] = mapped_column("print_no", Integer)
    reprint: Mapped[bool] = mapped_column("reprint", Boolean)
    reason: Mapped[str | None] = mapped_column("reason", Text, nullable=True)
    actor_id: Mapped[str | None] = mapped_column("actor_id", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class PlatePhotoCheck(Base):
    """Photo of an embossed plate read by OCR before QC (D45). The plate passes only when the photo reads the order's registration number; QC "Pass" needs a passing check for every plate allocated to the order."""

    __tablename__ = "core_prd_photo_check"
    __table_args__ = (
        Index("core_prd_photo_check_order_id_idx", "order_id"),
        Index("core_prd_photo_check_allocation_id_idx", "allocation_id"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    order_id: Mapped[str] = mapped_column("order_id", Text)
    allocation_id: Mapped[str] = mapped_column("allocation_id", Text)
    laser_code: Mapped[str] = mapped_column("laser_code", Text)
    position: Mapped[str] = mapped_column("position", Text)
    file_id: Mapped[str] = mapped_column("file_id", Text)
    expected: Mapped[str] = mapped_column("expected", Text)
    read_text: Mapped[str | None] = mapped_column("read_text", Text, nullable=True)
    confidence: Mapped[int | None] = mapped_column("confidence", Integer, nullable=True)
    engine: Mapped[str] = mapped_column("engine", Text)
    result: Mapped[str] = mapped_column("result", Text)
    reason: Mapped[str] = mapped_column("reason", Text)
    actor_id: Mapped[str | None] = mapped_column("actor_id", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
