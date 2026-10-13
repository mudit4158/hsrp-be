"""Paginated lists: `page` (from 1) and `pageSize` (1-500, default 25), answered as {items, total, page, pageSize}."""

from dataclasses import dataclass, field
from typing import Any

from fastapi import Query, Request
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session


@dataclass
class Page:
    page: int = 1
    page_size: int = 25
    # Any other query parameters, for list endpoints with simple filters (FilteredPageQuery in NestJS).
    filters: dict[str, str] = field(default_factory=dict)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    def get(self, name: str) -> str | None:
        v = self.filters.get(name)
        return v if v not in (None, "") else None


def page_query(request: Request, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=500, alias="pageSize")) -> Page:
    filters = {k: v for k, v in request.query_params.items() if k not in ("page", "pageSize")}
    return Page(page, page_size, filters)


def page_of(items: list[Any], total: int, q: Page) -> dict[str, Any]:
    return {"items": items, "total": total, "page": q.page, "pageSize": q.page_size}


def paginate(s: Session, stmt: Select, q: Page) -> dict[str, Any]:
    """Runs `stmt` (a select of one entity) for one page, plus the total count."""
    total = s.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    items = list(s.scalars(stmt.offset(q.offset).limit(q.page_size)))
    return page_of(items, total, q)
