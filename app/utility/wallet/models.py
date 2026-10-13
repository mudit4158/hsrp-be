"""Tables owned by app.utility.wallet (architecture rule 7).

Generated from prisma/schema/util-wallet.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.utility.wallet"


class LedgerAccount(Base):
    """Double-entry ledger. Every journal's entries sum to zero. Balances are kept on the account row (updated under a row lock in the same transaction) and can always be recomputed from entries."""

    __tablename__ = "util_wallet_account"
    __table_args__ = (
        Index("util_wallet_account_tenant_id_owner_type_owner_id_kind_key", "tenant_id", "owner_type", "owner_id", "kind", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    owner_type: Mapped[str] = mapped_column("owner_type", Text)
    owner_id: Mapped[str] = mapped_column("owner_id", Text)
    kind: Mapped[str] = mapped_column("kind", Text)
    name: Mapped[str] = mapped_column("name", Text)
    currency: Mapped[str] = mapped_column("currency", Text, default="INR")
    balance_paise: Mapped[int] = mapped_column("balance_paise", Integer, default=0)
    credit_limit_paise: Mapped[int] = mapped_column("credit_limit_paise", Integer, default=0)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class LedgerJournal(Base):
    __tablename__ = "util_wallet_journal"

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    kind: Mapped[str] = mapped_column("kind", Text)
    memo: Mapped[str] = mapped_column("memo", Text)
    reference: Mapped[str | None] = mapped_column("reference", Text, nullable=True)
    subject_type: Mapped[str | None] = mapped_column("subject_type", Text, nullable=True)
    subject_id: Mapped[str | None] = mapped_column("subject_id", Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column("created_by", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class LedgerEntry(Base):
    __tablename__ = "util_wallet_entry"
    __table_args__ = (
        Index("util_wallet_entry_account_id_created_at_idx", "account_id", "created_at"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    journal_id: Mapped[str] = mapped_column("journal_id", Text)
    account_id: Mapped[str] = mapped_column("account_id", Text)
    amount_paise: Mapped[int] = mapped_column("amount_paise", Integer)
    balance_after_paise: Mapped[int] = mapped_column("balance_after_paise", Integer)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class LedgerHold(Base):
    __tablename__ = "util_wallet_hold"
    __table_args__ = (
        Index("util_wallet_hold_wallet_account_id_status_idx", "wallet_account_id", "status"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    wallet_account_id: Mapped[str] = mapped_column("wallet_account_id", Text)
    amount_paise: Mapped[int] = mapped_column("amount_paise", Integer)
    status: Mapped[str] = mapped_column("status", Text, default="HELD")
    subject_type: Mapped[str] = mapped_column("subject_type", Text)
    subject_id: Mapped[str] = mapped_column("subject_id", Text)
    hold_journal_id: Mapped[str] = mapped_column("hold_journal_id", Text)
    settle_journal_id: Mapped[str | None] = mapped_column("settle_journal_id", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
