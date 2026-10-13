from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert

from app.adapters.models import FileBlob
from app.platform.db.base import utcnow
from app.platform.db.session import Database


class DbFileStore:
    """Stores file bytes in PostgreSQL (D13). Swap for an object-storage adapter later."""

    def __init__(self, db: Database):
        self.db = db

    def put(self, key: str, data: bytes, mime_type: str) -> None:
        now = utcnow()
        with self.db.tx() as s:
            s.execute(
                insert(FileBlob)
                .values(key=key, tenant_id=key.split("/")[0], data=data, created_at=now, updated_at=now)
                .on_conflict_do_update(index_elements=["key"], set_={"data": data, "updated_at": now})
            )

    def get(self, key: str) -> bytes:
        with self.db.tx() as s:
            row = s.get(FileBlob, key)
        if row is None:
            raise RuntimeError(f"File bytes missing for {key}")
        return bytes(row.data)

    def delete(self, key: str) -> None:
        with self.db.tx() as s:
            s.execute(delete(FileBlob).where(FileBlob.key == key))
