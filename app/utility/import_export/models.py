"""Tables owned by app.utility.import_export (architecture rule 7).

Generated from prisma/schema/util-import-export.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, FetchedValue, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.utility.import_export"


class ImportProfile(Base):
    __tablename__ = "util_import_profile"
    __table_args__ = (
        Index("util_import_profile_tenant_id_code_key", "tenant_id", "code", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    code: Mapped[str] = mapped_column("code", Text)
    name: Mapped[str] = mapped_column("name", Text)
    source_name: Mapped[str] = mapped_column("source_name", Text)
    target_type: Mapped[str] = mapped_column("target_type", Text)
    delimiter: Mapped[str] = mapped_column("delimiter", Text, default=",")
    # { columns: { targetField: { from: "Source Column", required?, transform? } }, context?: {...} }
    mapping: Mapped[Any] = mapped_column("mapping", JSONB(none_as_null=True))
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class ImportJob(Base):
    __tablename__ = "util_import_job"

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    profile_code: Mapped[str] = mapped_column("profile_code", Text)
    target_type: Mapped[str] = mapped_column("target_type", Text)
    file_id: Mapped[str | None] = mapped_column("file_id", Text, nullable=True)
    filename: Mapped[str] = mapped_column("filename", Text)
    status: Mapped[str] = mapped_column("status", Text, default="PARSED")
    total_rows: Mapped[int] = mapped_column("total_rows", Integer, default=0)
    ok_rows: Mapped[int] = mapped_column("ok_rows", Integer, default=0)
    error_rows: Mapped[int] = mapped_column("error_rows", Integer, default=0)
    created_by: Mapped[str | None] = mapped_column("created_by", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class ImportRow(Base):
    __tablename__ = "util_import_row"
    __table_args__ = (
        Index("util_import_row_job_id_row_no_idx", "job_id", "row_no"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    job_id: Mapped[str] = mapped_column("job_id", Text)
    row_no: Mapped[int] = mapped_column("row_no", Integer)
    raw: Mapped[Any] = mapped_column("raw", JSONB(none_as_null=True))
    mapped: Mapped[Any | None] = mapped_column("mapped", JSONB(none_as_null=True), nullable=True)
    status: Mapped[str] = mapped_column("status", Text, default="PENDING")
    errors: Mapped[Any | None] = mapped_column("errors", JSONB(none_as_null=True), nullable=True)
    result_ref: Mapped[str | None] = mapped_column("result_ref", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
