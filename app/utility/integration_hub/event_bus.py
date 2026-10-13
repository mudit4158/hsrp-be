"""Transactional outbox + in-process event bus.

publish() writes the event in the caller's transaction. The worker fans each event out to one delivery row per
subscriber and runs them with retries and exponential back-off; exhausted deliveries become DEAD (the dead-letter /
manual queue shown on the integration monitor)."""

import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.platform.config import env
from app.platform.context import request_context
from app.platform.db.base import new_id, utcnow
from app.platform.db.session import Database
from app.utility.integration_hub.backoff import next_delivery_state
from app.utility.integration_hub.models import OutboxDelivery, OutboxEvent

log = logging.getLogger("EventBus")


@dataclass
class DeliveredEvent:
    id: str
    tenant_id: str
    type: str
    subject_type: str | None
    subject_id: str | None
    payload: dict[str, Any]
    occurred_at: datetime
    attempt: int


EventHandler = Callable[[DeliveredEvent], None]


@dataclass
class _Subscription:
    name: str
    handler: EventHandler
    max_attempts: int


class EventBus:
    def __init__(self, db: Database):
        self.db = db
        self.base_retry_ms = env.outbox_retry_base_ms
        self._subs: dict[str, list[_Subscription]] = {}
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        db.on_after_commit(self.kick)

    def publish(self, s: Session, type: str, subject_type: str | None = None, subject_id: str | None = None, payload: dict[str, Any] | None = None) -> str:
        """Writes the event in the caller's transaction; it is dispatched after commit."""
        row = OutboxEvent(
            tenant_id=request_context.tenant_id(),
            event_type=type,
            subject_type=subject_type,
            subject_id=subject_id,
            payload=payload or {},
            actor_id=request_context.actor_id(),
        )
        s.add(row)
        s.flush()
        return row.id

    def subscribe(self, event_type: str, name: str, handler: EventHandler, max_attempts: int = 8) -> None:
        subs = self._subs.setdefault(event_type, [])
        if any(x.name == name for x in subs):
            return
        subs.append(_Subscription(name, handler, max_attempts))

    def subscriptions(self) -> list[dict[str, str]]:
        return [{"eventType": t, "subscriber": x.name} for t, subs in self._subs.items() for x in subs]

    def stats(self) -> dict[str, int]:
        """Delivery counts by status, plus how many are queued for retry and how many sit in the manual queue."""
        with self.db.tx() as s:
            rows = s.execute(
                select(OutboxDelivery.status, func.count()).where(OutboxDelivery.tenant_id == request_context.tenant_id()).group_by(OutboxDelivery.status)
            ).all()
        by = dict(rows)
        return {"pending": by.get("PENDING", 0) + by.get("RUNNING", 0), "retrying": by.get("FAILED", 0), "dead": by.get("DEAD", 0), "done": by.get("DONE", 0)}

    def events_for(self, subject_type: str, subject_id: str) -> list[OutboxEvent]:
        with self.db.tx() as s:
            return list(
                s.scalars(
                    select(OutboxEvent)
                    .where(OutboxEvent.tenant_id == request_context.tenant_id(), OutboxEvent.subject_type == subject_type, OutboxEvent.subject_id == subject_id)
                    .order_by(OutboxEvent.seq)
                    .limit(500)
                )
            )

    def replay_all(self, subscriber: str) -> int:
        """Re-queues every FAILED or DEAD delivery of one subscriber now (e.g. after VAHAN comes back)."""
        with self.db.tx() as s:
            res = s.execute(
                update(OutboxDelivery)
                .where(OutboxDelivery.tenant_id == request_context.tenant_id(), OutboxDelivery.subscriber == subscriber, OutboxDelivery.status.in_(["FAILED", "DEAD"]))
                .values(status="PENDING", next_attempt_at=utcnow(), updated_at=utcnow())
            )
            count = res.rowcount
        self.kick()
        return count

    # ---- worker ----

    def start(self, interval_s: float = 1.0) -> None:
        if self._thread:
            return
        self._stop.clear()

        def run() -> None:
            while not self._stop.is_set():
                self._wake.wait(interval_s)
                self._wake.clear()
                try:
                    while not self._stop.is_set() and self.run_once() > 0:
                        pass
                except Exception as e:  # keep the worker alive; the next pass retries
                    log.error("Dispatch pass failed: %s", e)

        self._thread = threading.Thread(target=run, name="outbox-worker", daemon=True)
        self._thread.start()
        log.info("Outbox worker started")

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=5)
        self._thread = None

    def kick(self) -> None:
        """Runs a dispatch pass soon (concurrent requests coalesce into one pass)."""
        if self._thread:
            self._wake.set()

    def run_once(self) -> int:
        """One dispatch pass: fan out new events, then run due deliveries. Returns the number of deliveries run."""
        with self._lock:
            self._fan_out()
            return self._run_due()

    def _fan_out(self) -> None:
        with self.db.tx() as s:
            events = s.execute(
                text("SELECT id, event_type, tenant_id FROM util_hub_outbox_event WHERE dispatched_at IS NULL ORDER BY seq LIMIT 200 FOR UPDATE SKIP LOCKED")
            ).all()
            for e in events:
                subs = self._subs.get(e.event_type, [])
                if subs:
                    now = utcnow()
                    s.execute(
                        insert(OutboxDelivery)
                        .values(
                            [
                                {
                                    "id": new_id(),
                                    "tenant_id": e.tenant_id,
                                    "event_id": e.id,
                                    "event_type": e.event_type,
                                    "subscriber": x.name,
                                    "max_attempts": x.max_attempts,
                                    "status": "PENDING",
                                    "attempts": 0,
                                    "next_attempt_at": now,
                                    "created_at": now,
                                    "updated_at": now,
                                }
                                for x in subs
                            ]
                        )
                        .on_conflict_do_nothing()
                    )
                s.execute(update(OutboxEvent).where(OutboxEvent.id == e.id).values(dispatched_at=utcnow(), updated_at=utcnow()))

    def _run_due(self) -> int:
        # Due times are written with the app clock, so compare with the app clock too (a Docker VM clock can lag).
        now = utcnow()
        with self.db.tx() as s:
            claimed = s.execute(
                text(
                    """
                    UPDATE util_hub_outbox_delivery d
                    SET status = 'RUNNING', locked_until = :lock_until, updated_at = :now
                    FROM (
                      SELECT d2.id, e.seq FROM util_hub_outbox_delivery d2
                      JOIN util_hub_outbox_event e ON e.id = d2.event_id
                      WHERE (d2.status IN ('PENDING', 'FAILED') AND d2.next_attempt_at <= :now)
                         OR (d2.status = 'RUNNING' AND d2.locked_until < :now)
                      ORDER BY e.seq
                      LIMIT 50
                      FOR UPDATE OF d2 SKIP LOCKED
                    ) c
                    WHERE d.id = c.id
                    RETURNING d.id, c.seq
                    """
                ),
                {"now": now, "lock_until": now + timedelta(seconds=120)},
            ).all()
        for c in sorted(claimed, key=lambda r: r.seq):
            self.run_delivery(c.id)
        return len(claimed)

    def run_delivery(self, delivery_id: str) -> None:
        """Runs a single delivery now (also used by tests)."""
        with self.db.tx() as s:
            d = s.get_one(OutboxDelivery, delivery_id)
            e = s.get_one(OutboxEvent, d.event_id)
        sub = next((x for x in self._subs.get(e.event_type, []) if x.name == d.subscriber), None)
        error: BaseException | None = None
        if sub is None:
            error = _NoHandler(f"No handler registered for {d.subscriber}")
        else:
            event = DeliveredEvent(
                id=e.id,
                tenant_id=e.tenant_id,
                type=e.event_type,
                subject_type=e.subject_type,
                subject_id=e.subject_id,
                payload=e.payload or {},
                occurred_at=e.occurred_at,
                attempt=d.attempts + 1,
            )
            try:
                request_context.run_as_system(e.tenant_id, lambda: sub.handler(event))
            except Exception as err:
                error = err
        nxt = next_delivery_state(
            succeeded=error is None,
            non_retryable=bool(getattr(error, "non_retryable", False)),
            attempts_so_far=d.attempts,
            max_attempts=d.max_attempts,
            now=utcnow(),
            base_ms=self.base_retry_ms,
        )
        if error is not None:
            log.warning("%s failed (attempt %s): %s", d.subscriber, nxt.attempts, error)
        values: dict[str, Any] = {
            "status": nxt.status,
            "attempts": nxt.attempts,
            "locked_until": None,
            "last_error": str(error)[:2000] if error is not None else None,
            "completed_at": utcnow() if nxt.status == "DONE" else None,
            "updated_at": utcnow(),
        }
        if nxt.status == "FAILED":
            values["next_attempt_at"] = nxt.next_attempt_at
        with self.db.tx() as s:
            s.execute(update(OutboxDelivery).where(OutboxDelivery.id == d.id).values(**values))


class _NoHandler(Exception):
    non_retryable = True
