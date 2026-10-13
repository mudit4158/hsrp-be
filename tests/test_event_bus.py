"""Port of src/utility/integration-hub/event-bus.spec.ts."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, update

from app.platform.http.problem import NonRetryableError
from app.utility.integration_hub.backoff import backoff_ms, next_delivery_state
from app.utility.integration_hub.event_bus import EventBus
from app.utility.integration_hub.models import OutboxDelivery, OutboxEvent
from tests.conftest import as_system


def test_backoff_doubles_from_the_base_delay_and_caps():
    assert [backoff_ms(a, 1000) for a in (1, 2, 3, 4)] == [1000, 2000, 4000, 8000]
    assert backoff_ms(30, 1000) == 5 * 60_000


def test_next_state_done_failed_dead():
    now = datetime(2026, 1, 1, tzinfo=UTC)
    ok = next_delivery_state(succeeded=True, attempts_so_far=0, max_attempts=3, now=now, base_ms=1000)
    assert (ok.status, ok.attempts) == ("DONE", 1)
    f = next_delivery_state(succeeded=False, attempts_so_far=1, max_attempts=3, now=now, base_ms=1000)
    assert (f.status, f.attempts) == ("FAILED", 2)
    assert f.next_attempt_at - now == timedelta(milliseconds=2000)
    assert next_delivery_state(succeeded=False, attempts_so_far=2, max_attempts=3, now=now, base_ms=1000).status == "DEAD"
    assert next_delivery_state(succeeded=False, non_retryable=True, attempts_so_far=0, max_attempts=9, now=now, base_ms=1000).status == "DEAD"


@pytest.fixture
def bus(clean):
    b = EventBus(clean)
    b.base_retry_ms = 60_000
    return b


def _deliveries(db, subscriber):
    with db.tx() as s:
        return list(s.scalars(select(OutboxDelivery).where(OutboxDelivery.subscriber == subscriber)))


def _make_due(db):
    with db.tx() as s:
        s.execute(update(OutboxDelivery).where(OutboxDelivery.status == "FAILED").values(next_attempt_at=datetime(1970, 1, 1)))


def test_publish_is_rolled_back_with_the_callers_transaction(bus, clean):
    def run():
        with clean.tx() as s:
            bus.publish(s, "T.RolledBack")
            raise RuntimeError("business failure")

    with pytest.raises(RuntimeError, match="business failure"):
        as_system(run)
    with clean.tx() as s:
        assert s.scalar(select(func.count()).select_from(OutboxEvent)) == 0


def test_fans_out_to_every_subscriber_and_delivers(bus, clean):
    seen = []
    bus.subscribe("T.Fanout", "sub.a", lambda e: seen.append(f"a:{e.payload['n']}"))
    bus.subscribe("T.Fanout", "sub.b", lambda e: seen.append(f"b:{e.payload['n']}"))

    def publish():
        with clean.tx() as s:
            bus.publish(s, "T.Fanout", payload={"n": 1})

    as_system(publish)
    bus.run_once()
    assert sorted(seen) == ["a:1", "b:1"]
    with clean.tx() as s:
        assert {d.status for d in s.scalars(select(OutboxDelivery))} == {"DONE"}


def test_retries_with_backoff_then_succeeds(bus, clean):
    calls = {"n": 0}

    def flaky(_e):
        calls["n"] += 1
        if calls["n"] < 3:
            raise RuntimeError(f"boom {calls['n']}")

    bus.subscribe("T.Flaky", "sub.flaky", flaky)

    def publish():
        with clean.tx() as s:
            bus.publish(s, "T.Flaky")

    as_system(publish)
    bus.run_once()
    [d] = _deliveries(clean, "sub.flaky")
    assert (d.status, d.attempts, d.last_error) == ("FAILED", 1, "boom 1")
    bus.run_once()  # not due yet
    assert calls["n"] == 1
    _make_due(clean)
    bus.run_once()
    _make_due(clean)
    bus.run_once()
    [d] = _deliveries(clean, "sub.flaky")
    assert (d.status, d.attempts, d.last_error) == ("DONE", 3, None)


def test_dead_letters_after_max_attempts(bus, clean):
    def broken(_e):
        raise RuntimeError("always")

    bus.subscribe("T.Broken", "sub.broken", broken, max_attempts=2)

    def publish():
        with clean.tx() as s:
            bus.publish(s, "T.Broken")

    as_system(publish)
    bus.run_once()
    _make_due(clean)
    bus.run_once()
    [d] = _deliveries(clean, "sub.broken")
    assert (d.status, d.attempts) == ("DEAD", 2)


def test_non_retryable_is_dead_at_once_and_replay_reruns_it(bus, clean):
    state = {"fixed": False}

    def refused(_e):
        if not state["fixed"]:
            raise NonRetryableError("refused")

    bus.subscribe("T.Refused", "sub.refused", refused)

    def publish():
        with clean.tx() as s:
            bus.publish(s, "T.Refused")

    as_system(publish)
    bus.run_once()
    [d] = _deliveries(clean, "sub.refused")
    assert (d.status, d.attempts) == ("DEAD", 1)
    state["fixed"] = True
    assert as_system(lambda: bus.replay_all("sub.refused")) == 1
    bus.run_once()
    assert _deliveries(clean, "sub.refused")[0].status == "DONE"
