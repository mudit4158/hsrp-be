"""Records every call to an external system: request, response, outcome and duration."""

from __future__ import annotations

import time
from collections.abc import Callable
from datetime import datetime
from typing import Any, TypeVar

from sqlalchemy import select

from app.platform.context import request_context
from app.platform.db.session import Database
from app.platform.http.json import to_jsonable
from app.utility.integration_hub.models import CallLog

T = TypeVar("T")


class CallLogService:
    def __init__(self, db: Database):
        self.db = db

    def track(
        self,
        fn: Callable[[], T],
        *,
        system: str,
        operation: str,
        subject_type: str | None = None,
        subject_id: str | None = None,
        request: Any = None,
    ) -> T:
        meta = {"system": system, "operation": operation, "subject_type": subject_type, "subject_id": subject_id, "request": request}
        started = time.monotonic()
        try:
            result = fn()
        except Exception as e:
            self._write(meta, "ERROR", started, None, str(e))
            raise
        self._write(meta, "OK", started, result)
        return result

    def list(self, system: str, from_: datetime | None = None, to: datetime | None = None) -> list[CallLog]:
        """Calls to one external system, newest first."""
        q = select(CallLog).where(CallLog.tenant_id == request_context.tenant_id(), CallLog.system == system)
        if from_:
            q = q.where(CallLog.created_at >= from_)
        if to:
            q = q.where(CallLog.created_at <= to)
        with self.db.tx() as s:
            return list(s.scalars(q.order_by(CallLog.created_at.desc()).limit(5000)))

    def _write(self, meta: dict[str, Any], outcome: str, started: float, response: Any = None, error: str | None = None) -> None:
        with self.db.tx() as s:
            s.add(
                CallLog(
                    tenant_id=request_context.tenant_id(),
                    system=meta["system"],
                    operation=meta["operation"],
                    subject_type=meta["subject_type"],
                    subject_id=meta["subject_id"],
                    request=to_jsonable(meta["request"]),
                    response=to_jsonable(response),
                    outcome=outcome,
                    error=error,
                    duration_ms=int((time.monotonic() - started) * 1000),
                )
            )
