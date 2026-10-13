"""Tables owned by app.core.booking (architecture rule 7).

Generated from prisma/schema/core-booking.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, FetchedValue, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.core.booking"


class Booking(Base):
    __tablename__ = "core_bkg_booking"
    __table_args__ = (
        Index("core_bkg_booking_order_id_key", "order_id", unique=True),
        Index("core_bkg_booking_dealer_id_slot_date_idx", "dealer_id", "slot_date"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    order_id: Mapped[str] = mapped_column("order_id", Text)
    dealer_id: Mapped[str] = mapped_column("dealer_id", Text)
    sched_booking_id: Mapped[str] = mapped_column("sched_booking_id", Text)
    slot_date: Mapped[str] = mapped_column("slot_date", Text)
    slot_start: Mapped[str] = mapped_column("slot_start", Text)
    status: Mapped[str] = mapped_column("status", Text, default="BOOKED")
    reschedule_count: Mapped[int] = mapped_column("reschedule_count", Integer, default=0)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
