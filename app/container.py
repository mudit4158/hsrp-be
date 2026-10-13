"""Composition root (app.module.ts): builds every service once, in dependency order platform → utility → adapters →
core. Modules reach it through app.platform.registry.services(), which container() registers."""

from typing import Any

from app.adapters.file_store.db_file_store import DbFileStore
from app.adapters.messaging.senders import MockMessageSender, RealMessageSender
from app.adapters.payment.mock_payu import MockPayuAdapter, RealPayuAdapter
from app.platform import registry
from app.platform.config import env
from app.platform.db.session import Database, get_db
from app.platform.worker import Scheduler
from app.utility.approvals.service import ApprovalsService
from app.utility.audit.service import AuditService
from app.utility.configuration.service import SettingsService
from app.utility.documents.service import DocumentsService
from app.utility.file_storage.service import FileService
from app.utility.identity.api_clients import ApiClientService
from app.utility.identity.devices import DeviceService
from app.utility.identity.service import IdentityService
from app.utility.import_export.service import ImportService
from app.utility.integration_hub.call_log import CallLogService
from app.utility.integration_hub.event_bus import EventBus
from app.utility.integration_hub.idempotency import IdempotencyService
from app.utility.notification.service import NotificationService
from app.utility.payments.service import PaymentsService
from app.utility.reporting.service import ReportingService
from app.utility.scheduling.service import SchedulingService
from app.utility.tickets.service import TicketsService
from app.utility.wallet.service import WalletService


def bind(env_name: str, value: str, mock: type, real: type, db: Database) -> Any:
    """The mock (or db) or real adapter according to the environment variable's value."""
    if value in ("mock", "db"):
        return mock(db)
    if value == "real":
        return real(db)
    raise RuntimeError(f'{env_name} must be "mock" or "real", got "{value}"')


class Container:
    def __init__(self, db: Database):
        self.db = db
        self.scheduler = Scheduler()

        # adapters (bound to the ports the utilities and core declare)
        self.message_sender = bind("MESSAGE_ADAPTER", env.adapters.message, MockMessageSender, RealMessageSender, db)
        self.file_store = bind("FILE_STORE_ADAPTER", env.adapters.file_store, DbFileStore, DbFileStore, db)
        self.payment_provider = bind("PAYMENT_ADAPTER", env.adapters.payment, MockPayuAdapter, RealPayuAdapter, db)

        # utility
        self.audit = AuditService(db)
        self.bus = EventBus(db)
        self.idempotency = IdempotencyService(db)
        self.call_log = CallLogService(db)
        self.api_clients = ApiClientService(db)
        self.devices = DeviceService(db)
        self.identity = IdentityService(db, self.devices, self.audit)
        self.settings = SettingsService(db, self.audit)
        self.documents = DocumentsService(db)
        self.files = FileService(db, self.file_store)
        self.notifications = NotificationService(db, self.bus, self.call_log, self.message_sender)
        self.approvals = ApprovalsService(db, self.bus, self.audit)
        self.tickets = TicketsService(db, self.documents, self.bus)
        self.scheduling = SchedulingService(db)
        self.reporting = ReportingService(db)
        self.imports = ImportService(db, self.bus, self.files)
        self.wallets = WalletService(db, self.audit)
        self.payments = PaymentsService(db, self.bus, self.call_log, self.payment_provider)

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
