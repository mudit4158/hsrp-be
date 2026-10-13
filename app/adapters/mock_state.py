from typing import Any

from sqlalchemy.dialects.postgresql import insert

from app.adapters.models import MockSetting
from app.platform.context import request_context
from app.platform.db.base import utcnow
from app.platform.db.session import Database


class MockStateService:
    """Knobs and fixtures of the mock external systems (VAHAN mode, demo OEM credentials, ...)."""

    def __init__(self, db: Database):
        self.db = db

    def get(self, key: str, fallback: Any) -> Any:
        with self.db.tx() as s:
            row = s.get(MockSetting, key)
        return fallback if row is None or row.value is None else row.value

    def set(self, key: str, value: Any) -> None:
        now = utcnow()
        with self.db.tx() as s:
            s.execute(
                insert(MockSetting)
                .values(key=key, tenant_id=request_context.tenant_id(), value=value, created_at=now, updated_at=now)
                .on_conflict_do_update(index_elements=["key"], set_={"value": value, "updated_at": now})
            )
