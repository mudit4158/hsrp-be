"""Boxes and plates by laser code, stock per station, box locks and the allocation history."""

from __future__ import annotations

import re
from collections import Counter
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.inventory.models import Plate, PlateAllocation, PlateBox
from app.core.masters.service import MastersService
from app.platform.context import request_context
from app.platform.db.base import new_id, utcnow
from app.platform.db.session import Database
from app.platform.http.json import row
from app.platform.http.problem import Problem
from app.utility.audit.service import AuditService
from app.utility.import_export.service import ImportRowContext, ImportService

LOCK_MINUTES = 10
LASER_CODE = re.compile(r"[A-Z]{2}\d{10}")
STATUSES = ("AVAILABLE", "ALLOCATED", "FITTED", "SCRAPPED")


class InventoryService:
    def __init__(self, db: Database, audit: AuditService, imports: ImportService, masters: MastersService):
        self.db = db
        self.audit = audit
        self.masters = masters
        # Stock receipt upload: one row per plate (box, station, product, laser code).
        imports.register_target("hsrp.stock-receipt", self)

    def process_row(self, mapped: dict[str, str], ctx: ImportRowContext) -> dict[str, Any]:
        laser_code = (mapped.get("laserCode") or "").upper()
        if not LASER_CODE.fullmatch(laser_code):
            raise Problem.bad_request("Laser code must be two letters and ten digits")
        tenant_id = request_context.tenant_id()
        station = self.masters.station_by_code(str(mapped.get("stationCode")))
        product = self.masters.product_by_code(str(mapped.get("productCode")))
        box_no = mapped.get("boxNo")
        with self.db.tx() as s:
            now = utcnow()
            s.execute(
                insert(PlateBox)
                .values(id=new_id(), tenant_id=tenant_id, box_no=box_no, station_id=station.id, product_code=product.code, plate_count=0, status="OPEN", received_at=now, created_at=now, updated_at=now)
                .on_conflict_do_nothing(index_elements=["tenant_id", "box_no"])
            )
            box = s.scalars(select(PlateBox).where(PlateBox.tenant_id == tenant_id, PlateBox.box_no == box_no).execution_options(populate_existing=True)).one()
            if box.station_id != station.id or box.product_code != product.code:
                raise Problem.bad_request(f"Box {box_no} belongs to another station or product")
            if s.scalar(select(Plate.id).where(Plate.tenant_id == tenant_id, Plate.laser_code == laser_code)):
                raise Problem.bad_request(f"Laser code {laser_code} already in stock")
            plate = Plate(tenant_id=tenant_id, laser_code=laser_code, box_id=box.id, station_id=station.id, product_code=product.code)
            s.add(plate)
            box.plate_count += 1
            box.status = "OPEN"
            s.flush()
            return {"ref": plate.id}

    def lock_boxes(self, station_id: str, box_nos: list[str], s: Session | None = None) -> list[dict[str, Any]]:
        """Locks boxes for the current user so nobody else allocates from them meanwhile."""
        user_id = request_context.actor_id() or "system"
        with self.db.use(s) as tx:
            boxes = tx.scalars(select(PlateBox).where(PlateBox.tenant_id == request_context.tenant_id(), PlateBox.box_no.in_(box_nos))).all()
            missing = [b for b in box_nos if not any(x.box_no == b for x in boxes)]
            if missing:
                raise Problem.unprocessable(f"Unknown box(es): {', '.join(missing)}", "box-unknown")
            elsewhere = [b for b in boxes if b.station_id != station_id]
            if elsewhere:
                raise Problem.unprocessable(f"Box(es) belong to another station: {', '.join(b.box_no for b in elsewhere)}", "box-station")
            until = utcnow() + timedelta(minutes=LOCK_MINUTES)
            for b in boxes:
                n = tx.execute(
                    text(
                        "UPDATE core_inv_box SET locked_by = :user, locked_until = :until, updated_at = now() "
                        "WHERE id = :id AND (locked_by IS NULL OR locked_by = :user OR locked_until < now())"
                    ),
                    {"user": user_id, "until": until, "id": b.id},
                ).rowcount
                if n == 0:
                    raise Problem.conflict(f"Box {b.box_no} is locked by another user", "box-locked")
            return self._box_summary(tx, [b.id for b in boxes])

    def release_boxes(self, box_nos: list[str], s: Session | None = None) -> None:
        user_id = request_context.actor_id() or "system"
        with self.db.use(s) as tx:
            tx.execute(
                update(PlateBox)
                .where(PlateBox.tenant_id == request_context.tenant_id(), PlateBox.box_no.in_(box_nos), PlateBox.locked_by == user_id)
                .values(locked_by=None, locked_until=None, updated_at=utcnow())
            )

    def _box_summary(self, s: Session, box_ids: list[str]) -> list[dict[str, Any]]:
        boxes = s.scalars(select(PlateBox).where(PlateBox.id.in_(box_ids)).order_by(PlateBox.box_no).execution_options(populate_existing=True)).all()
        counts = dict(s.execute(select(Plate.box_id, func.count()).where(Plate.box_id.in_(box_ids), Plate.status == "AVAILABLE").group_by(Plate.box_id)).all())
        return [{**row(b), "available": counts.get(b.id, 0)} for b in boxes]

    def allocate(self, s: Session, order_id: str, position: str, product_code: str, station_id: str, box_nos: list[str], job_card_id: str | None = None) -> PlateAllocation:
        """Allocates the next available plate of `product_code` from the given (locked) boxes to an order position. The
        partial unique indexes guarantee one ACTIVE allocation per laser code and per order position."""
        tenant_id = request_context.tenant_id()
        user_id = request_context.actor_id() or "system"
        boxes = s.scalars(
            select(PlateBox)
            .where(PlateBox.tenant_id == tenant_id, PlateBox.box_no.in_(box_nos), PlateBox.station_id == station_id, PlateBox.product_code == product_code)
            .execution_options(populate_existing=True)
        ).all()
        now = utcnow()
        not_locked = [b for b in boxes if b.locked_by != user_id or not b.locked_until or b.locked_until < now]
        if not_locked:
            raise Problem.conflict(f"Lock box(es) {', '.join(b.box_no for b in not_locked)} before allocating", "box-not-locked")
        rank = {b: i for i, b in enumerate(box_nos)}
        for box in sorted(boxes, key=lambda b: rank.get(b.box_no, 0)):
            plate = s.execute(
                text("SELECT id, laser_code FROM core_inv_plate WHERE box_id = :box AND status = 'AVAILABLE' ORDER BY laser_code LIMIT 1 FOR UPDATE SKIP LOCKED"),
                {"box": box.id},
            ).first()
            if plate is None:
                box.status = "EXHAUSTED"
                s.flush()
                continue
            s.execute(update(Plate).where(Plate.id == plate.id).values(status="ALLOCATED", updated_at=utcnow()))
            a = PlateAllocation(tenant_id=tenant_id, plate_id=plate.id, laser_code=plate.laser_code, order_id=order_id, position=position, job_card_id=job_card_id)
            s.add(a)
            s.flush()
            return a
        raise Problem.unprocessable(f"No {product_code} plates left in boxes {', '.join(box_nos)}", "no-plates")

    def active_allocations(self, order_id: str, s: Session | None = None) -> list[PlateAllocation]:
        with self.db.use(s) as session:
            return list(session.scalars(select(PlateAllocation).where(PlateAllocation.order_id == order_id, PlateAllocation.status == "ACTIVE").order_by(PlateAllocation.position)))

    def allocation_history(self, order_id: str, s: Session | None = None) -> list[PlateAllocation]:
        with self.db.use(s) as session:
            return list(session.scalars(select(PlateAllocation).where(PlateAllocation.order_id == order_id).order_by(PlateAllocation.created_at)))

    def allocations(self, from_: datetime | None = None, to: datetime | None = None, laser_code: str | None = None, order_ids: list[str] | None = None) -> list[PlateAllocation]:
        """Allocations (laser code ↔ order), newest first, for the laser code audit."""
        q = select(PlateAllocation).where(PlateAllocation.tenant_id == request_context.tenant_id())
        if laser_code:
            q = q.where(PlateAllocation.laser_code.contains(laser_code.upper(), autoescape=True))
        if order_ids is not None:
            q = q.where(PlateAllocation.order_id.in_(order_ids))
        if from_:
            q = q.where(PlateAllocation.created_at >= from_)
        if to:
            q = q.where(PlateAllocation.created_at <= to)
        with self.db.tx() as s:
            return list(s.scalars(q.order_by(PlateAllocation.created_at.desc()).limit(20_000)))

    def plates_by_codes(self, laser_codes: list[str]) -> list[dict[str, Any]]:
        """Plates with their box number, by laser code."""
        with self.db.tx() as s:
            plates = s.scalars(select(Plate).where(Plate.tenant_id == request_context.tenant_id(), Plate.laser_code.in_(laser_codes))).all()
            boxes = dict(s.execute(select(PlateBox.id, PlateBox.box_no).where(PlateBox.id.in_({p.box_id for p in plates}))).all())
        return [{**row(p), "boxNo": boxes.get(p.box_id)} for p in plates]

    def allocations_by_ids(self, ids: list[str], s: Session | None = None) -> list[PlateAllocation]:
        with self.db.use(s) as session:
            return list(session.scalars(select(PlateAllocation).where(PlateAllocation.id.in_(ids))))

    def close_positions(self, s: Session, order_id: str, positions: list[str], reason: str, plate_status: str) -> list[PlateAllocation]:
        """Closes the active allocation of each position (history kept) and sets the plate's new status."""
        rows = s.scalars(
            select(PlateAllocation).where(PlateAllocation.order_id == order_id, PlateAllocation.status == "ACTIVE", PlateAllocation.position.in_(positions))
        ).all()
        for a in rows:
            a.status, a.closed_at, a.close_reason = "CLOSED", utcnow(), reason
            s.flush()
            s.execute(update(Plate).where(Plate.id == a.plate_id).values(status=plate_status, updated_at=utcnow()))
        return list(rows)

    def switch_laser(self, s: Session, order_id: str, position: str, new_laser_code: str, reason: str, station_id: str, product_code: str) -> PlateAllocation:
        """QC 'switch laser code': closes the current allocation and allocates a specific plate instead."""
        tenant_id = request_context.tenant_id()
        plate = s.scalar(select(Plate).where(Plate.tenant_id == tenant_id, Plate.laser_code == new_laser_code).execution_options(populate_existing=True))
        if plate is None:
            raise Problem.unprocessable(f"Laser code {new_laser_code} is not in stock", "laser-unknown")
        if plate.status != "AVAILABLE":
            raise Problem.conflict(f"Laser code {new_laser_code} is {plate.status.lower()}", "laser-unavailable")
        if plate.station_id != station_id:
            raise Problem.unprocessable("That plate belongs to another station", "laser-station")
        if plate.product_code != product_code:
            raise Problem.unprocessable(f"That plate is {plate.product_code}; {product_code} is needed", "laser-product")
        closed = self.close_positions(s, order_id, [position], f"SWITCHED: {reason}", "AVAILABLE")
        first = closed[0] if closed else None
        plate.status = "ALLOCATED"
        created = PlateAllocation(
            tenant_id=tenant_id,
            plate_id=plate.id,
            laser_code=plate.laser_code,
            order_id=order_id,
            position=position,
            job_card_id=first.job_card_id if first else None,
        )
        s.add(created)
        s.flush()
        self.audit.record("inventory.laser-switch", "hsrp.order", order_id, first.laser_code if first else None, plate.laser_code, s=s)
        return created

    def mark_fitted(self, s: Session, order_id: str) -> None:
        rows = self.active_allocations(order_id, s)
        s.execute(update(Plate).where(Plate.id.in_([r.plate_id for r in rows])).values(status="FITTED", updated_at=utcnow()))

    def stock_by_station(self) -> list[dict[str, Any]]:
        with self.db.tx() as s:
            rows = s.execute(
                select(Plate.station_id, Plate.product_code, Plate.status, func.count())
                .where(Plate.tenant_id == request_context.tenant_id())
                .group_by(Plate.station_id, Plate.product_code, Plate.status)
            ).all()
        out = []
        for st in self.masters.stations():
            mine = [r for r in rows if r[0] == st.id]
            products = sorted({r[1] for r in mine})
            out.append(
                {
                    "stationId": st.id,
                    "stationCode": st.code,
                    "stationName": st.name,
                    "totals": {status: sum(r[3] for r in mine if r[2] == status) for status in STATUSES},
                    "products": [
                        {"productCode": p, **{status: next((r[3] for r in mine if r[1] == p and r[2] == status), 0) for status in STATUSES}} for p in products
                    ],
                }
            )
        return out

    def boxes(self, station_id: str | None = None, status: str | None = None, q: str | None = None) -> list[dict[str, Any]]:
        stmt = select(PlateBox).where(PlateBox.tenant_id == request_context.tenant_id())
        if station_id:
            stmt = stmt.where(PlateBox.station_id == station_id)
        if status:
            stmt = stmt.where(PlateBox.status == status)
        if q:
            stmt = stmt.where(PlateBox.box_no.contains(q.upper(), autoescape=True))
        with self.db.tx() as s:
            boxes = s.scalars(stmt.order_by(PlateBox.box_no).limit(500)).all()
            counts = s.execute(
                select(Plate.box_id, Plate.status, func.count()).where(Plate.box_id.in_([b.id for b in boxes])).group_by(Plate.box_id, Plate.status)
            ).all()
        available: Counter[str] = Counter()
        used: Counter[str] = Counter()
        for box_id, status_, n in counts:
            (available if status_ == "AVAILABLE" else used)[box_id] += n
        return [{**row(b), "available": available[b.id], "used": used[b.id]} for b in boxes]

    def plates(self, box_no: str | None = None, laser_code: str | None = None, status: str | None = None) -> list[Plate]:
        tenant_id = request_context.tenant_id()
        q = select(Plate).where(Plate.tenant_id == tenant_id)
        if laser_code:
            q = q.where(Plate.laser_code.contains(laser_code.upper(), autoescape=True))
        if status:
            q = q.where(Plate.status == status)
        with self.db.tx() as s:
            if box_no:
                box = s.scalar(select(PlateBox).where(PlateBox.tenant_id == tenant_id, PlateBox.box_no == box_no))
                if box is None:
                    return []
                q = q.where(Plate.box_id == box.id)
            return list(s.scalars(q.order_by(Plate.laser_code).limit(300)))

    def plate_history(self, laser_code: str) -> dict[str, Any]:
        with self.db.tx() as s:
            plate = s.scalar(select(Plate).where(Plate.tenant_id == request_context.tenant_id(), Plate.laser_code == laser_code.upper()))
            if plate is None:
                raise Problem.not_found("Plate")
            allocations = list(s.scalars(select(PlateAllocation).where(PlateAllocation.laser_code == plate.laser_code).order_by(PlateAllocation.created_at)))
        return {"plate": plate, "allocations": allocations}
