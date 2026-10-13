from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from app.platform.context import request_context
from app.platform.db.base import utcnow
from app.platform.db.session import Database
from app.platform.http.problem import Problem
from app.utility.integration_hub.models import IdempotencyKey

TTL = timedelta(days=7)


@dataclass(frozen=True)
class Begin:
    # new | replay
    state: str
    code: int = 200
    body: Any = None


class IdempotencyService:
    def __init__(self, db: Database):
        self.db = db

    def begin(self, scope: str, key: str, request_hash: str) -> Begin:
        tenant_id = request_context.tenant_id()
        try:
            with self.db.tx() as s:
                s.add(IdempotencyKey(tenant_id=tenant_id, scope=scope, key=key, request_hash=request_hash, expires_at=utcnow() + TTL))
            return Begin("new")
        except IntegrityError:
            pass
        with self.db.tx() as s:
            existing = s.scalar(select(IdempotencyKey).where(IdempotencyKey.tenant_id == tenant_id, IdempotencyKey.scope == scope, IdempotencyKey.key == key))
        if existing is None:
            raise Problem.conflict("Idempotency key is being processed, retry shortly", "idempotency-in-progress")
        if existing.request_hash != request_hash:
            raise Problem.unprocessable("This Idempotency-Key was already used with a different request", "idempotency-mismatch")
        if existing.status != "DONE":
            raise Problem.conflict("A request with this Idempotency-Key is still in progress", "idempotency-in-progress")
        return Begin("replay", existing.response_code or 200, existing.response_body)

    def complete(self, scope: str, key: str, code: int, body: Any) -> None:
        with self.db.tx() as s:
            s.execute(
                update(IdempotencyKey)
                .where(IdempotencyKey.tenant_id == request_context.tenant_id(), IdempotencyKey.scope == scope, IdempotencyKey.key == key)
                .values(status="DONE", response_code=code, response_body=body, updated_at=utcnow())
            )

    def abort(self, scope: str, key: str) -> None:
        try:
            with self.db.tx() as s:
                s.execute(
                    delete(IdempotencyKey).where(
                        IdempotencyKey.tenant_id == request_context.tenant_id(), IdempotencyKey.scope == scope, IdempotencyKey.key == key
                    )
                )
        except Exception:  # best effort, as in the NestJS service
            pass
