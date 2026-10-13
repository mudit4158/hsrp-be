"""Rejection cases from QC or dealer inward. The station decides through the Approvals utility (remarks mandatory).
Approve: rejected plates are scrapped, only those positions are re-issued. Disapprove: the order returns to the stage
it would have reached."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.inventory.service import InventoryService
from app.core.masters.service import MastersService
from app.core.order_intake.orders import OrderService
from app.core.rejection.models import RejectionCase
from app.core.shared.subjects import APPROVAL, SUBJECT
from app.platform.context import request_context
from app.platform.db.base import utcnow
from app.platform.db.filters import where_of
from app.platform.db.session import Database
from app.platform.http.problem import NonRetryableError
from app.utility.approvals.service import ApprovalsService
from app.utility.integration_hub.event_bus import DeliveredEvent, EventBus


class RejectionService:
    def __init__(self, db: Database, orders: OrderService, inventory: InventoryService, masters: MastersService, approvals: ApprovalsService, bus: EventBus):
        self.db = db
        self.orders = orders
        self.inventory = inventory
        self.masters = masters
        self.approvals = approvals
        self.bus = bus
        bus.subscribe("ApprovalDecided", "rejection.decided", self._on_decided)

    def open(self, s: Session, order_id: str, source: str, positions: list[str], reason: str, return_status: str, challan_id: str | None = None) -> RejectionCase:
        order = self.orders.get(order_id, s)
        station = self.masters.station(order.station_id, s) if order.station_id else None
        c = RejectionCase(
            tenant_id=request_context.tenant_id(),
            order_id=order.id,
            station_id=order.station_id,
            source=source,
            positions=positions,
            reason=reason,
            return_status=return_status,
            challan_id=challan_id,
        )
        s.add(c)
        s.flush()
        allocations = self.inventory.active_allocations(order.id, s)
        appr = self.approvals.request(
            s,
            APPROVAL.plate_rejection,
            SUBJECT.rejection,
            c.id,
            "STATION_USER",
            f"{'QC' if source == 'QC' else 'Dealer'} rejection · {order.order_no} · {' + '.join(positions)}",
            {
                "orderId": order.id,
                "orderNo": order.order_no,
                "regnNo": order.regn_no,
                "source": source,
                "positions": positions,
                "reason": reason,
                "laserCodes": [f"{a.position}: {a.laser_code}" for a in allocations if a.position in positions],
            },
            scope_org_id=station.org_id if station else None,
        )
        c.approval_id = appr.id
        s.flush()
        return c

    def _on_decided(self, e: DeliveredEvent) -> None:
        if e.payload.get("approvalType") != APPROVAL.plate_rejection:
            return
        with self.db.tx() as s:
            c = s.get(RejectionCase, str(e.payload.get("subjectId")))
            if c is None:
                raise NonRetryableError("Rejection case not found")
            if c.status != "PENDING":
                return
            approved = e.payload.get("decision") == "APPROVED"
            remarks = str(e.payload.get("remarks"))
            c.status = "APPROVED" if approved else "DISAPPROVED"
            c.decided_by, c.remarks, c.decided_at = str(e.payload.get("decidedBy")), remarks, utcnow()
            s.flush()
            order = self.orders.get(c.order_id, s)
            if approved:
                closed = self.inventory.close_positions(s, c.order_id, list(c.positions), f"REJECTED ({c.source}): {c.reason}", "SCRAPPED")
                self.orders.update(s, c.order_id, pending_positions=list(c.positions))
                self.orders.transition(s, c.order_id, "CONFIRMED", "rejection-approved", {}, f"Re-issue {' + '.join(c.positions)}: {remarks}")
                self.bus.publish(
                    s,
                    "RejectionApproved",
                    SUBJECT.order,
                    c.order_id,
                    {"orderId": c.order_id, "orderNo": order.order_no, "caseId": c.id, "positions": list(c.positions), "scrapped": [a.laser_code for a in closed]},
                )
            else:
                self.orders.transition(s, c.order_id, c.return_status, "rejection-disapproved", {}, remarks)
                if c.return_status == "QC_PASSED" and not order.sticker_required:
                    self.orders.transition(s, c.order_id, "STICKER_PRINTED", "sticker-not-required")
                self.bus.publish(s, "RejectionDisapproved", SUBJECT.order, c.order_id, {"orderId": c.order_id, "orderNo": order.order_no, "caseId": c.id})

    def list(self, filters: dict[str, Any] | None = None) -> list[RejectionCase]:
        with self.db.tx() as s:
            return list(
                s.scalars(
                    select(RejectionCase)
                    .where(RejectionCase.tenant_id == request_context.tenant_id(), *where_of(RejectionCase, filters))
                    .order_by(RejectionCase.created_at.desc())
                    .limit(300)
                )
            )

    def for_order(self, order_id: str) -> list[RejectionCase]:
        with self.db.tx() as s:
            return list(s.scalars(select(RejectionCase).where(RejectionCase.order_id == order_id).order_by(RejectionCase.created_at)))
