"""Composition root (app.module.ts): builds every service once, in dependency order platform → utility → adapters →
core. Modules reach it through app.platform.registry.services(), which container() registers."""

from typing import Any

from app.adapters.file_store.db_file_store import DbFileStore
from app.adapters.messaging.senders import MockMessageSender, RealMessageSender
from app.adapters.mock_state import MockStateService
from app.adapters.ocr.plate_readers import plate_reader
from app.adapters.oem.mock_oem import MockOemCatalog, MockOrderSource, RealOemCatalog, RealOrderSource
from app.adapters.payment.mock_payu import MockPayuAdapter, RealPayuAdapter
from app.adapters.vahan.mock_vahan import MockVahanAdapter, RealVahanAdapter
from app.core.billing.service import BillingService
from app.core.booking.service import BookingService
from app.core.dispatch.service import DispatchService
from app.core.fitment.service import FitmentService
from app.core.inventory.service import InventoryService
from app.core.masters.scope import ScopeService
from app.core.masters.service import MastersService
from app.core.order_intake.flow import OrderFlowService
from app.core.order_intake.oem_intake import OemIntakeService
from app.core.order_intake.oem_vehicle_data import OemVehicleDataService
from app.core.order_intake.orders import OrderService
from app.core.oversight.audit_reports import register_audit_reports
from app.core.oversight.reports import register_reports
from app.core.oversight.service import OversightService
from app.core.pricing.service import PricingService
from app.core.production.service import ProductionService
from app.core.rejection.service import RejectionService
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


def bind(env_name: str, value: str, mock: type, real: type, *args: Any) -> Any:
    """The mock (or db) or real adapter according to the environment variable's value."""
    if value in ("mock", "db"):
        return mock(*args)
    if value == "real":
        return real(*args)
    raise RuntimeError(f'{env_name} must be "mock" or "real", got "{value}"')


class Container:
    def __init__(self, db: Database):
        self.db = db
        self.scheduler = Scheduler()

        # adapters (bound to the ports the utilities and core declare)
        self.mock_state = MockStateService(db)
        self.message_sender = bind("MESSAGE_ADAPTER", env.adapters.message, MockMessageSender, RealMessageSender, db)
        self.file_store = bind("FILE_STORE_ADAPTER", env.adapters.file_store, DbFileStore, DbFileStore, db)
        self.payment_provider = bind("PAYMENT_ADAPTER", env.adapters.payment, MockPayuAdapter, RealPayuAdapter, db)
        self.vahan = bind("VAHAN_ADAPTER", env.adapters.vahan, MockVahanAdapter, RealVahanAdapter, db, self.mock_state)
        self.order_source = bind("OEM_ADAPTER", env.adapters.oem, MockOrderSource, RealOrderSource, db)
        self.oem_catalog = bind("OEM_ADAPTER", env.adapters.oem, MockOemCatalog, RealOemCatalog, db)
        self.plate_reader = plate_reader(env.adapters.ocr)

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

        # core
        self.masters = MastersService(db, self.audit, self.identity, self.wallets, self.scheduling, self.approvals, self.bus)
        self.scope = ScopeService(self.masters)
        self.pricing = PricingService(db, self.audit)
        self.inventory = InventoryService(db, self.audit, self.imports, self.masters)
        self.orders = OrderService(db, self.bus, self.documents, self.masters, self.scope, self.files, self.audit)
        self.oem_data = OemVehicleDataService(db, self.masters, self.imports)
        self.order_flow = OrderFlowService(
            db,
            self.orders,
            self.masters,
            self.pricing,
            self.settings,
            self.wallets,
            self.payments,
            self.approvals,
            self.notifications,
            self.call_log,
            self.bus,
            self.oem_data,
            self.vahan,
            self.oem_catalog,
            self.order_source,
        )
        self.oem_intake = OemIntakeService(db, self.orders, self.masters, self.imports, self.order_source)
        self.booking = BookingService(db, self.scheduling, self.masters, self.orders, self.settings, self.bus)
        self.rejections = RejectionService(db, self.orders, self.inventory, self.masters, self.approvals, self.bus)
        self.production = ProductionService(
            db,
            self.orders,
            self.inventory,
            self.rejections,
            self.masters,
            self.scope,
            self.documents,
            self.audit,
            self.bus,
            self.files,
            self.settings,
            self.plate_reader,
        )
        self.dispatch = DispatchService(db, self.orders, self.inventory, self.rejections, self.masters, self.scope, self.documents, self.bus)
        self.fitment = FitmentService(
            db,
            self.orders,
            self.inventory,
            self.scope,
            self.files,
            self.settings,
            self.notifications,
            self.call_log,
            self.bus,
            self.vahan,
            self.plate_reader,
        )
        self.billing = BillingService(db, self.settings, self.masters, self.orders, self.documents, self.files, self.notifications, self.audit, self.bus)
        self.oversight = OversightService(self)
        register_reports(self.reporting, self.oversight)
        register_audit_reports(self.reporting, self.oversight)

        # scheduled jobs (worker), as the NestJS modules registered them
        self.scheduler.every("orders.retry-awaiting-funds", 2 * 60_000, lambda: self.order_flow.retry_awaiting_funds())
        self.scheduler.every("fitment.vahan-eod-alert", 60_000, lambda: self.fitment.end_of_day_alert())
        # Hourly check; each OEM's cycle is closed once after its boundary (Monday or the 1st, 00:00 IST).
        self.scheduler.every("billing.close-cycles", 60 * 60_000, lambda: self.billing.close_due_cycles())

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
