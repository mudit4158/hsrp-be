"""Retry rules for outbox deliveries. Pure, so they are unit-tested directly."""

from dataclasses import dataclass
from datetime import datetime, timedelta


def backoff_ms(attempt: int, base_ms: int, cap_ms: int = 5 * 60_000) -> int:
    """Delay before retry number `attempt` (1-based): base × 2^(attempt-1), capped."""
    n = max(1, attempt)
    return min(cap_ms, base_ms * 2 ** (n - 1))


@dataclass(frozen=True)
class DeliveryOutcome:
    # DONE | FAILED | DEAD
    status: str
    attempts: int
    next_attempt_at: datetime | None = None


def next_delivery_state(*, succeeded: bool, non_retryable: bool = False, attempts_so_far: int, max_attempts: int, now: datetime, base_ms: int) -> DeliveryOutcome:
    """What happens to a delivery after a handler run."""
    attempts = attempts_so_far + 1
    if succeeded:
        return DeliveryOutcome("DONE", attempts)
    if non_retryable or attempts >= max_attempts:
        return DeliveryOutcome("DEAD", attempts)
    return DeliveryOutcome("FAILED", attempts, now + timedelta(milliseconds=backoff_ms(attempts, base_ms)))
