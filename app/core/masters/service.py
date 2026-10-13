"""HSRP masters: states, company, stations, OEMs, dealers and mappings, products, vehicle categories."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints, create_model
from pydantic.alias_generators import to_camel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.contracts.enums import VehicleClass, VehicleType
from app.contracts.schemas import Email
from app.core.masters.models import Company, Dealer, DealerOem, Oem, Product, State, Station, VehicleCategory
from app.core.shared.subjects import APPROVAL, SUBJECT
from app.platform.context import request_context
from app.platform.db.base import Base
from app.platform.db.session import Database
from app.platform.http.json import row
from app.platform.http.problem import Problem
from app.utility.approvals.service import ApprovalsService
from app.utility.audit.service import AuditService
from app.utility.identity.service import IdentityService
from app.utility.integration_hub.event_bus import DeliveredEvent, EventBus
from app.utility.scheduling.service import CalendarRule, SchedulingService
from app.utility.wallet.service import WalletService

Code = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=20, pattern=r"^[A-Za-z0-9_-]+$", to_upper=True)]
Name = Annotated[str, StringConstraints(min_length=2)]
StateCode = Annotated[str, StringConstraints(min_length=2, max_length=2)]


class _Body(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


class StateBody(_Body):
    code: Annotated[str, StringConstraints(min_length=2, max_length=2, to_upper=True)]
    name: Name
    rule_pack: Name
    active: bool = True


class CompanyBody(_Body):
    code: Code
    name: Name
    address: str | None = None
    gstin: str | None = None


class StationBody(_Body):
    code: Code
    name: Name
    company_id: str
    state_code: StateCode
    city: Name
    address: str | None = None
    active: bool = True


class OemBody(_Body):
    code: Code
    name: Name
    integration: Literal["API", "CSV"]
    requires_catalogue_check: bool = False
    import_profile_code: str | None = None
    active: bool = True


class DealerBody(_Body):
    code: Code
    name: Name
    state_code: StateCode
    city: Name
    address: str | None = None
    mobile: str | None = None
    email: Email | None = None
    station_id: str
    wallet_group: Name
    accepts_customer_orders: bool = True


class DealerOemBody(_Body):
    dealer_id: str
    oem_id: str


class ProductBody(_Body):
    code: Code
    name: Name
    size_mm: Annotated[str, StringConstraints(min_length=3)]
    active: bool = True


class VehicleCategoryBody(_Body):
    vahan_category: Annotated[str, StringConstraints(min_length=2, to_upper=True)]
    description: Name
    vehicle_class: VehicleClass
    vehicle_type: VehicleType
    front_product_code: str
    rear_product_code: str
    sticker_required: bool = False


@dataclass(frozen=True)
class MasterResource:
    model: type[Base]
    label: str
    order_by: str
    create: type[_Body]


# Field schemas for the generic master screens. Keys are URL names.
MASTER_RESOURCES: dict[str, MasterResource] = {
    "states": MasterResource(State, "States", "code", StateBody),
    "companies": MasterResource(Company, "Companies", "code", CompanyBody),
    "stations": MasterResource(Station, "Embossing stations", "code", StationBody),
    "oems": MasterResource(Oem, "OEMs", "code", OemBody),
    "dealers": MasterResource(Dealer, "Dealers", "code", DealerBody),
    "dealer-oems": MasterResource(DealerOem, "Dealer ↔ OEM mapping", "created_at", DealerOemBody),
    "products": MasterResource(Product, "Products (plate sizes)", "code", ProductBody),
    "vehicle-categories": MasterResource(VehicleCategory, "Vehicle categories", "vahan_category", VehicleCategoryBody),
}
_SEARCHABLE = {"states", "companies", "stations", "oems", "dealers", "products"}
_PARTIAL: dict[type[_Body], type[_Body]] = {}


def _partial(model: type[_Body]) -> type[_Body]:
    """The create schema with every field optional and no defaults (zod .partial())."""
    if model not in _PARTIAL:
        fields = {name: (f.annotation | None, None) for name, f in model.model_fields.items()}
        _PARTIAL[model] = create_model(f"{model.__name__}Patch", __base__=_Body, **fields)  # type: ignore[call-overload]
    return _PARTIAL[model]


def _resource(name: str) -> MasterResource:
    r = MASTER_RESOURCES.get(name)
    if r is None:
        raise Problem.not_found("Master")
    return r


class MastersService:
    def __init__(
        self,
        db: Database,
        audit: AuditService,
        identity: IdentityService,
        wallets: WalletService,
        scheduling: SchedulingService,
        approvals: ApprovalsService,
        bus: EventBus,
    ):
        self.db = db
        self.audit = audit
        self.identity = identity
        self.wallets = wallets
        self.scheduling = scheduling
        self.approvals = approvals
        bus.subscribe("ApprovalDecided", "masters.dealer-onboarding", self._on_onboarding_decided)

    def _on_onboarding_decided(self, e: DeliveredEvent) -> None:
        if e.payload.get("approvalType") != APPROVAL.dealer_onboarding:
            return
        status = "ACTIVE" if e.payload.get("decision") == "APPROVED" else "REJECTED"
        with self.db.tx() as s:
            d = s.get(Dealer, str(e.payload.get("subjectId")))
            if d is None:
                raise Problem(404, "Not found", "Record not found", "not-found")
            d.status = status

    def list(self, resource: str, q: str | None = None) -> list[Base]:
        r = _resource(resource)
        model: Any = r.model
        stmt = select(model).where(model.tenant_id == request_context.tenant_id())
        if q and resource in _SEARCHABLE:
            stmt = stmt.where(or_(model.code.ilike(f"%{_like(q)}%", escape="\\"), model.name.ilike(f"%{_like(q)}%", escape="\\")))
        with self.db.tx() as s:
            return list(s.scalars(stmt.order_by(getattr(model, r.order_by)).limit(500)))

    def create(self, resource: str, body: Any) -> Base:
        r = _resource(resource)
        data = r.create.model_validate(body or {}).model_dump()
        with self.db.tx() as s:
            if resource == "dealers":
                obj: Any = self._create_dealer(s, data)
            else:
                obj = r.model(tenant_id=request_context.tenant_id(), **data)
                s.add(obj)
                s.flush()
            if resource == "stations":
                self._ensure_station_org(s, obj)
            if resource == "oems":
                self._ensure_oem_setup(s, obj)
            self.audit.record(f"master.{resource}.create", f"hsrp.master.{resource}", str(obj.id), after=row(obj), s=s)
            return obj

    def update(self, resource: str, id: str, body: Any) -> Base:
        r = _resource(resource)
        patch = _partial(r.create).model_validate(body or {}).model_dump(exclude_unset=True)
        model: Any = r.model
        with self.db.tx() as s:
            obj = s.scalar(select(model).where(model.id == id, model.tenant_id == request_context.tenant_id()))
            if obj is None:
                raise Problem.not_found("Record")
            before = row(obj)
            for k, v in patch.items():
                setattr(obj, k, v)
            s.flush()
            self.audit.record(f"master.{resource}.update", f"hsrp.master.{resource}", id, before, row(obj), s=s)
            return obj

    def _create_dealer(self, s: Session, data: dict[str, Any]) -> Dealer:
        """New dealers get an org node, a (possibly shared) wallet, a fitment calendar, and wait for onboarding approval."""
        tenant_id = request_context.tenant_id()
        station = s.scalar(select(Station).where(Station.id == data["station_id"], Station.tenant_id == tenant_id))
        if station is None:
            raise Problem.bad_request("Unknown station")
        org = self.identity.upsert_org(f"DLR-{data['code']}", data["name"], "DEALER", station.org_id, s=s)
        wallet = self.wallets.open_wallet(SUBJECT.wallet_group, data["wallet_group"], f"Wallet {data['wallet_group']}", s=s)
        dealer = Dealer(tenant_id=tenant_id, **data, org_id=org.id, wallet_account_id=wallet.id, status="PENDING")
        s.add(dealer)
        s.flush()
        res = self.scheduling.upsert_resource(f"fitment-{dealer.code}", f"Fitment bay {dealer.name}", SUBJECT.dealer, dealer.id, s=s)
        self.scheduling.set_calendar(res.id, [CalendarRule(weekday, "10:00", "17:00", 60, 4) for weekday in range(1, 7)], s=s)
        self.approvals.request(
            s,
            APPROVAL.dealer_onboarding,
            SUBJECT.dealer,
            dealer.id,
            "OPERATIONS",
            f"Onboard dealer {dealer.code} {dealer.name}",
            {"city": dealer.city, "stateCode": dealer.state_code},
        )
        return dealer

    def _ensure_station_org(self, s: Session, station: Station) -> None:
        org = self.identity.upsert_org(f"STN-{station.code}", station.name, "STATION", s=s)
        station.org_id = org.id
        s.flush()

    def _ensure_oem_setup(self, s: Session, oem: Oem) -> None:
        org = self.identity.upsert_org(f"OEM-{oem.code}", oem.name, "OEM", s=s)
        wallet = self.wallets.open_wallet(SUBJECT.oem, oem.code, f"OEM {oem.name}", 50_000_000, s=s)
        oem.org_id, oem.wallet_account_id = org.id, wallet.id
        s.flush()

    # ------------------------------------------------------------ lookups used by other core modules

    def dealer_by_code(self, code: str, s: Session | None = None) -> Dealer:
        with self.db.use(s) as session:
            d = session.scalar(select(Dealer).where(Dealer.tenant_id == request_context.tenant_id(), Dealer.code == code.upper()))
        if d is None:
            raise Problem.unprocessable(f"Unknown dealer {code}", "dealer-unknown")
        return d

    def dealer(self, id: str, s: Session | None = None) -> Dealer:
        with self.db.use(s) as session:
            d = session.scalar(select(Dealer).where(Dealer.id == id, Dealer.tenant_id == request_context.tenant_id()))
        if d is None:
            raise Problem.not_found("Dealer")
        return d

    def dealers(self, ids: list[str], s: Session | None = None) -> list[Dealer]:
        with self.db.use(s) as session:
            return list(session.scalars(select(Dealer).where(Dealer.id.in_(ids))))

    def dealer_for_org(self, org_id: str | None, s: Session | None = None) -> Dealer | None:
        if not org_id:
            return None
        with self.db.use(s) as session:
            return session.scalar(select(Dealer).where(Dealer.org_id == org_id, Dealer.tenant_id == request_context.tenant_id()))

    def station_for_org(self, org_id: str | None, s: Session | None = None) -> Station | None:
        if not org_id:
            return None
        with self.db.use(s) as session:
            return session.scalar(select(Station).where(Station.org_id == org_id, Station.tenant_id == request_context.tenant_id()))

    def oem_for_org(self, org_id: str | None) -> Oem | None:
        if not org_id:
            return None
        with self.db.tx() as s:
            return s.scalar(select(Oem).where(Oem.org_id == org_id, Oem.tenant_id == request_context.tenant_id()))

    def station(self, id: str, s: Session | None = None) -> Station:
        with self.db.use(s) as session:
            st = session.scalar(select(Station).where(Station.id == id, Station.tenant_id == request_context.tenant_id()))
        if st is None:
            raise Problem.not_found("Station")
        return st

    def station_by_code(self, code: str, s: Session | None = None) -> Station:
        with self.db.use(s) as session:
            st = session.scalar(select(Station).where(Station.tenant_id == request_context.tenant_id(), Station.code == code.upper()))
        if st is None:
            raise Problem.bad_request(f"Unknown station {code}")
        return st

    def product_by_code(self, code: str, s: Session | None = None) -> Product:
        with self.db.use(s) as session:
            p = session.scalar(select(Product).where(Product.tenant_id == request_context.tenant_id(), Product.code == code.upper()))
        if p is None:
            raise Problem.bad_request(f"Unknown product {code}")
        return p

    def stations(self) -> list[Station]:
        with self.db.tx() as s:
            return list(s.scalars(select(Station).where(Station.tenant_id == request_context.tenant_id()).order_by(Station.code)))

    def oem_by_code(self, code: str, s: Session | None = None) -> Oem:
        with self.db.use(s) as session:
            o = session.scalar(select(Oem).where(Oem.tenant_id == request_context.tenant_id(), Oem.code == code.upper()))
        if o is None:
            raise Problem.unprocessable(f"Unknown OEM {code}", "oem-unknown")
        return o

    def oem(self, id: str, s: Session | None = None) -> Oem | None:
        with self.db.use(s) as session:
            return session.scalar(select(Oem).where(Oem.id == id, Oem.tenant_id == request_context.tenant_id()))

    def oems(self) -> list[Oem]:
        with self.db.tx() as s:
            return list(s.scalars(select(Oem).where(Oem.tenant_id == request_context.tenant_id()).order_by(Oem.code)))

    def dealers_for_oem(self, oem_id: str) -> list[Dealer]:
        """Dealers mapped to an OEM (the OEM × dealer pairs billing is configured for)."""
        with self.db.tx() as s:
            ids = s.scalars(select(DealerOem.dealer_id).where(DealerOem.oem_id == oem_id)).all()
            return list(s.scalars(select(Dealer).where(Dealer.id.in_(ids)).order_by(Dealer.code)))

    def dealer_serves_oem(self, dealer_id: str, oem_id: str, s: Session | None = None) -> bool:
        with self.db.use(s) as session:
            return session.scalar(select(DealerOem.id).where(DealerOem.dealer_id == dealer_id, DealerOem.oem_id == oem_id)) is not None

    def state(self, code: str, s: Session | None = None) -> State:
        with self.db.use(s) as session:
            st = session.scalar(select(State).where(State.tenant_id == request_context.tenant_id(), State.code == code))
        if st is None or not st.active:
            raise Problem.unprocessable(f"State {code} is not served", "state-not-served")
        return st

    def vehicle_category(self, vahan_category: str, s: Session | None = None) -> VehicleCategory | None:
        with self.db.use(s) as session:
            return session.scalar(
                select(VehicleCategory).where(VehicleCategory.tenant_id == request_context.tenant_id(), VehicleCategory.vahan_category == vahan_category.upper())
            )

    def fitment_centres(self, state_code: str, city: str | None = None) -> list[dict[str, Any]]:
        """Dealers that fit plates for customers, optionally in one city."""
        q = select(Dealer).where(
            Dealer.tenant_id == request_context.tenant_id(), Dealer.state_code == state_code, Dealer.status == "ACTIVE", Dealer.accepts_customer_orders.is_(True)
        )
        if city:
            q = q.where(func.lower(Dealer.city) == city.lower())
        with self.db.tx() as s:
            rows = s.scalars(q.order_by(Dealer.name)).all()
        return [{"id": d.id, "code": d.code, "name": d.name, "city": d.city, "address": d.address, "stateCode": d.state_code} for d in rows]

    def active_states(self) -> list[State]:
        with self.db.tx() as s:
            return list(s.scalars(select(State).where(State.tenant_id == request_context.tenant_id(), State.active.is_(True)).order_by(State.name)))


def _like(q: str) -> str:
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
