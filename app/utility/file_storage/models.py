"""Tables owned by app.utility.file_storage (architecture rule 7).

Generated from prisma/schema/util-file-storage.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.utility.file_storage"


class FileObject(Base):
    __tablename__ = "util_file_object"
    __table_args__ = (
        Index("util_file_object_tenant_id_owner_subject_type_owner_subject_idx", "tenant_id", "owner_subject_type", "owner_subject_id"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    filename: Mapped[str] = mapped_column("filename", Text)
    mime_type: Mapped[str] = mapped_column("mime_type", Text)
    size_bytes: Mapped[int] = mapped_column("size_bytes", Integer)
    sha256: Mapped[str] = mapped_column("sha256", Text)
    storage_key: Mapped[str] = mapped_column("storage_key", Text)
    purpose: Mapped[str | None] = mapped_column("purpose", Text, nullable=True)
    owner_subject_type: Mapped[str | None] = mapped_column("owner_subject_type", Text, nullable=True)
    owner_subject_id: Mapped[str | None] = mapped_column("owner_subject_id", Text, nullable=True)
    retention_until: Mapped[datetime | None] = mapped_column("retention_until", DateTime, nullable=True)
    created_by: Mapped[str | None] = mapped_column("created_by", Text, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column("deleted_at", DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
