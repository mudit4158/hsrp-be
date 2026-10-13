"""Tables owned by app.utility.reporting (architecture rule 7).

Generated from prisma/schema/util-reporting.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.utility.reporting"


class SavedReport(Base):
    __tablename__ = "util_report_saved"

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    report_code: Mapped[str] = mapped_column("report_code", Text)
    name: Mapped[str] = mapped_column("name", Text)
    params: Mapped[Any] = mapped_column("params", JSONB)
    owner_user_id: Mapped[str | None] = mapped_column("owner_user_id", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
