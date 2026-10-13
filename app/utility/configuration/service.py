"""Settings by scope with effective dates. Callers pass scopes most specific first (e.g. dealer, oem, state); global is
always tried last. Feature flags are settings named `feature.<name>`."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.platform.context import request_context
from app.platform.db.base import naive_utc, utcnow
from app.platform.db.session import Database
from app.platform.http.json import to_jsonable
from app.utility.audit.service import AuditService
from app.utility.configuration.models import ConfigSetting


@dataclass(frozen=True)
class Scope:
    type: str
    id: str


GLOBAL = Scope("global", "*")


class SettingsService:
    def __init__(self, db: Database, audit: AuditService):
        self.db = db
        self.audit = audit

    def get(self, key: str, scopes: list[Scope] | None = None, at: datetime | None = None, s: Session | None = None) -> Any:
        """The value for the most specific scope that has one, or None."""
        at = at or utcnow()
        chain = [*(scopes or []), GLOBAL]
        with self.db.use(s) as session:
            rows = session.scalars(
                select(ConfigSetting)
                .where(
                    ConfigSetting.tenant_id == request_context.tenant_id(),
                    ConfigSetting.key == key,
                    ConfigSetting.effective_from <= at,
                    or_(ConfigSetting.effective_to.is_(None), ConfigSetting.effective_to > at),
                )
                .order_by(ConfigSetting.effective_from.desc())
            ).all()
        for scope in chain:
            hit = next((r for r in rows if r.scope_type == scope.type and r.scope_id == scope.id), None)
            if hit is not None:
                return hit.value
        return None

    def get_or(self, key: str, fallback: Any, scopes: list[Scope] | None = None, at: datetime | None = None, s: Session | None = None) -> Any:
        v = self.get(key, scopes, at, s)
        return fallback if v is None else v

    def flag(self, name: str, scopes: list[Scope] | None = None) -> bool:
        return bool(self.get(f"feature.{name}", scopes))

    def set(self, key: str, scope_type: str, scope_id: str, value: Any, effective_from: datetime | None = None, s: Session | None = None) -> ConfigSetting:
        """Sets a value from `effective_from` (default now), closing the previous value for the same key and scope."""
        tenant_id = request_context.tenant_id()
        start = naive_utc(effective_from) if effective_from else utcnow()
        with self.db.use(s) as session:
            open_rows = session.scalars(
                select(ConfigSetting).where(
                    ConfigSetting.tenant_id == tenant_id,
                    ConfigSetting.key == key,
                    ConfigSetting.scope_type == scope_type,
                    ConfigSetting.scope_id == scope_id,
                    ConfigSetting.effective_to.is_(None),
                    ConfigSetting.effective_from <= start,
                )
            ).all()
            before = [o.value for o in open_rows]
            for o in open_rows:
                o.effective_to = start
            row = ConfigSetting(
                tenant_id=tenant_id,
                key=key,
                scope_type=scope_type,
                scope_id=scope_id,
                value=to_jsonable(value),
                effective_from=start,
                created_by=request_context.actor_id(),
            )
            session.add(row)
            session.flush()
            self.audit.record("config.set", "config", f"{key}@{scope_type}:{scope_id}", before, value, s=session)
            return row

    def list(self, key: str | None = None, include_history: bool = False) -> list[ConfigSetting]:
        q = select(ConfigSetting).where(ConfigSetting.tenant_id == request_context.tenant_id())
        if key:
            q = q.where(ConfigSetting.key.contains(key, autoescape=True))
        if not include_history:
            q = q.where(ConfigSetting.effective_to.is_(None))
        q = q.order_by(ConfigSetting.key, ConfigSetting.scope_type, ConfigSetting.scope_id, ConfigSetting.effective_from.desc())
        with self.db.tx() as s:
            return list(s.scalars(q))
