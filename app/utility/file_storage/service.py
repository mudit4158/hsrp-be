"""Upload, fetch by signed link, retention. Callers attach files to any subject by type and id."""

import base64
import hashlib
import hmac
import time
import uuid
from datetime import timedelta
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.platform.config import env
from app.platform.context import request_context
from app.platform.db.base import utcnow
from app.platform.db.session import Database
from app.platform.http.problem import Problem
from app.utility.file_storage.models import FileObject

ALLOWED = {"image/jpeg", "image/png", "image/webp", "application/pdf", "text/csv", "application/vnd.ms-excel", "text/plain"}
MAX_BYTES = 10 * 1024 * 1024
_MIME_BY_EXT = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "pdf": "application/pdf", "csv": "text/csv", "txt": "text/plain"}


class FileStore(Protocol):
    """Port for byte storage. The prototype stores bytes in PostgreSQL (D13); object storage can replace it later."""

    def put(self, key: str, data: bytes, mime_type: str) -> None: ...

    def get(self, key: str) -> bytes: ...

    def delete(self, key: str) -> None: ...


def guess_mime(name: str) -> str:
    return _MIME_BY_EXT.get(name.lower().rsplit(".", 1)[-1], "application/octet-stream")


class FileService:
    def __init__(self, db: Database, store: FileStore):
        self.db = db
        self.store = store

    def upload(
        self,
        data: bytes,
        filename: str,
        mime_type: str,
        purpose: str | None = None,
        owner_subject_type: str | None = None,
        owner_subject_id: str | None = None,
        retention_days: int | None = None,
        s: Session | None = None,
    ) -> FileObject:
        mime = guess_mime(filename) if mime_type == "application/octet-stream" else mime_type
        if mime not in ALLOWED:
            raise Problem.bad_request(f"File type {mime} is not allowed", "file-type")
        if len(data) == 0:
            raise Problem.bad_request("File is empty", "file-empty")
        if len(data) > MAX_BYTES:
            raise Problem.bad_request("File is larger than 10 MB", "file-too-large")
        tenant_id = request_context.tenant_id()
        id = str(uuid.uuid4())
        storage_key = f"{tenant_id}/{id}"
        self.store.put(storage_key, data, mime)
        with self.db.use(s) as session:
            f = FileObject(
                id=id,
                tenant_id=tenant_id,
                filename=filename[:200],
                mime_type=mime,
                size_bytes=len(data),
                sha256=hashlib.sha256(data).hexdigest(),
                storage_key=storage_key,
                purpose=purpose,
                owner_subject_type=owner_subject_type,
                owner_subject_id=owner_subject_id,
                retention_until=utcnow() + timedelta(days=retention_days) if retention_days else None,
                created_by=request_context.actor_id(),
            )
            session.add(f)
            session.flush()
            return f

    def meta(self, id: str, s: Session | None = None) -> FileObject:
        with self.db.use(s) as session:
            f = session.scalar(select(FileObject).where(FileObject.id == id, FileObject.tenant_id == request_context.tenant_id(), FileObject.deleted_at.is_(None)))
        if f is None:
            raise Problem.not_found("File")
        return f

    def attach(self, id: str, subject_type: str, subject_id: str, purpose: str | None = None, s: Session | None = None) -> FileObject:
        with self.db.use(s) as session:
            f = self.meta(id, session)
            f.owner_subject_type, f.owner_subject_id, f.purpose = subject_type, subject_id, purpose
            session.flush()
            return f

    def read(self, id: str) -> tuple[FileObject, bytes]:
        with self.db.tx() as s:
            f = s.scalar(select(FileObject).where(FileObject.id == id, FileObject.deleted_at.is_(None)))
        if f is None:
            raise Problem.not_found("File")
        return f, self.store.get(f.storage_key)

    def signed_path(self, id: str, ttl_seconds: int = 900) -> str:
        """Short-lived link that works without a session (for <img> tags, downloads, the Android app)."""
        exp = int(time.time()) + ttl_seconds
        return f"/api/v1/files/{id}/content?exp={exp}&sig={self._sign(id, exp)}"

    def verify_link(self, id: str, exp: int, sig: str | None) -> None:
        if not exp or exp < time.time():
            raise Problem.forbidden("Link expired")
        if not hmac.compare_digest(self._sign(id, exp).encode(), (sig or "").encode()):
            raise Problem.forbidden("Bad link signature")

    def list_for(self, subject_type: str, subject_id: str) -> list[FileObject]:
        with self.db.tx() as s:
            return list(
                s.scalars(
                    select(FileObject)
                    .where(
                        FileObject.tenant_id == request_context.tenant_id(),
                        FileObject.owner_subject_type == subject_type,
                        FileObject.owner_subject_id == subject_id,
                        FileObject.deleted_at.is_(None),
                    )
                    .order_by(FileObject.created_at)
                )
            )

    def purge_expired(self) -> int:
        """Retention: soft-deletes metadata and removes bytes of files past their retention date."""
        with self.db.tx() as s:
            due = s.scalars(select(FileObject).where(FileObject.retention_until < utcnow(), FileObject.deleted_at.is_(None)).limit(200)).all()
        for f in due:
            self.store.delete(f.storage_key)
            with self.db.tx() as s:
                s.get_one(FileObject, f.id).deleted_at = utcnow()
        return len(due)

    def _sign(self, id: str, exp: int) -> str:
        digest = hmac.new(env.file_link_secret.encode(), f"{id}.{exp}".encode(), hashlib.sha256).digest()
        return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
