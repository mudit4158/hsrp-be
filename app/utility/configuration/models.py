"""Tables owned by app.utility.configuration (architecture rule 7).

Generated from prisma/schema/util-configuration.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, FetchedValue, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.utility.configuration"


class ConfigSetting(Base):
    __tablename__ = "util_config_setting"
    __table_args__ = (
        Index("util_config_setting_tenant_id_key_idx", "tenant_id", "key"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    key: Mapped[str] = mapped_column("key", Text)
    scope_type: Mapped[str] = mapped_column("scope_type", Text)
    scope_id: Mapped[str] = mapped_column("scope_id", Text)
    value: Mapped[Any] = mapped_column("value", JSONB(none_as_null=True))
    effective_from: Mapped[datetime] = mapped_column("effective_from", DateTime, default=utcnow)
    effective_to: Mapped[datetime | None] = mapped_column("effective_to", DateTime, nullable=True)
    created_by: Mapped[str | None] = mapped_column("created_by", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
