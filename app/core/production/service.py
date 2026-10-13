"""Job cards, plate allocation from boxes, quality check (with the plate photo OCR check, D45) and sticker printing."""

from __future__ import annotations

import re
from collections import Counter
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select

from app.contracts.schemas import IssuanceRequest, QcRequest
from app.core.inventory.service import InventoryService
from app.core.masters.scope import ScopeService
from app.core.masters.service import MastersService
from app.core.order_intake.orders import OrderService
from app.core.ports import PlateReader
from app.core.production.models import JobCard, PlatePhotoCheck, QcRecord, StickerPrint
from app.core.rejection.service import RejectionService
from app.core.shared.plate_ocr import judge_plate
from app.core.shared.subjects import SUBJECT, ist_date
from app.core.shared.uploads import Photo
from app.platform.context import request_context
from app.platform.db.session import Database
from app.platform.http.json import row
from app.platform.http.problem import Problem
from app.utility.audit.service import AuditService
from app.utility.configuration.service import Scope, SettingsService
from app.utility.documents.service import DocumentsService
from app.utility.file_storage.service import FileService
from app.utility.integration_hub.event_bus import EventBus


class ProductionService:
    def __init__(
        self,
        db: Database,
        orders: OrderService,
        inventory: InventoryService,
        rejections: RejectionService,
        masters: MastersService,
        scope: ScopeService,
        docs: DocumentsService,
        audit: AuditService,
        bus: EventBus,
        files: FileService,
        settings: SettingsService,
        ocr: PlateReader,
    ):
        self.db = db
        self.orders = orders
        self.inventory = inventory
        self.rejections = rejections
        self.masters = masters
        self.scope = scope
        self.docs = docs
        self.audit = audit
        self.bus = bus
        self.files = files
        self.settings = settings
        self.ocr = ocr

    def station_for(self, requested: str | None = None) -> str:
        """The station's own id for station users; any station for staff."""
        sc = self.scope.current()
        if sc.station_id:
            if requested and requested != sc.station_id:
                raise Problem.forbidden("That is another station")
            return sc.station_id
        if not sc.all:
            raise Problem.forbidden()
        if not requested:
            raise Problem.bad_request("stationId is required", "station-required")
        return requested

    def pending(
        self, station_id: str | None = None, dealer_id: str | None = None, date: str | None = None, vehicle_class: str | None = None, vehicle_type: str | None = None
    ) -> dict[str, Any]:
        sid = self.station_for(station_id)
        filters: dict[str, Any] = {"status": "CONFIRMED", "station_id": sid}
        if dealer_id:
            filters["dealer_id"] = dealer_id
        if vehicle_class:
            filters["vehicle_class"] = vehicle_class
        if vehicle_type:
            filters["vehicle_type"] = vehicle_type
        if date:
            # The end of `date` in India time.
            filters["confirmed_at"] = {"lte": datetime.fromisoformat(date[:10]) + timedelta(hours=23, minutes=59, seconds=59) - timedelta(hours=5, minutes=30)}
        orders = self.orders.find(filters, order_by="confirmed_at")
        need: Counter[str] = Counter()
        for o in orders:
            for p in o.pending_positions or []:
                need[(o.front_product_code if p == "FRONT" else o.rear_product_code) or "?"] += 1
        return {"stationId": sid, "orders": orders, "platesNeeded": [{"productCode": code, "count": n} for code, n in need.items()]}

    def issue(self, req: IssuanceRequest) -> JobCard:
        """Allocates plates for the chosen orders from the given boxes and creates a job card."""
        station_id = self.station_for(req.station_id)
        with self.db.tx() as s:
            orders = self.orders.by_ids(req.order_ids, s)
            if len(orders) != len(req.order_ids):
                raise Problem.not_found("One or more orders")
            # The request's order, as Prisma's findMany with no orderBy returned rows in insertion order.
            orders.sort(key=lambda o: req.order_ids.index(o.id))
            for o in orders:
                if o.status != "CONFIRMED":
                    raise Problem.conflict(f"{o.order_no} is {o.status}, not CONFIRMED", "not-confirmed")
                if o.station_id != station_id:
                    raise Problem.unprocessable(f"{o.order_no} belongs to another station", "wrong-station")
                if o.dealer_id != req.dealer_id:
                    raise Problem.unprocessable(f"{o.order_no} is for another dealer", "wrong-dealer")
            self.inventory.lock_boxes(station_id, req.box_nos, s)
            job_card_no = self.docs.next_number("job-card", s)
            card = JobCard(
                tenant_id=request_context.tenant_id(),
                job_card_no=job_card_no,
                station_id=station_id,
                dealer_id=req.dealer_id,
                order_ids=req.order_ids,
                box_nos=req.box_nos,
                plate_count=0,
                created_by=request_context.actor_id(),
            )
            s.add(card)
            s.flush()
            plates = 0
            for o in orders:
                allocated = []
                for position in list(o.pending_positions or []):
                    product_code = o.front_product_code if position == "FRONT" else o.rear_product_code
                    if not product_code:
                        raise Problem.unprocessable(f"{o.order_no} has no {position} product", "no-product")
                    allocated.append(self.inventory.allocate(s, o.id, position, product_code, station_id, req.box_nos, card.id))
                    plates += 1
                self.orders.update(s, o.id, pending_positions=[])
                self.orders.transition(s, o.id, "ISSUED", "plates-allocated", {}, f"Job card {job_card_no}")
                self.bus.publish(
                    s,
                    "PlateIssued",
                    SUBJECT.order,
                    o.id,
                    {"orderId": o.id, "orderNo": o.order_no, "jobCardNo": job_card_no, "laserCodes": [{"position": a.position, "laserCode": a.laser_code} for a in allocated]},
                )
            self.inventory.release_boxes(req.box_nos, s)
            card.plate_count = plates
            s.flush()
            return card

    def job_cards(self, station_id: str | None = None) -> list[JobCard]:
        try:
            sid: str | None = self.station_for(station_id)
        except Problem:
            sid = station_id
        q = select(JobCard).where(JobCard.tenant_id == request_context.tenant_id())
        if sid:
            q = q.where(JobCard.station_id == sid)
        with self.db.tx() as s:
            return list(s.scalars(q.order_by(JobCard.created_at.desc()).limit(100)))

    def job_card_pdf(self, id: str) -> tuple[str, bytes]:
        with self.db.tx() as s:
            card = s.scalar(select(JobCard).where(JobCard.id == id, JobCard.tenant_id == request_context.tenant_id()))
        if card is None:
            raise Problem.not_found("Job card")
        station, dealer, orders = self.masters.station(card.station_id), self.masters.dealer(card.dealer_id), self.orders.by_ids(list(card.order_ids))
        lines = []
        for o in orders:
            for a in (x for x in self.inventory.allocation_history(o.id) if x.job_card_id == card.id):
                lines.append(
                    {
                        "orderNo": o.order_no,
                        "regnNo": o.regn_no,
                        "vehicleClass": o.vehicle_class,
                        "position": a.position,
                        "laserCode": a.laser_code,
                        "product": o.front_product_code if a.position == "FRONT" else o.rear_product_code,
                    }
                )
        data = {"card": {**row(card), "date": ist_date(card.created_at), "boxes": ", ".join(card.box_nos)}, "station": row(station), "dealer": row(dealer), "lines": lines}
        return f"{card.job_card_no}.pdf", self.docs.render("job-card", data)

    # ------------------------------------------------------------ quality check

    def qc_queue(self, station_id: str | None = None) -> list[dict[str, Any]]:
        sid = self.station_for(station_id)
        out = []
        for o in self.orders.find({"status": "ISSUED", "station_id": sid}):
            allocations = self.inventory.active_allocations(o.id)
            out.append({**row(o), "allocations": allocations, "photoChecks": self._latest_photo_checks([a.id for a in allocations])})
        return out

    def _latest_photo_checks(self, allocation_ids: list[str]) -> list[dict[str, Any]]:
        """The newest OCR check of each given allocation, with a short-lived link to its photo."""
        with self.db.tx() as s:
            rows = s.scalars(select(PlatePhotoCheck).where(PlatePhotoCheck.allocation_id.in_(allocation_ids)).order_by(PlatePhotoCheck.created_at.desc())).all()
        latest = [r for r in (next((x for x in rows if x.allocation_id == i), None) for i in allocation_ids) if r is not None]
        return [{**row(r), "photoUrl": self.files.signed_path(r.file_id)} for r in latest]

    def photo_checks(self, order_id: str) -> list[PlatePhotoCheck]:
        """Every OCR check of the order's plates (order detail)."""
        return self.photo_checks_for([order_id])

    def photo_checks_for(self, order_ids: list[str]) -> list[PlatePhotoCheck]:
        """OCR checks of many orders (reports)."""
        with self.db.tx() as s:
            return list(s.scalars(select(PlatePhotoCheck).where(PlatePhotoCheck.order_id.in_(order_ids)).order_by(PlatePhotoCheck.created_at)))

    def check_plate_photos(self, order_id: str, photos: dict[str, Photo]) -> dict[str, Any]:
        """The station photographs each embossed plate; OCR must read the order's registration number on it. Every
        attempt is kept. QC can pass the order only when each allocated plate has a passing check."""
        order = self.orders.get(order_id)
        self.station_for(order.station_id)
        if order.status != "ISSUED":
            raise Problem.conflict(f"{order.order_no} is {order.status}; plate photos are checked after embossing, before QC", "not-issued")
        active = self.inventory.active_allocations(order_id)
        given = [a for a in active if photos.get(a.position)]
        if not given:
            raise Problem.bad_request("Attach a photo of each embossed plate (front, rear)", "photos-required")
        # OCR before the transaction: it is local but takes a moment per photo.
        read = []
        for a in given:
            f = photos[a.position]
            if not re.match(r"image/", f.mime_type or ""):
                raise Problem.bad_request(f"The {a.position.lower()} photo must be an image", "photo-type")
            reading = self.ocr.read(f.data, f.mime_type)
            read.append((a, f, reading, judge_plate(order.regn_no, reading)))
        tenant_id = request_context.tenant_id()
        with self.db.tx() as s:
            out = []
            for a, f, reading, judged in read:
                kind = a.position.lower()
                file = self.files.upload(f.data, f.filename or f"{kind}.jpg", f.mime_type, f"emboss-{kind}", SUBJECT.order, order.id, 3650, s=s)
                check = PlatePhotoCheck(
                    tenant_id=tenant_id,
                    order_id=order_id,
                    allocation_id=a.id,
                    laser_code=a.laser_code,
                    position=a.position,
                    file_id=file.id,
                    expected=order.regn_no,
                    read_text=reading.text,
                    confidence=reading.confidence,
                    engine=reading.engine,
                    result=judged.result,
                    reason=judged.reason,
                    actor_id=request_context.actor_id(),
                )
                s.add(check)
                s.flush()
                out.append(check)
            self.audit.record(
                "qc.plate-photos",
                SUBJECT.order,
                order_id,
                after=[{"position": c.position, "laserCode": c.laser_code, "read": c.read_text, "result": c.result} for c in out],
                s=s,
            )
            self.bus.publish(
                s,
                "PhotosChecked",
                SUBJECT.order,
                order_id,
                {"orderId": order_id, "orderNo": order.order_no, "checks": [{"position": c.position, "result": c.result, "read": c.read_text} for c in out]},
            )
        return {"orderNo": order.order_no, "regnNo": order.regn_no, "checks": [{**row(c), "photoUrl": self.files.signed_path(c.file_id)} for c in out]}

    def qc(self, order_id: str, req: QcRequest) -> Any:
        order = self.orders.get(order_id)
        self.station_for(order.station_id)
        if order.status != "ISSUED":
            raise Problem.conflict(f"{order.order_no} is {order.status}; QC needs ISSUED", "not-issued")
        tenant_id = request_context.tenant_id()
        with self.db.tx() as s:
            if req.result == "PASS":
                if self.settings.get_or("production.plateOcrRequired", True, [Scope("state", order.state_code)], s=s):
                    active = self.inventory.active_allocations(order_id, s)
                    passed = set(
                        s.scalars(select(PlatePhotoCheck.allocation_id).where(PlatePhotoCheck.allocation_id.in_([a.id for a in active]), PlatePhotoCheck.result == "PASS"))
                    )
                    missing = [a.position.lower() for a in active if a.id not in passed]
                    if missing:
                        raise Problem.conflict(
                            f"Plate photo check (OCR) has not passed for the {' and '.join(missing)} plate: upload a photo that reads {order.regn_no}",
                            "plate-ocr-required",
                        )
                s.add(QcRecord(tenant_id=tenant_id, order_id=order_id, result="PASS", positions=[], actor_id=request_context.actor_id()))
                self.orders.transition(s, order_id, "QC_PASSED", "qc-pass")
                self.bus.publish(s, "QcPassed", SUBJECT.order, order_id, {"orderId": order_id, "orderNo": order.order_no})
                if not order.sticker_required:
                    return self.orders.transition(s, order_id, "STICKER_PRINTED", "sticker-not-required")
                return self.orders.get(order_id, s)
            positions = list(dict.fromkeys(req.reject_positions or []))
            if not positions:
                raise Problem.bad_request("Choose the rejected plate(s): FRONT, REAR or both", "positions-required")
            if not (req.reason or "").strip():
                raise Problem.bad_request("A rejection reason is mandatory", "reason-required")
            active = self.inventory.active_allocations(order_id, s)
            missing = [p for p in positions if not any(a.position == p for a in active)]
            if missing:
                raise Problem.unprocessable(f"No plate allocated for {', '.join(missing)}", "position-not-allocated")
            s.add(QcRecord(tenant_id=tenant_id, order_id=order_id, result="REJECT", positions=positions, reason=req.reason, actor_id=request_context.actor_id()))
            self.orders.transition(s, order_id, "REJECTION_REVIEW", "qc-reject", {}, req.reason)
            self.rejections.open(s, order_id, "QC", positions, req.reason or "", "QC_PASSED")
            self.bus.publish(s, "QcRejected", SUBJECT.order, order_id, {"orderId": order_id, "orderNo": order.order_no, "positions": positions, "reason": req.reason})
            return self.orders.get(order_id, s)

    def switch_laser(self, order_id: str, position: str, new_laser_code: str, reason: str) -> Any:
        order = self.orders.get(order_id)
        station_id = self.station_for(order.station_id)
        if order.status != "ISSUED":
            raise Problem.conflict("Laser codes can be switched during QC only (status ISSUED)", "not-issued")
        product_code = order.front_product_code if position == "FRONT" else order.rear_product_code
        with self.db.tx() as s:
            return self.inventory.switch_laser(s, order_id, position, new_laser_code, reason, station_id, product_code or "")

    # ------------------------------------------------------------ stickers

    def sticker_queue(self, station_id: str | None = None) -> list[Any]:
        return self.orders.find({"status": "QC_PASSED", "station_id": self.station_for(station_id), "sticker_required": True})

    def print_sticker(self, order_id: str, reprint: bool, reason: str | None) -> tuple[str, bytes]:
        """First print moves QC_PASSED → STICKER_PRINTED. Reprints need a first print and a reason; all are logged."""
        order = self.orders.get(order_id)
        self.station_for(order.station_id)
        with self.db.tx() as s:
            prints = s.scalar(select(func.count()).select_from(StickerPrint).where(StickerPrint.order_id == order_id)) or 0
            if reprint:
                if prints == 0:
                    raise Problem.conflict("Reprint is allowed only after the first print", "no-first-print")
                if not (reason or "").strip():
                    raise Problem.bad_request("Give a reason for the reprint", "reason-required")
                if order.status == "QC_PASSED":
                    raise Problem.conflict("This order has a new plate waiting for its first print; use Print, not Reprint", "first-print-pending")
            elif order.status != "QC_PASSED":
                raise Problem.conflict(f"{order.order_no} is {order.status}; the first print needs QC_PASSED", "not-qc-passed")
            s.add(StickerPrint(tenant_id=request_context.tenant_id(), order_id=order_id, print_no=prints + 1, reprint=reprint, reason=reason, actor_id=request_context.actor_id()))
            if not reprint:
                self.orders.transition(s, order_id, "STICKER_PRINTED", "sticker-printed")
                self.bus.publish(s, "StickerPrinted", SUBJECT.order, order_id, {"orderId": order_id, "orderNo": order.order_no, "printNo": prints + 1})
            else:
                self.audit.record("sticker.reprint", SUBJECT.order, order_id, after={"printNo": prints + 1, "reason": reason}, s=s)
            print_no = prints + 1
        return f"sticker-{order.regn_no}-{print_no}.pdf", self._sticker_pdf(order, print_no, reprint)

    def _sticker_pdf(self, order: Any, print_no: int, reprint: bool) -> bytes:
        allocs = self.inventory.active_allocations(order.id)
        state = self.masters.state(order.state_code)
        return self.docs.render(
            "sticker",
            {
                **row(order),
                "stateName": state.name,
                "front": next((a.laser_code for a in allocs if a.position == "FRONT"), "-"),
                "rear": next((a.laser_code for a in allocs if a.position == "REAR"), "-"),
                "printLabel": f"REPRINT #{print_no}" if reprint else f"PRINT #{print_no}",
                "fuelLabel": (order.fuel or "").upper(),
            },
        )

    def sticker_prints(self, order_id: str) -> list[StickerPrint]:
        with self.db.tx() as s:
            return list(s.scalars(select(StickerPrint).where(StickerPrint.order_id == order_id).order_by(StickerPrint.print_no)))

    def qc_records(self, order_id: str) -> list[QcRecord]:
        return self.qc_records_for([order_id])

    def qc_records_for(self, order_ids: list[str]) -> list[QcRecord]:
        with self.db.tx() as s:
            return list(s.scalars(select(QcRecord).where(QcRecord.order_id.in_(order_ids)).order_by(QcRecord.created_at)))

    def job_cards_by_ids(self, ids: list[str]) -> list[dict[str, Any]]:
        with self.db.tx() as s:
            rows = s.execute(select(JobCard.id, JobCard.job_card_no, JobCard.created_at).where(JobCard.id.in_(ids))).all()
        return [{"id": r.id, "jobCardNo": r.job_card_no, "createdAt": r.created_at} for r in rows]
