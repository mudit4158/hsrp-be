from typing import Any

from sqlalchemy import select

from app.adapters.models import MockOemCallback, MockOemCatalogue
from app.contracts.schemas import OemOrderRequest
from app.platform.context import request_context
from app.platform.db.session import Database


class MockOrderSource:
    """Mock OEM side: payloads are already canonical; status callbacks are stored instead of sent."""

    def __init__(self, db: Database):
        self.db = db

    def to_canonical(self, oem_code: str, payload: Any) -> OemOrderRequest:
        return OemOrderRequest.model_validate(payload)

    def notify_status(self, oem_code: str, order_ref: str, status: str, reason: str | None = None) -> None:
        with self.db.tx() as s:
            s.add(MockOemCallback(tenant_id=request_context.tenant_id(), oem_code=oem_code, order_ref=order_ref, status=status, reason=reason))


class MockOemCatalog:
    """Mock OEM chassis catalogue backed by a seeded table."""

    def __init__(self, db: Database):
        self.db = db

    def check(self, oem_code: str, chassis_no: str) -> dict[str, Any]:
        with self.db.tx() as s:
            row = s.scalar(select(MockOemCatalogue).where(MockOemCatalogue.oem_code == oem_code, MockOemCatalogue.chassis_no == chassis_no.upper()))
        return {"found": row is not None, "model": row.model if row else None}


class RealOrderSource:
    def __init__(self, db: Database):
        pass

    def _fail(self, *args, **kwargs):
        raise RuntimeError("Real OEM adapter is not implemented. Set OEM_ADAPTER=mock.")

    to_canonical = notify_status = _fail


class RealOemCatalog:
    def __init__(self, db: Database):
        pass

    def check(self, oem_code: str, chassis_no: str) -> dict[str, Any]:
        raise RuntimeError("Real OEM catalogue adapter is not implemented. Set OEM_ADAPTER=mock.")
