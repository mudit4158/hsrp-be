"""Tables owned by app.core.pricing (architecture rule 7).

Generated from prisma/schema/core-pricing.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.core.pricing"


class PriceRule(Base):
    """Effective-dated price. Null oemCode / vehicleType = applies to all. Most specific match wins."""

    __tablename__ = "core_price_rule"
    __table_args__ = (
        Index("core_price_rule_tenant_id_state_code_vehicle_class_order_ty_idx", "tenant_id", "state_code", "vehicle_class", "order_type"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    state_code: Mapped[str] = mapped_column("state_code", Text)
    vehicle_class: Mapped[str] = mapped_column("vehicle_class", Text)
    vehicle_type: Mapped[str | None] = mapped_column("vehicle_type", Text, nullable=True)
    oem_code: Mapped[str | None] = mapped_column("oem_code", Text, nullable=True)
    order_type: Mapped[str] = mapped_column("order_type", Text)
    plate_set: Mapped[str] = mapped_column("plate_set", Text, default="BOTH")
    amount_paise: Mapped[int] = mapped_column("amount_paise", Integer)
    published: Mapped[bool] = mapped_column("published", Boolean, default=False)
    effective_from: Mapped[datetime] = mapped_column("effective_from", DateTime)
    effective_to: Mapped[datetime | None] = mapped_column("effective_to", DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class ExtraCharge(Base):
    """Extra charge added on top of the base price when its conditions match (e.g. {"greenStrip": true})."""

    __tablename__ = "core_price_extra_charge"

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    code: Mapped[str] = mapped_column("code", Text)
    name: Mapped[str] = mapped_column("name", Text)
    amount_paise: Mapped[int] = mapped_column("amount_paise", Integer)
    conditions: Mapped[Any] = mapped_column("conditions", JSONB)
    effective_from: Mapped[datetime] = mapped_column("effective_from", DateTime)
    effective_to: Mapped[datetime | None] = mapped_column("effective_to", DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
