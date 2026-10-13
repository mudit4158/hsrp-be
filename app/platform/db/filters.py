"""Prisma-style filters as plain data, so a module can query another module's records through that module's service
without touching its tables (architecture rule 7):

    orders.find({"status": "ISSUED", "station_id": sid, "wallet_hold_id": None, "channel": {"not": "CUSTOMER_PORTAL"}})

Keys are model attribute names. A value is compared with ==, None with IS NULL, a list or tuple with IN; a dict holds
operators: not, in, notIn, gte, gt, lte, lt, contains, endsWith, startsWith."""

from typing import Any

from sqlalchemy import and_


def where_of(model: Any, filters: dict[str, Any] | None) -> list[Any]:
    conds: list[Any] = []
    for key, value in (filters or {}).items():
        col = getattr(model, key)
        if isinstance(value, dict):
            for op, v in value.items():
                conds.append(_op(col, op, v))
        elif value is None:
            conds.append(col.is_(None))
        elif isinstance(value, list | tuple | set):
            conds.append(col.in_(list(value)))
        else:
            conds.append(col == value)
    return conds


def _op(col: Any, op: str, v: Any) -> Any:
    if op == "not":
        return col.is_not(None) if v is None else col != v
    if op == "in":
        return col.in_(list(v))
    if op == "notIn":
        return col.not_in(list(v))
    if op == "gte":
        return col >= v
    if op == "gt":
        return col > v
    if op == "lte":
        return col <= v
    if op == "lt":
        return col < v
    if op == "contains":
        return col.contains(v, autoescape=True)
    if op == "endsWith":
        return col.endswith(v, autoescape=True)
    if op == "startsWith":
        return col.startswith(v, autoescape=True)
    raise ValueError(f"Unknown filter operator {op}")


def all_of(model: Any, filters: dict[str, Any] | None) -> Any:
    return and_(True, *where_of(model, filters))
