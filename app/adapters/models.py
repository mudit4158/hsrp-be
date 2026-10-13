"""Tables owned by app.adapters (architecture rule 7).

Generated from prisma/schema/adapters-mock.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, FetchedValue, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.adapters"


class MockVahanVehicle(Base):
    """Fictional VAHAN records served by the mock VehicleRegistry."""

    __tablename__ = "adp_mock_vahan_vehicle"
    __table_args__ = (
        Index("adp_mock_vahan_vehicle_regn_no_key", "regn_no", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    regn_no: Mapped[str] = mapped_column("regn_no", Text)
    chassis_no: Mapped[str] = mapped_column("chassis_no", Text)
    engine_no: Mapped[str] = mapped_column("engine_no", Text)
    state_cd: Mapped[str] = mapped_column("state_cd", Text)
    off_cd: Mapped[str] = mapped_column("off_cd", Text)
    maker: Mapped[str] = mapped_column("maker", Text)
    fuel: Mapped[str] = mapped_column("fuel", Text)
    vch_type: Mapped[str] = mapped_column("vch_type", Text)
    vch_catg: Mapped[str] = mapped_column("vch_catg", Text)
    norms: Mapped[str] = mapped_column("norms", Text)
    regn_date: Mapped[str] = mapped_column("regn_date", Text)
    hsrp_front_laser_code: Mapped[str | None] = mapped_column("hsrp_front_laser_code", Text, nullable=True)
    hsrp_rear_laser_code: Mapped[str | None] = mapped_column("hsrp_rear_laser_code", Text, nullable=True)
    scenario: Mapped[str | None] = mapped_column("scenario", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class MockOemCatalogue(Base):
    __tablename__ = "adp_mock_oem_catalogue"
    __table_args__ = (
        Index("adp_mock_oem_catalogue_oem_code_chassis_no_key", "oem_code", "chassis_no", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    oem_code: Mapped[str] = mapped_column("oem_code", Text)
    chassis_no: Mapped[str] = mapped_column("chassis_no", Text)
    model: Mapped[str] = mapped_column("model", Text)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class MockSetting(Base):
    __tablename__ = "adp_mock_setting"

    key: Mapped[str] = mapped_column("key", Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    value: Mapped[Any] = mapped_column("value", JSONB(none_as_null=True))
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class MockPayuTxn(Base):
    __tablename__ = "adp_mock_payu_txn"
    __table_args__ = (
        Index("adp_mock_payu_txn_txnid_key", "txnid", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    txnid: Mapped[str] = mapped_column("txnid", Text)
    amount: Mapped[str] = mapped_column("amount", Text)
    status: Mapped[str] = mapped_column("status", Text, default="initiated")
    mihpayid: Mapped[str | None] = mapped_column("mihpayid", Text, nullable=True)
    request: Mapped[Any] = mapped_column("request", JSONB(none_as_null=True))
    refunds: Mapped[Any | None] = mapped_column("refunds", JSONB(none_as_null=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class MockOutboundMessage(Base):
    """Every SMS and email "sent" by the mock MessageSender. Nothing leaves the machine."""

    __tablename__ = "adp_mock_outbound_message"

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    channel: Mapped[str] = mapped_column("channel", Text)
    to: Mapped[str] = mapped_column("to", Text)
    sender_id: Mapped[str] = mapped_column("sender_id", Text)
    dlt_template_id: Mapped[str | None] = mapped_column("dlt_template_id", Text, nullable=True)
    subject: Mapped[str | None] = mapped_column("subject", Text, nullable=True)
    body: Mapped[str] = mapped_column("body", Text)
    provider_ref: Mapped[str] = mapped_column("provider_ref", Text)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class MockOemCallback(Base):
    """Status callbacks the mock OrderSource "sent" back to OEM systems."""

    __tablename__ = "adp_mock_oem_callback"

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    oem_code: Mapped[str] = mapped_column("oem_code", Text)
    order_ref: Mapped[str] = mapped_column("order_ref", Text)
    status: Mapped[str] = mapped_column("status", Text)
    reason: Mapped[str | None] = mapped_column("reason", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class FileBlob(Base):
    """Bytes for the database-backed FileStore (decision D13)."""

    __tablename__ = "adp_filestore_blob"

    key: Mapped[str] = mapped_column("key", Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    data: Mapped[bytes] = mapped_column("data", LargeBinary)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
