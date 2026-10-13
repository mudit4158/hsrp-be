"""Fitment record with photos and confirmed laser codes, then the VAHAN post from the outbox."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.contracts.schemas import FitmentRequest
from app.core.fitment.models import Fitment, FitmentPhotoCheck
from app.core.inventory.service import InventoryService
from app.core.masters.scope import ScopeService
from app.core.order_intake.orders import OrderService
from app.core.order_intake.state_machine import positions_of
from app.core.ports import PlateReader, VahanFitmentRequest, VehicleRegistry
from app.core.shared.plate_ocr import judge_plate
from app.core.shared.subjects import IST, SUBJECT, ist_date, ist_dmy
from app.core.shared.uploads import Photo
from app.platform.context import request_context
from app.platform.db.base import naive_utc, utcnow
from app.platform.db.session import Database
from app.platform.http.json import row
from app.platform.http.problem import NonRetryableError, Problem
from app.utility.configuration.service import Scope, SettingsService
from app.utility.file_storage.service import FileService
from app.utility.integration_hub.call_log import CallLogService
from app.utility.integration_hub.event_bus import DeliveredEvent, EventBus
from app.utility.notification.service import NotificationService

log = logging.getLogger("Fitment")


def parse_fitment_reply(text: str | None) -> str:
    """VAHAN's recordFitment answers with free text. Known success and failure phrasings are recognised; anything else
    is UNKNOWN and is retried, then moved to the manual queue."""
    t = (text or "").strip()
    if not t:
        return "UNKNOWN"
    if re.search(r"(updated|saved|recorded)\s+successfully|^success\b", t, re.I):
        return "SUCCESS"
    if re.search(r"not\s+found|invalid|mismatch|already\s+(fitted|updated)|does\s+not\s+match", t, re.I):
        return "FAILED"
    return "UNKNOWN"


class FitmentService:
    def __init__(
        self,
        db: Database,
        orders: OrderService,
        inventory: InventoryService,
        scope: ScopeService,
        files: FileService,
        settings: SettingsService,
        notify: NotificationService,
        calls: CallLogService,
        bus: EventBus,
        vahan: VehicleRegistry,
        ocr: PlateReader,
    ):
        self.db = db
        self.orders = orders
        self.inventory = inventory
        self.scope = scope
        self.files = files
        self.settings = settings
        self.notify = notify
        self.calls = calls
        self.bus = bus
        self.vahan = vahan
        self.ocr = ocr
        self._last_eod_alert = ""
        bus.subscribe("FitmentRecorded", "fitment.vahan-post", self._post_to_vahan, max_attempts=10)

    def photo_rules(self, state_code: str) -> dict[str, bool]:
        return self.settings.get_or("fitment.photoRules", {"front": True, "rear": True, "chassis": False}, [Scope("state", state_code)])

    def for_order(self, order_id: str) -> Fitment | None:
        with self.db.tx() as s:
            return s.scalar(select(Fitment).where(Fitment.order_id == order_id))

    def search(self, regn_no: str) -> list[dict[str, Any]]:
        """Dealer app search by registration number: the order, its laser codes and the photo rules."""
        sc = self.scope.current()
        filters: dict[str, Any] = {"regn_no": regn_no.strip().upper(), "status": ["INWARDED", "FITTED", "COMPLETED", "DISPATCHED"]}
        if sc.dealer_id:
            filters["dealer_id"] = sc.dealer_id
        out = []
        for o in self.orders.find(filters, desc=True, limit=5):
            out.append(
                {
                    "order": o,
                    "allocations": [{"position": a.position, "laserCode": a.laser_code} for a in self.inventory.active_allocations(o.id)],
                    "photoRules": self.photo_rules(o.state_code),
                    "fitment": self.for_order(o.id),
                    "canRecord": o.status == "INWARDED",
                }
            )
        return out

    def record(self, req: FitmentRequest, photos: dict[str, Photo]) -> dict[str, Any]:
        order = self.orders.get_scoped(req.order_id)
        sc = self.scope.current()
        if not sc.dealer_id and not sc.all:
            raise Problem.forbidden("Only the fitting dealer can record fitment")
        existing = self.for_order(order.id)
        if existing is not None:
            raise Problem.conflict(f"Fitment for {order.order_no} was already recorded", "fitment-exists", {"fitmentId": existing.id})
        if order.status != "INWARDED":
            raise Problem.conflict(f"{order.order_no} is {order.status}; fitment needs INWARDED plates", "not-inwarded")

        allocs = self.inventory.active_allocations(order.id)
        front = next((a for a in allocs if a.position == "FRONT"), None)
        rear = next((a for a in allocs if a.position == "REAR"), None)
        if front and req.front_laser_code != front.laser_code:
            raise Problem.unprocessable(f"Front laser code does not match the allocated {front.laser_code}", "laser-mismatch")
        if rear and req.rear_laser_code != rear.laser_code:
            raise Problem.unprocessable(f"Rear laser code does not match the allocated {rear.laser_code}", "laser-mismatch")

        rules = self.photo_rules(order.state_code)
        positions = positions_of(order.plate_set)
        missing = [
            label
            for label, needed in (
                ("front plate photo", rules.get("front") and "FRONT" in positions and not photos.get("front")),
                ("rear plate photo", rules.get("rear") and "REAR" in positions and not photos.get("rear")),
                ("chassis photo", rules.get("chassis") and not photos.get("chassis")),
            )
            if needed
        ]
        if missing:
            raise Problem.bad_request(f"Missing {', '.join(missing)}", "photos-required")
        if self.settings.flag("mobileHoldBeforeFitment", [Scope("state", order.state_code)]) and not order.mobile:
            raise Problem.unprocessable("This state holds fitment until the owner mobile number is on the order", "mobile-hold")

        fitted_at = naive_utc(req.fitted_at) if req.fitted_at else utcnow()
        if fitted_at > utcnow() + timedelta(minutes=5):
            raise Problem.bad_request("Fitment time is in the future", "fitted-at")

        # OCR (D45): each plate photo must read the order's registration number, or the fitment is refused.
        ocr_on = self.settings.get_or("fitment.plateOcrRequired", True, [Scope("state", order.state_code)])
        plates = [(pos, photos[key]) for pos, key in (("FRONT", "front"), ("REAR", "rear")) if photos.get(key) and pos in positions]
        judged = []
        if ocr_on:
            for position, f in plates:
                reading = self.ocr.read(f.data, f.mime_type)
                judged.append((position, f, reading, judge_plate(order.regn_no, reading)))

        def check_row(position: str, reading: Any, verdict: Any, file_id: str | None, fitment_id: str | None) -> FitmentPhotoCheck:
            return FitmentPhotoCheck(
                tenant_id=request_context.tenant_id(),
                order_id=order.id,
                fitment_id=fitment_id,
                position=position,
                file_id=file_id,
                expected=order.regn_no,
                read_text=reading.text,
                confidence=reading.confidence,
                engine=reading.engine,
                result=verdict.result,
                reason=verdict.reason,
                actor_id=request_context.actor_id(),
                device_id=request_context.get().device_id,
            )

        failed = [j for j in judged if j[3].result == "FAIL"]
        if failed:
            # Keep the refused attempt (photos and readings) for the audit trail, then refuse the fitment.
            with self.db.tx() as s:
                for position, f, reading, verdict in judged:
                    kind = position.lower()
                    file = self.files.upload(f.data, f.filename or f"{kind}.jpg", f.mime_type, f"fitment-refused-{kind}", SUBJECT.order, order.id, 3650, s=s)
                    s.add(check_row(position, reading, verdict, file.id, None))
            detail = "; ".join(f"{position.lower()} plate photo: {verdict.reason}" for position, _, _, verdict in failed)
            raise Problem.unprocessable(f"Fitment refused: {detail}. Take the photos again.", "plate-ocr-mismatch")

        with self.db.tx() as s:

            def up(f: Photo | None, kind: str) -> str | None:
                if f is None:
                    return None
                return self.files.upload(f.data, f.filename or f"{kind}.jpg", f.mime_type, f"fitment-{kind}", SUBJECT.order, order.id, 3650, s=s).id

            fit = Fitment(
                tenant_id=request_context.tenant_id(),
                order_id=order.id,
                dealer_id=order.dealer_id,
                front_laser_code=front.laser_code if front else None,
                rear_laser_code=rear.laser_code if rear else None,
                front_photo_id=up(photos.get("front"), "front"),
                rear_photo_id=up(photos.get("rear"), "rear"),
                chassis_photo_id=up(photos.get("chassis"), "chassis"),
                fitted_at=fitted_at,
                recorded_by=request_context.actor_id(),
                device_id=request_context.get().device_id,
                latitude=req.latitude,
                longitude=req.longitude,
            )
            s.add(fit)
            s.flush()
            for position, _f, reading, verdict in judged:
                s.add(check_row(position, reading, verdict, fit.front_photo_id if position == "FRONT" else fit.rear_photo_id, fit.id))
            self.inventory.mark_fitted(s, order.id)
            self.orders.transition(s, order.id, "FITTED", "fitment-recorded")
            self.bus.publish(s, "FitmentRecorded", SUBJECT.order, order.id, {"orderId": order.id, "orderNo": order.order_no, "fitmentId": fit.id})
            s.flush()
            return {**row(fit), "orderNo": order.order_no, "status": "FITTED"}

    def _post_to_vahan(self, e: DeliveredEvent) -> None:
        """Outbox subscriber: posts the fitment to VAHAN. Down → retry; known failure → manual queue; unknown text → retry
        then manual."""
        with self.db.tx() as s:
            f = s.get(Fitment, str(e.payload.get("fitmentId")))
        if f is None:
            raise NonRetryableError("Fitment not found")
        if f.vahan_status == "POSTED":
            return
        order = self.orders.get(f.order_id)
        req = VahanFitmentRequest(order.regn_no, order.chassis_no, order.order_type, f.front_laser_code or "", f.rear_laser_code or "", ist_dmy(f.fitted_at))

        def mark(**values: Any) -> None:
            with self.db.tx() as s:
                x = s.get_one(Fitment, f.id)
                for k, v in values.items():
                    setattr(x, k, v)

        try:
            reply = self.calls.track(
                lambda: self.vahan.record_fitment(req), system="VAHAN", operation="recordFitment", subject_type=SUBJECT.order, subject_id=order.id, request=req
            )
        except Exception as err:
            # VAHAN down or slow: keep the order FITTED and let the outbox retry with back-off.
            mark(vahan_status="RETRYING", vahan_reply=str(err))
            raise
        outcome = parse_fitment_reply(reply)
        if outcome == "FAILED":
            mark(vahan_status="MANUAL", vahan_reply=reply)
            raise NonRetryableError(f"VAHAN refused the fitment: {reply}")
        if outcome == "UNKNOWN":
            mark(vahan_status="MANUAL" if e.attempt >= 10 else "RETRYING", vahan_reply=reply)
            raise RuntimeError(f"Unrecognised VAHAN reply: {reply[:200]}")
        with self.db.tx() as s:
            x = s.get_one(Fitment, f.id)
            x.vahan_status, x.vahan_reply, x.posted_at = "POSTED", reply, utcnow()
            self.orders.transition(s, order.id, "COMPLETED", "vahan-posted", {"completed_at": utcnow()})
            self.bus.publish(s, "FitmentPosted", SUBJECT.order, order.id, {"orderId": order.id, "orderNo": order.order_no, "reply": reply})
            if order.mobile:
                self.notify.send("FITMENT_DONE", "SMS", order.mobile, {"regnNo": order.regn_no, "orderNo": order.order_no}, SUBJECT.order, order.id, s=s)

    def photo_checks(self, order_ids: list[str]) -> list[FitmentPhotoCheck]:
        """OCR readings of fitment photos, refused attempts included (order detail, reports)."""
        with self.db.tx() as s:
            return list(s.scalars(select(FitmentPhotoCheck).where(FitmentPhotoCheck.order_id.in_(order_ids)).order_by(FitmentPhotoCheck.created_at)))

    def for_orders(self, order_ids: list[str]) -> list[Fitment]:
        with self.db.tx() as s:
            return list(s.scalars(select(Fitment).where(Fitment.order_id.in_(order_ids))))

    def pending_vahan(self) -> list[Fitment]:
        with self.db.tx() as s:
            return list(
                s.scalars(
                    select(Fitment).where(Fitment.tenant_id == request_context.tenant_id(), Fitment.vahan_status != "POSTED").order_by(Fitment.fitted_at).limit(500)
                )
            )

    def counts(self) -> dict[str, int]:
        tenant_id = request_context.tenant_id()
        today = datetime.fromisoformat(ist_date()) - IST
        with self.db.tx() as s:

            def n(*conds: Any) -> int:
                return s.scalar(select(func.count()).select_from(Fitment).where(Fitment.tenant_id == tenant_id, *conds)) or 0

            return {
                "fittedToday": n(Fitment.fitted_at >= today),
                "pendingVahan": n(Fitment.vahan_status.in_(["PENDING", "RETRYING"])),
                "manual": n(Fitment.vahan_status == "MANUAL"),
            }

    def list(self, dealer_id: str | None = None, from_: datetime | None = None, to: datetime | None = None, s: Session | None = None) -> list[Fitment]:
        q = select(Fitment).where(Fitment.tenant_id == request_context.tenant_id())
        if dealer_id:
            q = q.where(Fitment.dealer_id == dealer_id)
        if from_:
            q = q.where(Fitment.fitted_at >= from_)
        if to:
            q = q.where(Fitment.fitted_at <= to)
        with self.db.use(s) as session:
            return list(session.scalars(q.order_by(Fitment.fitted_at.desc()).limit(5000)))

    def end_of_day_alert(self, force: bool = False) -> dict[str, Any]:
        """End-of-day alert: VAHAN posts still not done after the configured hour (IST) go to operations by email."""
        now = utcnow()
        ist_hour = (now + IST).hour
        hour = int(self.settings.get_or("alerts.vahanEodHourIst", 22))
        today = ist_date(now)
        if not force and (ist_hour < hour or self._last_eod_alert == today):
            return {"sent": False}
        pending = self.pending_vahan()
        self._last_eod_alert = today
        if not pending:
            return {"sent": False, "pending": 0}
        to = self.settings.get_or("alerts.opsEmail", "operations@hsrp-demo.invalid")
        self.notify.send("VAHAN_PENDING_ALERT", "EMAIL", to, {"count": len(pending), "date": today}, "hsrp.alert", f"vahan-eod-{today}")
        log.warning("End-of-day alert: %s VAHAN posts still pending", len(pending))
        return {"sent": True, "pending": len(pending)}
