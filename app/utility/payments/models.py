"""Tables owned by app.utility.payments (architecture rule 7).

Generated from prisma/schema/util-payments.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.utility.payments"


class Payment(Base):
    __tablename__ = "util_pay_payment"
    __table_args__ = (
        Index("util_pay_payment_txn_id_key", "txn_id", unique=True),
        Index("util_pay_payment_tenant_id_subject_type_subject_id_idx", "tenant_id", "subject_type", "subject_id"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    txn_id: Mapped[str] = mapped_column("txn_id", Text)
    provider: Mapped[str] = mapped_column("provider", Text)
    amount_paise: Mapped[int] = mapped_column("amount_paise", Integer)
    currency: Mapped[str] = mapped_column("currency", Text, default="INR")
    product_info: Mapped[str] = mapped_column("product_info", Text)
    payer: Mapped[Any] = mapped_column("payer", JSONB)
    subject_type: Mapped[str] = mapped_column("subject_type", Text)
    subject_id: Mapped[str] = mapped_column("subject_id", Text)
    status: Mapped[str] = mapped_column("status", Text, default="CREATED")
    return_url: Mapped[str] = mapped_column("return_url", Text)
    provider_ref: Mapped[str | None] = mapped_column("provider_ref", Text, nullable=True)
    succeeded_at: Mapped[datetime | None] = mapped_column("succeeded_at", DateTime, nullable=True)
    last_verified_at: Mapped[datetime | None] = mapped_column("last_verified_at", DateTime, nullable=True)
    refunded_paise: Mapped[int] = mapped_column("refunded_paise", Integer, default=0)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class PaymentEvent(Base):
    __tablename__ = "util_pay_event"
    __table_args__ = (
        Index("util_pay_event_tenant_id_payment_id_idx", "tenant_id", "payment_id"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    payment_id: Mapped[str | None] = mapped_column("payment_id", Text, nullable=True)
    txn_id: Mapped[str | None] = mapped_column("txn_id", Text, nullable=True)
    kind: Mapped[str] = mapped_column("kind", Text)
    payload: Mapped[Any] = mapped_column("payload", JSONB)
    hash_valid: Mapped[bool | None] = mapped_column("hash_valid", Boolean, nullable=True)
    result_status: Mapped[str | None] = mapped_column("result_status", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class PaymentRefund(Base):
    __tablename__ = "util_pay_refund"

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    payment_id: Mapped[str] = mapped_column("payment_id", Text)
    amount_paise: Mapped[int] = mapped_column("amount_paise", Integer)
    status: Mapped[str] = mapped_column("status", Text)
    reason: Mapped[str | None] = mapped_column("reason", Text, nullable=True)
    provider_ref: Mapped[str | None] = mapped_column("provider_ref", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
