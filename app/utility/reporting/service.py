"""Registry of read-only reports, saved parameter sets and CSV export. Report content comes from consumers."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select

from app.platform.context import request_context
from app.platform.db.session import Database
from app.platform.http.problem import Problem
from app.utility.import_export.csv_tools import to_csv
from app.utility.reporting.models import SavedReport


@dataclass
class ReportDefinition:
    code: str
    name: str
    description: str
    # [{name, label, type: date|text|select, options?}]
    params: list[dict[str, Any]]
    # [{key, label}]
    columns: list[dict[str, str]]
    # Read-only query. Receives validated string params; returns plain rows.
    run: Callable[[dict[str, str]], list[dict[str, Any]]] = field(repr=False)


class ReportingService:
    def __init__(self, db: Database):
        self.db = db
        self._defs: dict[str, ReportDefinition] = {}

    def register(self, d: ReportDefinition) -> None:
        self._defs[d.code] = d

    def list(self) -> list[dict[str, Any]]:
        return [{"code": d.code, "name": d.name, "description": d.description, "params": d.params, "columns": d.columns} for d in self._defs.values()]

    def run(self, code: str, params: dict[str, str]) -> dict[str, Any]:
        d = self._defs.get(code)
        if d is None:
            raise Problem.not_found("Report")
        clean = {p["name"]: str(params[p["name"]]) for p in d.params if params.get(p["name"])}
        return {"code": code, "name": d.name, "columns": d.columns, "rows": d.run(clean)}

    def csv(self, code: str, params: dict[str, str]) -> str:
        r = self.run(code, params)
        return to_csv(r["rows"], r["columns"])

    def saved(self) -> list[SavedReport]:
        with self.db.tx() as s:
            return list(s.scalars(select(SavedReport).where(SavedReport.tenant_id == request_context.tenant_id()).order_by(SavedReport.name)))

    def save(self, report_code: str, name: str, params: dict[str, str]) -> SavedReport:
        if report_code not in self._defs:
            raise Problem.not_found("Report")
        with self.db.tx() as s:
            r = SavedReport(tenant_id=request_context.tenant_id(), report_code=report_code, name=name, params=params, owner_user_id=request_context.actor_id())
            s.add(r)
            s.flush()
            return r
