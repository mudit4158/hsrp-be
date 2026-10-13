"""Composition root (app.module.ts): builds every service once, in dependency order platform → utility → adapters →
core. Modules reach it through app.platform.registry.services(), which container() registers."""

from app.platform import registry
from app.platform.db.session import Database, get_db
from app.platform.worker import Scheduler
from app.utility.audit.service import AuditService
from app.utility.identity.api_clients import ApiClientService
from app.utility.identity.devices import DeviceService
from app.utility.integration_hub.call_log import CallLogService
from app.utility.integration_hub.event_bus import EventBus
from app.utility.integration_hub.idempotency import IdempotencyService


class Container:
    def __init__(self, db: Database):
        self.db = db
        self.scheduler = Scheduler()
        # utility
        self.audit = AuditService(db)
        self.bus = EventBus(db)
        self.idempotency = IdempotencyService(db)
        self.call_log = CallLogService(db)
        self.api_clients = ApiClientService(db)
        self.devices = DeviceService(db)

    def start(self) -> None:
        self.scheduler.start(self.bus)

    def stop(self) -> None:
        self.scheduler.stop()
        self.bus.stop()


_container: Container | None = None


def container() -> Container:
    global _container
    if _container is None:
        _container = Container(get_db())
        registry.register(_container)
    return _container


def reset_container() -> None:
    """Tests rebuild the container after pointing the app at another database."""
    global _container
    if _container is not None:
        _container.stop()
    _container = None
