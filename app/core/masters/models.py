"""Tables owned by app.core.masters (architecture rule 7).

Generated from prisma/schema/core-masters.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.core.masters"


class State(Base):
    __tablename__ = "core_mst_state"
    __table_args__ = (
        Index("core_mst_state_tenant_id_code_key", "tenant_id", "code", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    code: Mapped[str] = mapped_column("code", Text)
    name: Mapped[str] = mapped_column("name", Text)
    rule_pack: Mapped[str] = mapped_column("rule_pack", Text)
    active: Mapped[bool] = mapped_column("active", Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class Company(Base):
    __tablename__ = "core_mst_company"
    __table_args__ = (
        Index("core_mst_company_tenant_id_code_key", "tenant_id", "code", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    code: Mapped[str] = mapped_column("code", Text)
    name: Mapped[str] = mapped_column("name", Text)
    address: Mapped[str | None] = mapped_column("address", Text, nullable=True)
    gstin: Mapped[str | None] = mapped_column("gstin", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class Station(Base):
    __tablename__ = "core_mst_station"
    __table_args__ = (
        Index("core_mst_station_tenant_id_code_key", "tenant_id", "code", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    code: Mapped[str] = mapped_column("code", Text)
    name: Mapped[str] = mapped_column("name", Text)
    company_id: Mapped[str] = mapped_column("company_id", Text)
    state_code: Mapped[str] = mapped_column("state_code", Text)
    city: Mapped[str] = mapped_column("city", Text)
    address: Mapped[str | None] = mapped_column("address", Text, nullable=True)
    org_id: Mapped[str | None] = mapped_column("org_id", Text, nullable=True)
    active: Mapped[bool] = mapped_column("active", Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class Oem(Base):
    __tablename__ = "core_mst_oem"
    __table_args__ = (
        Index("core_mst_oem_tenant_id_code_key", "tenant_id", "code", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    code: Mapped[str] = mapped_column("code", Text)
    name: Mapped[str] = mapped_column("name", Text)
    integration: Mapped[str] = mapped_column("integration", Text)
    requires_catalogue_check: Mapped[bool] = mapped_column("requires_catalogue_check", Boolean, default=False)
    org_id: Mapped[str | None] = mapped_column("org_id", Text, nullable=True)
    wallet_account_id: Mapped[str | None] = mapped_column("wallet_account_id", Text, nullable=True)
    import_profile_code: Mapped[str | None] = mapped_column("import_profile_code", Text, nullable=True)
    active: Mapped[bool] = mapped_column("active", Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class Dealer(Base):
    __tablename__ = "core_mst_dealer"
    __table_args__ = (
        Index("core_mst_dealer_tenant_id_code_key", "tenant_id", "code", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    code: Mapped[str] = mapped_column("code", Text)
    name: Mapped[str] = mapped_column("name", Text)
    state_code: Mapped[str] = mapped_column("state_code", Text)
    city: Mapped[str] = mapped_column("city", Text)
    address: Mapped[str | None] = mapped_column("address", Text, nullable=True)
    mobile: Mapped[str | None] = mapped_column("mobile", Text, nullable=True)
    email: Mapped[str | None] = mapped_column("email", Text, nullable=True)
    station_id: Mapped[str] = mapped_column("station_id", Text)
    org_id: Mapped[str | None] = mapped_column("org_id", Text, nullable=True)
    wallet_group: Mapped[str] = mapped_column("wallet_group", Text)
    wallet_account_id: Mapped[str | None] = mapped_column("wallet_account_id", Text, nullable=True)
    accepts_customer_orders: Mapped[bool] = mapped_column("accepts_customer_orders", Boolean, default=True)
    status: Mapped[str] = mapped_column("status", Text, default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class DealerOem(Base):
    __tablename__ = "core_mst_dealer_oem"
    __table_args__ = (
        Index("core_mst_dealer_oem_dealer_id_oem_id_key", "dealer_id", "oem_id", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    dealer_id: Mapped[str] = mapped_column("dealer_id", Text)
    oem_id: Mapped[str] = mapped_column("oem_id", Text)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class Product(Base):
    __tablename__ = "core_mst_product"
    __table_args__ = (
        Index("core_mst_product_tenant_id_code_key", "tenant_id", "code", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    code: Mapped[str] = mapped_column("code", Text)
    name: Mapped[str] = mapped_column("name", Text)
    size_mm: Mapped[str] = mapped_column("size_mm", Text)
    active: Mapped[bool] = mapped_column("active", Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class VehicleCategory(Base):
    """Maps a VAHAN vehicle category to our vehicle class/type and the plate products it needs."""

    __tablename__ = "core_mst_vehicle_category"
    __table_args__ = (
        Index("core_mst_vehicle_category_tenant_id_vahan_category_key", "tenant_id", "vahan_category", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    vahan_category: Mapped[str] = mapped_column("vahan_category", Text)
    description: Mapped[str] = mapped_column("description", Text)
    vehicle_class: Mapped[str] = mapped_column("vehicle_class", Text)
    vehicle_type: Mapped[str] = mapped_column("vehicle_type", Text)
    front_product_code: Mapped[str] = mapped_column("front_product_code", Text)
    rear_product_code: Mapped[str] = mapped_column("rear_product_code", Text)
    sticker_required: Mapped[bool] = mapped_column("sticker_required", Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
