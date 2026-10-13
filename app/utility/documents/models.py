"""Tables owned by app.utility.documents (architecture rule 7).

Generated from prisma/schema/util-documents.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.utility.documents"


class DocTemplate(Base):
    __tablename__ = "util_doc_template"
    __table_args__ = (
        Index("util_doc_template_tenant_id_code_key", "tenant_id", "code", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    code: Mapped[str] = mapped_column("code", Text)
    name: Mapped[str] = mapped_column("name", Text)
    page_size: Mapped[str] = mapped_column("page_size", Text, default="A4")
    layout: Mapped[Any] = mapped_column("layout", JSONB)
    version: Mapped[int] = mapped_column("version", Integer, default=1)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class DocSequence(Base):
    __tablename__ = "util_doc_sequence"
    __table_args__ = (
        Index("util_doc_sequence_tenant_id_name_key", "tenant_id", "name", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    name: Mapped[str] = mapped_column("name", Text)
    prefix: Mapped[str] = mapped_column("prefix", Text)
    next_value: Mapped[int] = mapped_column("next_value", Integer, default=1)
    padding: Mapped[int] = mapped_column("padding", Integer, default=6)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
