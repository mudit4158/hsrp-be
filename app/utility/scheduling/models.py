"""Tables owned by app.utility.scheduling (architecture rule 7).

Generated from prisma/schema/util-scheduling.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, FetchedValue, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.utility.scheduling"


class SchedResource(Base):
    __tablename__ = "util_sched_resource"
    __table_args__ = (
        Index("util_sched_resource_tenant_id_code_key", "tenant_id", "code", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    code: Mapped[str] = mapped_column("code", Text)
    name: Mapped[str] = mapped_column("name", Text)
    subject_type: Mapped[str | None] = mapped_column("subject_type", Text, nullable=True)
    subject_id: Mapped[str | None] = mapped_column("subject_id", Text, nullable=True)
    active: Mapped[bool] = mapped_column("active", Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class SchedCalendarRule(Base):
    """Weekly capacity calendar: on `weekday` (0 = Sunday) slots of `slotMinutes` from start to end, each with `capacity` bookings."""

    __tablename__ = "util_sched_calendar_rule"
    __table_args__ = (
        Index("util_sched_calendar_rule_resource_id_weekday_idx", "resource_id", "weekday"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    resource_id: Mapped[str] = mapped_column("resource_id", Text)
    weekday: Mapped[int] = mapped_column("weekday", Integer)
    start_time: Mapped[str] = mapped_column("start_time", Text)
    end_time: Mapped[str] = mapped_column("end_time", Text)
    slot_minutes: Mapped[int] = mapped_column("slot_minutes", Integer)
    capacity: Mapped[int] = mapped_column("capacity", Integer)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class SchedClosure(Base):
    __tablename__ = "util_sched_closure"
    __table_args__ = (
        Index("util_sched_closure_resource_id_date_key", "resource_id", "date", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    resource_id: Mapped[str] = mapped_column("resource_id", Text)
    date: Mapped[str] = mapped_column("date", Text)
    reason: Mapped[str | None] = mapped_column("reason", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class SchedBooking(Base):
    __tablename__ = "util_sched_booking"
    __table_args__ = (
        Index("util_sched_booking_resource_id_date_slot_start_status_idx", "resource_id", "date", "slot_start", "status"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    resource_id: Mapped[str] = mapped_column("resource_id", Text)
    date: Mapped[str] = mapped_column("date", Text)
    slot_start: Mapped[str] = mapped_column("slot_start", Text)
    status: Mapped[str] = mapped_column("status", Text, default="BOOKED")
    subject_type: Mapped[str] = mapped_column("subject_type", Text)
    subject_id: Mapped[str] = mapped_column("subject_id", Text)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
