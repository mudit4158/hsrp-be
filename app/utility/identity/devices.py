"""Registered devices. A session bound to a device stops working when the device is deactivated."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.platform.db.base import new_id, utcnow
from app.platform.db.session import Database
from app.platform.http.problem import Problem
from app.utility.identity.models import IamDevice


class DeviceService:
    def __init__(self, db: Database):
        self.db = db

    def register(self, tenant_id: str, user_id: str, device_id: str, name: str | None = None) -> IamDevice:
        now = utcnow()
        update = {"last_seen_at": now, "updated_at": now}
        if name:
            update["name"] = name
        with self.db.tx() as s:
            stmt = (
                insert(IamDevice)
                .values(id=new_id(), tenant_id=tenant_id, user_id=user_id, device_id=device_id, name=name, active=True, last_seen_at=now, created_at=now, updated_at=now)
                .on_conflict_do_update(index_elements=["tenant_id", "user_id", "device_id"], set_=update)
                .returning(IamDevice)
            )
            return s.scalars(stmt).one()

    def assert_active(self, tenant_id: str, user_id: str, device_id: str) -> None:
        with self.db.tx() as s:
            d = s.scalar(select(IamDevice).where(IamDevice.tenant_id == tenant_id, IamDevice.user_id == user_id, IamDevice.device_id == device_id))
        if d is None or not d.active:
            raise Problem.unauthorized("This device is not registered or has been deactivated")

    def list(self, tenant_id: str, user_id: str | None = None) -> list[IamDevice]:
        q = select(IamDevice).where(IamDevice.tenant_id == tenant_id)
        if user_id:
            q = q.where(IamDevice.user_id == user_id)
        with self.db.tx() as s:
            return list(s.scalars(q.order_by(IamDevice.last_seen_at.desc())))

    def set_active(self, tenant_id: str, id: str, active: bool) -> IamDevice:
        with self.db.tx() as s:
            d = s.scalar(select(IamDevice).where(IamDevice.id == id, IamDevice.tenant_id == tenant_id))
            if d is None:
                # Prisma's update() with a missing row answered 404 through the problem filter (P2025).
                raise Problem(404, "Not found", "Record not found", "not-found")
            d.active = active
            s.flush()
            return d
