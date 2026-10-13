"""JSON on the wire matches the NestJS API: camelCase keys, timestamps as ISO 8601 UTC with milliseconds and 'Z'."""

import re
from dataclasses import fields, is_dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import DeclarativeBase


def camel(name: str) -> str:
    return re.sub(r"_([a-z0-9])", lambda m: m.group(1).upper(), name)


def iso(d: datetime | None) -> str | None:
    """Naive UTC (as stored) or aware datetime → '2026-10-12T12:53:11.100Z'."""
    if d is None:
        return None
    if d.tzinfo is not None:
        d = d.astimezone(UTC).replace(tzinfo=None)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def row(obj: DeclarativeBase | None) -> dict[str, Any] | None:
    """An ORM row as the API's camelCase dict (all mapped columns)."""
    if obj is None:
        return None
    mapper = sa_inspect(obj).mapper
    return {camel(a.key): getattr(obj, a.key) for a in mapper.column_attrs}


def rows(objs) -> list[dict[str, Any]]:
    return [row(o) for o in objs]


def to_jsonable(v: Any) -> Any:
    if isinstance(v, DeclarativeBase):
        return to_jsonable(row(v))
    if callable(getattr(v, "wire", None)):
        # Port and contract dataclasses that name their fields as the external system or API does.
        return to_jsonable(v.wire())
    if is_dataclass(v) and not isinstance(v, type):
        return {camel(f.name): to_jsonable(getattr(v, f.name)) for f in fields(v)}
    if isinstance(v, BaseModel):
        return to_jsonable(v.model_dump(by_alias=True))
    if isinstance(v, dict):
        return {k: to_jsonable(x) for k, x in v.items()}
    if isinstance(v, list | tuple | set):
        return [to_jsonable(x) for x in v]
    if isinstance(v, datetime):
        return iso(v)
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, bytes):
        return None
    return v


class ApiResponse(JSONResponse):
    """Default response class: converts ORM rows and datetimes the way the NestJS API serialised them."""

    def render(self, content: Any) -> bytes:
        return super().render(to_jsonable(content))


class ApiModel(BaseModel):
    """Request bodies: camelCase on the wire, snake_case in Python."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")
