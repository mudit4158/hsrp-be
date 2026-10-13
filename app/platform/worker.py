"""The worker: outbox dispatch and scheduled jobs. Runs inside the API process when WORKER_ENABLED=true, so it can
move to its own process later by starting the same container without the HTTP server."""

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.platform.config import env
from app.platform.context import request_context

log = logging.getLogger("Worker")

TICK_S = 15


@dataclass
class _Job:
    name: str
    every_ms: int
    run: Callable[[], Any]
    last_run: float
    busy: bool = False


class Scheduler:
    def __init__(self) -> None:
        self._jobs: list[_Job] = []
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def every(self, name: str, every_ms: int, run: Callable[[], Any]) -> None:
        """Registers a recurring job. `run` executes as the system actor of the default tenant."""
        self._jobs.append(_Job(name, every_ms, run, time.time()))

    def run_now(self, name: str) -> Any:
        job = next((j for j in self._jobs if j.name == name), None)
        if job is None:
            raise ValueError(f"Unknown job {name}")
        return request_context.run_as_system(env.default_tenant_id, job.run)

    def job_names(self) -> list[dict[str, Any]]:
        return [{"name": j.name, "everyMs": j.every_ms, "lastRun": datetime.fromtimestamp(j.last_run, UTC)} for j in self._jobs]

    def start(self, bus: Any) -> None:
        if not env.worker_enabled:
            log.info("WORKER_ENABLED=false: outbox and scheduled jobs are not running in this process")
            return
        bus.start()
        self._stop.clear()

        def loop() -> None:
            while not self._stop.wait(TICK_S):
                self.tick()

        self._thread = threading.Thread(target=loop, name="scheduler", daemon=True)
        self._thread.start()
        log.info("Scheduled jobs: %s", ", ".join(j.name for j in self._jobs) or "none")

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)
        self._thread = None

    def tick(self) -> None:
        now = time.time()
        for job in self._jobs:
            if job.busy or (now - job.last_run) * 1000 < job.every_ms:
                continue
            job.busy = True
            job.last_run = now
            try:
                request_context.run_as_system(env.default_tenant_id, job.run)
            except Exception as e:
                log.error("Job %s failed: %s", job.name, e)
            finally:
                job.busy = False
