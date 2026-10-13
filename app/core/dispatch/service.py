"""Delivery challans and dealer inward. A challan holds one dealer's plates and cannot be edited after creation."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.contracts.schemas import InwardRequest
from app.core.dispatch.models import Challan, ChallanLine
from app.core.inventory.service import InventoryService
from app.core.masters.scope import ScopeService
from app.core.masters.service import MastersService
from app.core.order_intake.orders import OrderService
from app.core.rejection.service import RejectionService
from app.core.shared.subjects import SUBJECT, ist_date
from app.platform.context import request_context
from app.platform.db.base import utcnow
from app.platform.db.session import Database
from app.platform.http.json import row
from app.platform.http.problem import Problem
from app.utility.documents.service import DocumentsService
from app.utility.integration_hub.event_bus import EventBus


class DispatchService:
    def __init__(
        self,
        db: Database,
        orders: OrderService,
        inventory: InventoryService,
        rejections: RejectionService,
        masters: MastersService,
        scope: ScopeService,
        docs: DocumentsService,
        bus: EventBus,
    ):
        self.db = db
        self.orders = orders
        self.inventory = inventory
        self.rejections = rejections
        self.masters = masters
        self.scope = scope
        self.docs = docs
        self.bus = bus

    @staticmethod
    def _live_line_allocation_ids(s: Session, allocation_ids: list[str]) -> set[str]:
        """Allocations already on a live challan (not cancelled, not rejected) cannot be dispatched again."""
        lines = s.scalars(select(ChallanLine).where(ChallanLine.allocation_id.in_(allocation_ids), ChallanLine.inward_status.in_(["PENDING", "ACCEPTED"]))).all()
        if not lines:
            return set()
        live = set(s.scalars(select(Challan.id).where(Challan.id.in_({x.challan_id for x in lines}), Challan.status != "CANCELLED")))
        return {x.allocation_id for x in lines if x.challan_id in live}

    def ready(self, station_id: str, dealer_id: str | None = None) -> list[dict[str, Any]]:
        filters: dict[str, Any] = {"status": "STICKER_PRINTED", "station_id": station_id}
        if dealer_id:
            filters["dealer_id"] = dealer_id
        out = []
        with self.db.tx() as s:
            for o in self.orders.find(filters, s=s):
                allocs = self.inventory.active_allocations(o.id, s)
                on_challan = self._live_line_allocation_ids(s, [a.id for a in allocs])
                out.append({**row(o), "toDispatch": [{"position": a.position, "laserCode": a.laser_code} for a in allocs if a.id not in on_challan]})
        return out

    def create(self, station_id: str, dealer_id: str, order_ids: list[str]) -> dict[str, Any]:
        with self.db.tx() as s:
            orders = self.orders.by_ids(order_ids, s)
            if len(orders) != len(order_ids):
                raise Problem.not_found("One or more orders")
            orders.sort(key=lambda o: order_ids.index(o.id))
            for o in orders:
                if o.dealer_id != dealer_id:
                    raise Problem.unprocessable(f"{o.order_no} is for another dealer; a challan holds one dealer's orders only", "mixed-dealers")
                if o.station_id != station_id:
                    raise Problem.unprocessable(f"{o.order_no} belongs to another station", "wrong-station")
                if o.status != "STICKER_PRINTED":
                    raise Problem.conflict(f"{o.order_no} is {o.status}; only STICKER_PRINTED orders can be dispatched", "not-ready")
            challan_no = self.docs.next_number("challan", s)
            c = Challan(tenant_id=request_context.tenant_id(), challan_no=challan_no, station_id=station_id, dealer_id=dealer_id, created_by=request_context.actor_id())
            s.add(c)
            s.flush()
            for o in orders:
                allocs = self.inventory.active_allocations(o.id, s)
                on_challan = self._live_line_allocation_ids(s, [a.id for a in allocs])
                todo = [a for a in allocs if a.id not in on_challan]
                if not todo:
                    raise Problem.conflict(f"{o.order_no} has no plates left to dispatch", "nothing-to-dispatch")
                s.add_all(
                    ChallanLine(tenant_id=c.tenant_id, challan_id=c.id, order_id=o.id, allocation_id=a.id, laser_code=a.laser_code, position=a.position) for a in todo
                )
                s.flush()
                self.orders.transition(s, o.id, "DISPATCHED", "challan-created", {}, f"Challan {challan_no}")
            self.bus.publish(s, "ChallanCreated", SUBJECT.challan, c.id, {"challanId": c.id, "challanNo": challan_no, "dealerId": dealer_id, "orderIds": order_ids})
            challan_id = c.id
        return self.get(challan_id)

    def cancel(self, id: str, reason: str) -> dict[str, Any]:
        """Cancel (and recreate) is the only way to change a challan. Orders go back to STICKER_PRINTED."""
        with self.db.tx() as s:
            s.execute(text("SELECT id FROM core_dsp_challan WHERE id = :id FOR UPDATE"), {"id": id})
            c = s.scalar(select(Challan).where(Challan.id == id, Challan.tenant_id == request_context.tenant_id()).execution_options(populate_existing=True))
            if c is None:
                raise Problem.not_found("Challan")
            if c.status != "CREATED":
                raise Problem.conflict(f"Challan is {c.status}; only an un-inwarded challan can be cancelled", "challan-locked")
            c.status, c.cancel_reason, c.cancelled_at = "CANCELLED", reason, utcnow()
            s.flush()
            order_ids = list(dict.fromkeys(s.scalars(select(ChallanLine.order_id).where(ChallanLine.challan_id == id))))
            for oid in order_ids:
                self.orders.transition(s, oid, "STICKER_PRINTED", "challan-cancelled", {}, f"{c.challan_no}: {reason}")
        return self.get(id)

    def _scope_conds(self) -> list[Any]:
        sc = self.scope.where()
        conds = []
        if sc.get("dealer_id"):
            conds.append(Challan.dealer_id == sc["dealer_id"])
        if sc.get("station_id"):
            conds.append(Challan.station_id == sc["station_id"])
        return conds

    def list(self, status: str | None = None, dealer_id: str | None = None, station_id: str | None = None) -> list[dict[str, Any]]:
        conds = [Challan.tenant_id == request_context.tenant_id(), *self._scope_conds()]
        if status:
            conds.append(Challan.status.in_(status.split(",")))
        if dealer_id:
            conds.append(Challan.dealer_id == dealer_id)
        if station_id:
            conds.append(Challan.station_id == station_id)
        with self.db.tx() as s:
            rows = s.scalars(select(Challan).where(*conds).order_by(Challan.created_at.desc()).limit(200)).all()
            counts = dict(s.execute(select(ChallanLine.challan_id, func.count()).where(ChallanLine.challan_id.in_([r.id for r in rows])).group_by(ChallanLine.challan_id)).all())
        dealers = {d.id: d.name for d in self.masters.dealers(list({r.dealer_id for r in rows}))}
        return [{**row(r), "plates": counts.get(r.id, 0), "dealerName": dealers.get(r.dealer_id)} for r in rows]

    def get(self, id: str) -> dict[str, Any]:
        conds = self._scope_conds()
        with self.db.tx() as s:
            c = s.scalar(select(Challan).where(Challan.id == id, Challan.tenant_id == request_context.tenant_id(), *conds))
            if c is None:
                raise Problem.not_found("Challan")
            lines = s.scalars(select(ChallanLine).where(ChallanLine.challan_id == id).order_by(ChallanLine.order_id, ChallanLine.position)).all()
        orders = {o.id: o for o in self.orders.by_ids(list({x.order_id for x in lines}))}
        out_lines = []
        for x in lines:
            o = orders.get(x.order_id)
            out_lines.append({**row(x), "orderNo": o.order_no if o else None, "regnNo": o.regn_no if o else None, "vehicleClass": o.vehicle_class if o else None})
        return {**row(c), "lines": out_lines}

    def inward(self, id: str, req: InwardRequest) -> dict[str, Any]:
        """Dealer inward: every line accepted or rejected (reason mandatory). A challan can be inwarded once."""
        challan = self.get(id)
        with self.db.tx() as s:
            s.execute(text("SELECT id FROM core_dsp_challan WHERE id = :id FOR UPDATE"), {"id": id})
            c = s.scalar(select(Challan).where(Challan.id == id).execution_options(populate_existing=True))
            if c is None:
                raise Problem(404, "Not found", "Record not found", "not-found")
            if c.status == "INWARDED":
                raise Problem.conflict(f"Challan {c.challan_no} was already inwarded", "already-inwarded")
            if c.status != "CREATED":
                raise Problem.conflict(f"Challan {c.challan_no} is {c.status}", "challan-cancelled")
            lines = s.scalars(select(ChallanLine).where(ChallanLine.challan_id == id)).all()
            decided = {x.line_id: x for x in req.lines}
            missing = [x for x in lines if x.id not in decided]
            if missing:
                raise Problem.bad_request(f"Decide every plate: {', '.join(x.laser_code for x in missing)} not decided", "lines-missing")
            if any(not any(x.id == d.line_id for x in lines) for d in req.lines):
                raise Problem.bad_request("Some lines are not on this challan", "lines-unknown")
            for d in req.lines:
                if d.decision == "REJECT" and not (d.reason or "").strip():
                    raise Problem.bad_request("A reason is mandatory for each rejected plate", "reason-required")

            for x in lines:
                d = decided[x.id]
                x.inward_status = "ACCEPTED" if d.decision == "ACCEPT" else "REJECTED"
                x.reject_reason = d.reason if d.decision == "REJECT" else None
            c.status, c.inwarded_at, c.inwarded_by = "INWARDED", utcnow(), request_context.actor_id()
            s.flush()

            for order_id in dict.fromkeys(x.order_id for x in lines):
                mine = [x for x in lines if x.order_id == order_id]
                rejected = [x for x in mine if decided[x.id].decision == "REJECT"]
                if not rejected:
                    self.orders.transition(s, order_id, "INWARDED", "dealer-inward", {}, f"Challan {c.challan_no}")
                else:
                    reason = "; ".join(f"{x.position}: {decided[x.id].reason}" for x in rejected)
                    positions = [x.position for x in rejected]
                    self.orders.transition(s, order_id, "REJECTION_REVIEW", "dealer-reject", {}, reason)
                    self.rejections.open(s, order_id, "DEALER_INWARD", positions, reason, "INWARDED", id)
                    self.bus.publish(s, "PlateRejectedByDealer", SUBJECT.order, order_id, {"orderId": order_id, "challanId": id, "positions": positions, "reason": reason})
            self.bus.publish(s, "ChallanInwarded", SUBJECT.challan, id, {"challanId": id, "challanNo": c.challan_no, "dealerId": c.dealer_id})
        return self.get(challan["id"])

    def pdf(self, id: str) -> tuple[str, bytes]:
        c = self.get(id)
        station, dealer = self.masters.station(c["stationId"]), self.masters.dealer(c["dealerId"])
        data = {"challan": {**c, "date": ist_date(c["createdAt"]), "plateCount": len(c["lines"])}, "station": row(station), "dealer": row(dealer), "lines": c["lines"]}
        return f"{c['challanNo']}.pdf", self.docs.render("challan", data)

    def lines_for_order(self, order_id: str) -> list[ChallanLine]:
        with self.db.tx() as s:
            return list(s.scalars(select(ChallanLine).where(ChallanLine.order_id == order_id).order_by(ChallanLine.created_at)))

    def lines_for_allocations(self, allocation_ids: list[str]) -> list[ChallanLine]:
        with self.db.tx() as s:
            return list(s.scalars(select(ChallanLine).where(ChallanLine.allocation_id.in_(allocation_ids)).order_by(ChallanLine.created_at)))

    def challans_by_ids(self, ids: list[str]) -> list[Challan]:
        with self.db.tx() as s:
            return list(s.scalars(select(Challan).where(Challan.id.in_(ids))))
