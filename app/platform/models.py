"""Tables owned by app.platform (architecture rule 7).

Generated from prisma/schema/base.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, FetchedValue, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.platform"


class Tenant(Base):
    __tablename__ = "platform_tenant"

    id: Mapped[str] = mapped_column("id", Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column("tenantId", Text)
    name: Mapped[str] = mapped_column("name", Text)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
