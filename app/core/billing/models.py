"""Tables owned by app.core.billing (architecture rule 7).

Generated from prisma/schema/core-billing.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, FetchedValue, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.core.billing"


class BillingCharge(Base):
    """A postpaid order's charge (D46). PENDING from confirmation, BILLABLE once its plates are dispatched, BILLED when a bill takes it, VOID when the order is cancelled or rejected before that. Bill-to is fixed at confirmation."""

    __tablename__ = "core_bil_charge"
    __table_args__ = (
        Index("core_bil_charge_order_id_key", "order_id", unique=True),
        Index("core_bil_charge_tenant_id_status_idx", "tenant_id", "status"),
        Index("core_bil_charge_bill_id_idx", "bill_id"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    order_id: Mapped[str] = mapped_column("order_id", Text)
    order_no: Mapped[str] = mapped_column("order_no", Text)
    regn_no: Mapped[str] = mapped_column("regn_no", Text)
    oem_id: Mapped[str] = mapped_column("oem_id", Text)
    dealer_id: Mapped[str | None] = mapped_column("dealer_id", Text, nullable=True)
    bill_to_type: Mapped[str] = mapped_column("bill_to_type", Text)
    bill_to_id: Mapped[str] = mapped_column("bill_to_id", Text)
    bill_to_name: Mapped[str] = mapped_column("bill_to_name", Text)
    amount_paise: Mapped[int] = mapped_column("amount_paise", Integer)
    status: Mapped[str] = mapped_column("status", Text, default="PENDING")
    confirmed_at: Mapped[datetime] = mapped_column("confirmed_at", DateTime)
    dispatched_at: Mapped[datetime | None] = mapped_column("dispatched_at", DateTime, nullable=True)
    bill_id: Mapped[str | None] = mapped_column("bill_id", Text, nullable=True)
    void_reason: Mapped[str | None] = mapped_column("void_reason", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class Bill(Base):
    """One bill to one party (an OEM or a dealer) for one OEM's postpaid orders dispatched in a billing period."""

    __tablename__ = "core_bil_bill"
    __table_args__ = (
        Index("core_bil_bill_tenant_id_bill_no_key", "tenant_id", "bill_no", unique=True),
        Index("core_bil_bill_tenant_id_oem_id_idx", "tenant_id", "oem_id"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    bill_no: Mapped[str] = mapped_column("bill_no", Text)
    oem_id: Mapped[str] = mapped_column("oem_id", Text)
    bill_to_type: Mapped[str] = mapped_column("bill_to_type", Text)
    bill_to_id: Mapped[str] = mapped_column("bill_to_id", Text)
    bill_to_name: Mapped[str] = mapped_column("bill_to_name", Text)
    cycle: Mapped[str] = mapped_column("cycle", Text)
    period_from: Mapped[datetime] = mapped_column("period_from", DateTime)
    period_to: Mapped[datetime] = mapped_column("period_to", DateTime)
    amount_paise: Mapped[int] = mapped_column("amount_paise", Integer)
    line_count: Mapped[int] = mapped_column("line_count", Integer)
    status: Mapped[str] = mapped_column("status", Text, default="ISSUED")
    file_id: Mapped[str | None] = mapped_column("file_id", Text, nullable=True)
    sent_to: Mapped[str | None] = mapped_column("sent_to", Text, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column("sent_at", DateTime, nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column("paid_at", DateTime, nullable=True)
    created_by: Mapped[str | None] = mapped_column("created_by", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class BillingRun(Base):
    """One billing run for one OEM (scheduled cycle close or "Run billing now"); periodTo makes scheduled runs idempotent."""

    __tablename__ = "core_bil_run"
    __table_args__ = (
        Index("core_bil_run_tenant_id_oem_id_period_to_key", "tenant_id", "oem_id", "period_to", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    oem_id: Mapped[str] = mapped_column("oem_id", Text)
    cycle: Mapped[str] = mapped_column("cycle", Text)
    trigger: Mapped[str] = mapped_column("trigger", Text)
    period_from: Mapped[datetime] = mapped_column("period_from", DateTime)
    period_to: Mapped[datetime] = mapped_column("period_to", DateTime)
    bill_count: Mapped[int] = mapped_column("bill_count", Integer)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
