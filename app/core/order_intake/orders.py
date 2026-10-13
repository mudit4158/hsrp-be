"""Order intake: one canonical order for every channel, and the owner of the order state machine."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.orm import Session

from app.core.masters.scope import ScopeService
from app.core.masters.service import MastersService
from app.core.order_intake.models import Order, OrderStatusHistory, OrderValidation
from app.core.order_intake.state_machine import FINAL_STATUSES, TransitionError, assert_transition, positions_of
from app.core.shared.subjects import SUBJECT
from app.platform.context import request_context
from app.platform.db.base import naive_utc, utcnow
from app.platform.db.filters import where_of
from app.platform.db.session import Database
from app.platform.http.json import row, to_jsonable
from app.platform.http.problem import Problem
from app.utility.audit.service import AuditService
from app.utility.documents.service import DocumentsService
from app.utility.file_storage.service import FileService
from app.utility.integration_hub.event_bus import EventBus

STATUS_EVENTS = {
    "VALIDATED": "OrderValidated",
    "REJECTED": "OrderRejected",
    "CONFIRMED": "OrderConfirmed",
    "CANCELLED": "OrderCancelled",
    "COMPLETED": "OrderCompleted",
}
_ORDER_COLUMNS = {a.key for a in Order.__mapper__.column_attrs}


@dataclass
class NewOrder:
    regn_no: str
    chassis_no: str
    engine_no: str
    channel: str
    order_type: str = "NEW"
    plate_set: str = "BOTH"
    replacement_reason: str | None = None
    evidence_file_id: str | None = None
    state_code: str | None = None
    owner_name: str | None = None
    mobile: str | None = None
    email: str | None = None
    remarks: str | None = None
    dealer_id: str | None = None
    oem_id: str | None = None
    source_ref: str | None = None


class OrderService:
    def __init__(
        self,
        db: Database,
        bus: EventBus,
        docs: DocumentsService,
        masters: MastersService,
        scope: ScopeService,
        files: FileService,
        audit: AuditService,
    ):
        self.db = db
        self.bus = bus
        self.docs = docs
        self.masters = masters
        self.scope = scope
        self.files = files
        self.audit = audit

    def create(self, s: Session, n: NewOrder) -> Order:
        """Creates a RECEIVED order and publishes OrderReceived; validation runs from the outbox."""
        tenant_id = request_context.tenant_id()
        dealer = self.masters.dealer(n.dealer_id, s) if n.dealer_id else None
        if dealer and dealer.status != "ACTIVE":
            raise Problem.unprocessable(f"Dealer {dealer.code} is not active", "dealer-inactive")
        state_code = (n.state_code or (dealer.state_code if dealer else "") or "").upper()
        if not state_code:
            raise Problem.bad_request("State is required", "state-required")
        self.masters.state(state_code, s)
        if n.oem_id and dealer and not self.masters.dealer_serves_oem(dealer.id, n.oem_id, s):
            raise Problem.unprocessable(f"Dealer {dealer.code} is not mapped to this OEM", "dealer-oem-mapping")
        if n.order_type == "REPLACEMENT":
            if not n.replacement_reason:
                raise Problem.bad_request("Replacement reason is required (DAMAGED or THEFT)", "replacement-reason")
            if not n.evidence_file_id:
                raise Problem.bad_request(
                    "Attach the police report" if n.replacement_reason == "THEFT" else "Attach a photo of the damaged plate", "evidence-required"
                )
        open_ = s.scalar(select(Order).where(Order.tenant_id == tenant_id, Order.regn_no == n.regn_no, Order.status.not_in(FINAL_STATUSES)))
        if open_ is not None:
            raise Problem.conflict(
                f"An open order {open_.order_no} already exists for {n.regn_no}", "order-exists", {"orderId": open_.id, "orderNo": open_.order_no}
            )

        order_no = self.docs.next_number("order", s, {"STATE": state_code})
        order = Order(
            tenant_id=tenant_id,
            order_no=order_no,
            channel=n.channel,
            order_type=n.order_type,
            plate_set=n.plate_set,
            replacement_reason=n.replacement_reason,
            evidence_file_id=n.evidence_file_id,
            status="RECEIVED",
            state_code=state_code,
            regn_no=n.regn_no,
            chassis_no=n.chassis_no,
            engine_no=n.engine_no,
            dealer_id=dealer.id if dealer else None,
            station_id=dealer.station_id if dealer else None,
            oem_id=n.oem_id,
            source_ref=n.source_ref,
            pending_positions=positions_of(n.plate_set),
            owner_name=n.owner_name,
            mobile=n.mobile,
            email=n.email,
            remarks=n.remarks,
            created_by=request_context.actor_id(),
        )
        s.add(order)
        s.flush()
        if n.evidence_file_id:
            self.files.attach(n.evidence_file_id, SUBJECT.order, order.id, "replacement-evidence", s=s)
        s.add(OrderStatusHistory(tenant_id=tenant_id, order_id=order.id, to_status="RECEIVED", trigger=f"received:{n.channel}", actor_id=request_context.actor_id()))
        self.bus.publish(s, "OrderReceived", SUBJECT.order, order.id, {"orderId": order.id, "orderNo": order_no, "channel": n.channel})
        self.audit.record(
            "order.create", SUBJECT.order, order.id, after={"orderNo": order_no, "channel": n.channel, "regnNo": n.regn_no, "orderType": n.order_type}, s=s
        )
        return order

    def transition(self, s: Session, order_id: str, to: str, trigger: str, patch: dict[str, Any] | None = None, note: str | None = None) -> Order:
        """The only way an order changes status. Locks the row, checks the state machine, writes history, and publishes
        OrderStatusChanged (plus the specific event for key statuses) in the same transaction."""
        s.execute(text("SELECT id FROM core_ord_order WHERE id = :id FOR UPDATE"), {"id": order_id})
        order = s.scalar(select(Order).where(Order.id == order_id).execution_options(populate_existing=True))
        if order is None:
            raise Problem.not_found("Order")
        try:
            assert_transition(order.status, to)
        except TransitionError:
            raise Problem.conflict(f"Order {order.order_no} is {order.status}; it cannot move to {to}", "invalid-transition") from None
        from_status = order.status
        for k, v in (patch or {}).items():
            if k not in _ORDER_COLUMNS:
                raise ValueError(f"Unknown order field {k}")
            setattr(order, k, v)
        order.status = to
        s.add(OrderStatusHistory(tenant_id=order.tenant_id, order_id=order_id, from_status=from_status, to_status=to, trigger=trigger, actor_id=request_context.actor_id(), note=note))
        s.flush()
        payload = {"orderId": order_id, "orderNo": order.order_no, "from": from_status, "status": to, "trigger": trigger, "channel": order.channel, "reason": note}
        self.bus.publish(s, "OrderStatusChanged", SUBJECT.order, order_id, payload)
        specific = STATUS_EVENTS.get(to)
        if specific:
            self.bus.publish(s, specific, SUBJECT.order, order_id, payload)
        return order

    def update(self, s: Session, order_id: str, **fields: Any) -> Order:
        """Updates fields the order module owns on behalf of other modules (never the status)."""
        allowed = {"pending_positions", "payment_id", "wallet_hold_id", "approval_id", "remarks", "rejection_reason"}
        order = s.get_one(Order, order_id)
        for k, v in fields.items():
            if k not in allowed:
                raise ValueError(f"Order field {k} cannot be updated here")
            setattr(order, k, v)
        s.flush()
        return order

    def get(self, id: str, s: Session | None = None) -> Order:
        with self.db.use(s) as session:
            o = session.scalar(select(Order).where(Order.id == id, Order.tenant_id == request_context.tenant_id()).execution_options(populate_existing=True))
        if o is None:
            raise Problem.not_found("Order")
        return o

    def get_scoped(self, id: str) -> Order:
        """An order the current actor may see."""
        conds = self.scope.conditions(Order)
        with self.db.tx() as s:
            o = s.scalar(select(Order).where(Order.id == id, Order.tenant_id == request_context.tenant_id(), *conds))
        if o is None:
            raise Problem.not_found("Order")
        return o

    def by_ids(self, ids: list[str], s: Session | None = None) -> list[Order]:
        with self.db.use(s) as session:
            return list(session.scalars(select(Order).where(Order.id.in_(ids), Order.tenant_id == request_context.tenant_id())))

    def by_order_no(self, order_no: str) -> Order:
        with self.db.tx() as s:
            o = s.scalar(select(Order).where(Order.tenant_id == request_context.tenant_id(), Order.order_no == order_no))
        if o is None:
            raise Problem.not_found("Order")
        return o

    def find_by_source_ref(self, oem_id: str, source_ref: str) -> Order | None:
        with self.db.tx() as s:
            return s.scalar(select(Order).where(Order.tenant_id == request_context.tenant_id(), Order.oem_id == oem_id, Order.source_ref == source_ref))

    def find(self, filters: dict[str, Any], order_by: str = "created_at", desc: bool = False, limit: int = 500, s: Session | None = None) -> list[Order]:
        """Orders matching plain-data filters (see app.platform.db.filters)."""
        col = getattr(Order, order_by)
        with self.db.use(s) as session:
            return list(
                session.scalars(
                    select(Order)
                    .where(Order.tenant_id == request_context.tenant_id(), *where_of(Order, filters))
                    .order_by(col.desc() if desc else col)
                    .limit(limit)
                )
            )

    def list(
        self,
        page: int,
        page_size: int,
        status: str | None = None,
        channel: str | None = None,
        dealer_id: str | None = None,
        station_id: str | None = None,
        state_code: str | None = None,
        q: str | None = None,
        from_: str | None = None,
        to: str | None = None,
    ) -> dict[str, Any]:
        conds = [Order.tenant_id == request_context.tenant_id(), *self.scope.conditions(Order)]
        if status:
            conds.append(Order.status.in_(status.split(",")))
        if channel:
            conds.append(Order.channel.in_(channel.split(",")))
        if dealer_id:
            conds.append(Order.dealer_id == dealer_id)
        if station_id:
            conds.append(Order.station_id == station_id)
        if state_code:
            conds.append(Order.state_code == state_code)
        if q:
            up = q.upper()
            conds.append(or_(Order.order_no.contains(up, autoescape=True), Order.regn_no.contains(up, autoescape=True), Order.chassis_no.contains(up, autoescape=True)))
        if from_:
            conds.append(Order.created_at >= _js_date(from_))
        if to:
            # The whole "to" day in India time.
            conds.append(Order.created_at <= datetime.fromisoformat(to[:10]) + timedelta(hours=23, minutes=59, seconds=59) - timedelta(hours=5, minutes=30))
        with self.db.tx() as s:
            items = s.scalars(select(Order).where(*conds).order_by(Order.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
            total = s.scalar(select(func.count()).select_from(Order).where(*conds)) or 0
        dealers = {d.id: f"{d.code} · {d.name}" for d in self.masters.dealers(list({i.dealer_id for i in items if i.dealer_id}))}
        return {"items": [{**row(o), "dealerName": dealers.get(o.dealer_id) if o.dealer_id else None} for o in items], "total": total, "page": page, "pageSize": page_size}

    def history(self, order_id: str) -> list[OrderStatusHistory]:
        return self.history_for([order_id])

    def validations(self, order_id: str, s: Session | None = None) -> list[OrderValidation]:
        with self.db.use(s) as session:
            return list(session.scalars(select(OrderValidation).where(OrderValidation.order_id == order_id).order_by(OrderValidation.created_at)))

    def history_for(self, order_ids: list[str]) -> list[OrderStatusHistory]:
        """Status changes of many orders, oldest first (order history report)."""
        with self.db.tx() as s:
            return list(s.scalars(select(OrderStatusHistory).where(OrderStatusHistory.order_id.in_(order_ids)).order_by(OrderStatusHistory.created_at).limit(50_000)))

    def validations_for(self, order_ids: list[str], step: str | None = None) -> list[OrderValidation]:
        """Validation step results of many orders, oldest first (validation and OEM history reports)."""
        q = select(OrderValidation).where(OrderValidation.order_id.in_(order_ids))
        if step:
            q = q.where(OrderValidation.step == step)
        with self.db.tx() as s:
            return list(s.scalars(q.order_by(OrderValidation.created_at).limit(50_000)))

    def count_by_status(self, filters: dict[str, Any] | None = None) -> dict[str, int]:
        with self.db.tx() as s:
            rows = s.execute(
                select(Order.status, func.count()).where(Order.tenant_id == request_context.tenant_id(), *where_of(Order, filters)).group_by(Order.status)
            ).all()
        return dict(rows)

    def ageing(self, filters: dict[str, Any] | None = None) -> dict[str, int]:
        """Open orders by age bucket (days since received)."""
        with self.db.tx() as s:
            created = s.scalars(
                select(Order.created_at).where(Order.tenant_id == request_context.tenant_id(), Order.status.not_in(FINAL_STATUSES), *where_of(Order, filters))
            ).all()
        now = utcnow()
        buckets = {"0-2 days": 0, "3-7 days": 0, "8-15 days": 0, "16+ days": 0}
        for c in created:
            d = (now - c).total_seconds() / 86400
            key = "0-2 days" if d < 3 else "3-7 days" if d < 8 else "8-15 days" if d < 16 else "16+ days"
            buckets[key] += 1
        return buckets

    def raw_query(self, filters: dict[str, Any] | None = None, any_of: list[dict[str, Any]] | None = None) -> list[Order]:
        """Up to 5000 orders, newest first; `any_of` adds an OR of filter sets (Prisma's OR)."""
        conds = [Order.tenant_id == request_context.tenant_id(), *where_of(Order, filters)]
        if any_of:
            conds.append(or_(*(and_(True, *where_of(Order, f)) for f in any_of)))
        with self.db.tx() as s:
            return list(s.scalars(select(Order).where(*conds).order_by(Order.created_at.desc()).limit(5000)))

    def save_validation(self, s: Session, order_id: str, step: str, outcome: str, message: str | None = None, data: Any = None) -> OrderValidation:
        v = OrderValidation(tenant_id=request_context.tenant_id(), order_id=order_id, step=step, outcome=outcome, message=message, data=to_jsonable(data))
        s.add(v)
        s.flush()
        return v


def _js_date(s: str) -> datetime:
    """new Date(s) for 'YYYY-MM-DD' (UTC midnight) or a full ISO timestamp, as naive UTC."""
    return naive_utc(datetime.fromisoformat(s.replace("Z", "+00:00")))
