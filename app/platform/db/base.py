"""Declarative base and column defaults shared by every module's models."""

import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    """Naive UTC, as Prisma stored timestamps (`timestamp(3) without time zone`)."""
    return datetime.now(UTC).replace(tzinfo=None)


def naive_utc(d: datetime) -> datetime:
    """Timestamps are stored as naive UTC (Prisma's timestamp(3) columns); convert an aware value from a request."""
    return d.astimezone(UTC).replace(tzinfo=None) if d.tzinfo is not None else d
