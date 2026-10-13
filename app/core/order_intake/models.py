"""Tables owned by app.core.order_intake (architecture rule 7).

Generated from prisma/schema/core-orders.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, FetchedValue, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.core.order_intake"


class Order(Base):
    __tablename__ = "core_ord_order"
    __table_args__ = (
        Index("core_ord_order_tenant_id_order_no_key", "tenant_id", "order_no", unique=True),
        Index("core_ord_order_tenant_id_oem_id_source_ref_key", "tenant_id", "oem_id", "source_ref", unique=True),
        Index("core_ord_order_tenant_id_status_idx", "tenant_id", "status"),
        Index("core_ord_order_tenant_id_regn_no_idx", "tenant_id", "regn_no"),
        Index("core_ord_order_tenant_id_dealer_id_status_idx", "tenant_id", "dealer_id", "status"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    order_no: Mapped[str] = mapped_column("order_no", Text)
    channel: Mapped[str] = mapped_column("channel", Text)
    order_type: Mapped[str] = mapped_column("order_type", Text)
    plate_set: Mapped[str] = mapped_column("plate_set", Text, default="BOTH")
    replacement_reason: Mapped[str | None] = mapped_column("replacement_reason", Text, nullable=True)
    evidence_file_id: Mapped[str | None] = mapped_column("evidence_file_id", Text, nullable=True)
    status: Mapped[str] = mapped_column("status", Text)
    state_code: Mapped[str] = mapped_column("state_code", Text)
    regn_no: Mapped[str] = mapped_column("regn_no", Text)
    chassis_no: Mapped[str] = mapped_column("chassis_no", Text)
    engine_no: Mapped[str] = mapped_column("engine_no", Text)
    oem_id: Mapped[str | None] = mapped_column("oem_id", Text, nullable=True)
    dealer_id: Mapped[str | None] = mapped_column("dealer_id", Text, nullable=True)
    station_id: Mapped[str | None] = mapped_column("station_id", Text, nullable=True)
    source_ref: Mapped[str | None] = mapped_column("source_ref", Text, nullable=True)
    vehicle_class: Mapped[str | None] = mapped_column("vehicle_class", Text, nullable=True)
    vehicle_type: Mapped[str | None] = mapped_column("vehicle_type", Text, nullable=True)
    vahan_category: Mapped[str | None] = mapped_column("vahan_category", Text, nullable=True)
    fuel: Mapped[str | None] = mapped_column("fuel", Text, nullable=True)
    maker: Mapped[str | None] = mapped_column("maker", Text, nullable=True)
    norms: Mapped[str | None] = mapped_column("norms", Text, nullable=True)
    regn_date: Mapped[str | None] = mapped_column("regn_date", Text, nullable=True)
    green_strip: Mapped[bool] = mapped_column("green_strip", Boolean, default=False)
    sticker_required: Mapped[bool] = mapped_column("sticker_required", Boolean, default=False)
    front_product_code: Mapped[str | None] = mapped_column("front_product_code", Text, nullable=True)
    rear_product_code: Mapped[str | None] = mapped_column("rear_product_code", Text, nullable=True)
    # Positions still waiting for a plate (all of the plate set at first; only re-issued ones after a rejection).
    pending_positions: Mapped[list[str]] = mapped_column("pending_positions", ARRAY(Text), default=list, nullable=True)
    owner_name: Mapped[str | None] = mapped_column("owner_name", Text, nullable=True)
    mobile: Mapped[str | None] = mapped_column("mobile", Text, nullable=True)
    email: Mapped[str | None] = mapped_column("email", Text, nullable=True)
    amount_paise: Mapped[int | None] = mapped_column("amount_paise", Integer, nullable=True)
    price_snapshot: Mapped[Any | None] = mapped_column("price_snapshot", JSONB(none_as_null=True), nullable=True)
    vahan_snapshot: Mapped[Any | None] = mapped_column("vahan_snapshot", JSONB(none_as_null=True), nullable=True)
    wallet_hold_id: Mapped[str | None] = mapped_column("wallet_hold_id", Text, nullable=True)
    payment_id: Mapped[str | None] = mapped_column("payment_id", Text, nullable=True)
    approval_id: Mapped[str | None] = mapped_column("approval_id", Text, nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column("rejection_reason", Text, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column("cancel_reason", Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column("remarks", Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column("created_by", Text, nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column("confirmed_at", DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column("completed_at", DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class OrderStatusHistory(Base):
    __tablename__ = "core_ord_status_history"
    __table_args__ = (
        Index("core_ord_status_history_order_id_created_at_idx", "order_id", "created_at"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    order_id: Mapped[str] = mapped_column("order_id", Text)
    from_status: Mapped[str | None] = mapped_column("from_status", Text, nullable=True)
    to_status: Mapped[str] = mapped_column("to_status", Text)
    trigger: Mapped[str] = mapped_column("trigger", Text)
    actor_id: Mapped[str | None] = mapped_column("actor_id", Text, nullable=True)
    note: Mapped[str | None] = mapped_column("note", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class OrderValidation(Base):
    __tablename__ = "core_ord_validation"
    __table_args__ = (
        Index("core_ord_validation_order_id_idx", "order_id"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    order_id: Mapped[str] = mapped_column("order_id", Text)
    step: Mapped[str] = mapped_column("step", Text)
    outcome: Mapped[str] = mapped_column("outcome", Text)
    message: Mapped[str | None] = mapped_column("message", Text, nullable=True)
    data: Mapped[Any | None] = mapped_column("data", JSONB(none_as_null=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class VehicleCheck(Base):
    """Customer-portal vehicle check: the VAHAN lookup runs from the outbox; the portal polls this row."""

    __tablename__ = "core_ord_vehicle_check"

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    state_code: Mapped[str] = mapped_column("state_code", Text)
    regn_no: Mapped[str] = mapped_column("regn_no", Text)
    chassis_last5: Mapped[str] = mapped_column("chassis_last5", Text)
    engine_last5: Mapped[str] = mapped_column("engine_last5", Text)
    status: Mapped[str] = mapped_column("status", Text, default="PENDING")
    result: Mapped[Any | None] = mapped_column("result", JSONB(none_as_null=True), nullable=True)
    error: Mapped[str | None] = mapped_column("error", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class OemVehicle(Base):
    """Vehicles an OEM reports as built and supplied to a dealer (OEM vehicle data file). New-vehicle orders are checked against it by the "oem-vehicle-data" validation step: chassis present, engine matches, dealer matches."""

    __tablename__ = "core_ord_oem_vehicle"
    __table_args__ = (
        Index("core_ord_oem_vehicle_tenant_id_oem_id_chassis_no_key", "tenant_id", "oem_id", "chassis_no", unique=True),
        Index("core_ord_oem_vehicle_tenant_id_chassis_no_idx", "tenant_id", "chassis_no"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    oem_id: Mapped[str] = mapped_column("oem_id", Text)
    chassis_no: Mapped[str] = mapped_column("chassis_no", Text)
    engine_no: Mapped[str] = mapped_column("engine_no", Text)
    model: Mapped[str] = mapped_column("model", Text)
    vahan_category: Mapped[str | None] = mapped_column("vahan_category", Text, nullable=True)
    # Dealer the vehicle was supplied to; null for records seeded without one (dealer not checked).
    dealer_id: Mapped[str | None] = mapped_column("dealer_id", Text, nullable=True)
    invoice_no: Mapped[str | None] = mapped_column("invoice_no", Text, nullable=True)
    invoice_date: Mapped[str | None] = mapped_column("invoice_date", Text, nullable=True)
    # FILE (import job in importJobId) or SEED.
    source: Mapped[str] = mapped_column("source", Text, default="FILE")
    import_job_id: Mapped[str | None] = mapped_column("import_job_id", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
