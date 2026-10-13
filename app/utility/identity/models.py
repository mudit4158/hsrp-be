"""Tables owned by app.utility.identity (architecture rule 7).

Generated from prisma/schema/util-identity.prisma by scripts/prisma_to_sqlalchemy.py during the FastAPI port;
edit by hand after cut-over. The schema itself is created by the Alembic migrations."""

from datetime import datetime  # noqa: F401
from typing import Any  # noqa: F401

from sqlalchemy import Boolean, DateTime, FetchedValue, Float, Index, Integer, LargeBinary, Text, text  # noqa: F401
from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: F401
from sqlalchemy.orm import Mapped, mapped_column

from app.platform.db.base import Base, new_id, utcnow  # noqa: F401

OWNER = "app.utility.identity"


class IamOrg(Base):
    __tablename__ = "util_iam_org"
    __table_args__ = (
        Index("util_iam_org_tenant_id_code_key", "tenant_id", "code", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    code: Mapped[str] = mapped_column("code", Text)
    name: Mapped[str] = mapped_column("name", Text)
    org_type: Mapped[str] = mapped_column("org_type", Text)
    parent_id: Mapped[str | None] = mapped_column("parent_id", Text, nullable=True)
    external_ref: Mapped[str | None] = mapped_column("external_ref", Text, nullable=True)
    active: Mapped[bool] = mapped_column("active", Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class IamRole(Base):
    __tablename__ = "util_iam_role"
    __table_args__ = (
        Index("util_iam_role_tenant_id_code_key", "tenant_id", "code", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    code: Mapped[str] = mapped_column("code", Text)
    name: Mapped[str] = mapped_column("name", Text)
    permissions: Mapped[list[str]] = mapped_column("permissions", ARRAY(Text), default=list, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class IamUser(Base):
    __tablename__ = "util_iam_user"
    __table_args__ = (
        Index("util_iam_user_tenant_id_username_key", "tenant_id", "username", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    username: Mapped[str] = mapped_column("username", Text)
    display_name: Mapped[str] = mapped_column("display_name", Text)
    password_hash: Mapped[str] = mapped_column("password_hash", Text)
    org_id: Mapped[str | None] = mapped_column("org_id", Text, nullable=True)
    roles: Mapped[list[str]] = mapped_column("roles", ARRAY(Text), default=list, nullable=True)
    mobile: Mapped[str | None] = mapped_column("mobile", Text, nullable=True)
    email: Mapped[str | None] = mapped_column("email", Text, nullable=True)
    active: Mapped[bool] = mapped_column("active", Boolean, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column("last_login_at", DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class IamOtp(Base):
    __tablename__ = "util_iam_otp"
    __table_args__ = (
        Index("util_iam_otp_tenant_id_recipient_idx", "tenant_id", "recipient"),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    purpose: Mapped[str] = mapped_column("purpose", Text)
    recipient: Mapped[str] = mapped_column("recipient", Text)
    code_hash: Mapped[str] = mapped_column("code_hash", Text)
    context: Mapped[Any | None] = mapped_column("context", JSONB(none_as_null=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column("expires_at", DateTime)
    attempts: Mapped[int] = mapped_column("attempts", Integer, default=0)
    verified_at: Mapped[datetime | None] = mapped_column("verified_at", DateTime, nullable=True)
    consumed_at: Mapped[datetime | None] = mapped_column("consumed_at", DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class IamApiClient(Base):
    __tablename__ = "util_iam_api_client"
    __table_args__ = (
        Index("util_iam_api_client_key_hash_key", "key_hash", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    org_id: Mapped[str] = mapped_column("org_id", Text)
    name: Mapped[str] = mapped_column("name", Text)
    key_hash: Mapped[str] = mapped_column("key_hash", Text)
    # Shared secret used to verify request signatures (HMAC-SHA256). Prototype stores it in clear.
    secret: Mapped[str] = mapped_column("secret", Text)
    roles: Mapped[list[str]] = mapped_column("roles", ARRAY(Text), default=list, nullable=True)
    active: Mapped[bool] = mapped_column("active", Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)


class IamDevice(Base):
    __tablename__ = "util_iam_device"
    __table_args__ = (
        Index("util_iam_device_tenant_id_user_id_device_id_key", "tenant_id", "user_id", "device_id", unique=True),
    )

    id: Mapped[str] = mapped_column("id", Text, primary_key=True, default=new_id)
    tenant_id: Mapped[str] = mapped_column("tenant_id", Text)
    user_id: Mapped[str] = mapped_column("user_id", Text)
    device_id: Mapped[str] = mapped_column("device_id", Text)
    name: Mapped[str | None] = mapped_column("name", Text, nullable=True)
    active: Mapped[bool] = mapped_column("active", Boolean, default=True)
    last_seen_at: Mapped[datetime] = mapped_column("last_seen_at", DateTime, default=utcnow)
    created_at: Mapped[datetime] = mapped_column("created_at", DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column("updated_at", DateTime, default=utcnow, onupdate=utcnow)
