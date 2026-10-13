"""Fitment centre, appointment slot, reschedule and cancel for customer orders."""

from __future__ import annotations

from datetime import date as Date
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.booking.models import Booking
from app.core.masters.service import MastersService
from app.core.order_intake.orders import OrderService
from app.core.shared.subjects import SUBJECT, ist_date
from app.platform.context import request_context
from app.platform.db.session import Database
from app.platform.http.json import row
from app.platform.http.problem import Problem
from app.utility.configuration.service import SettingsService
from app.utility.integration_hub.event_bus import DeliveredEvent, EventBus
from app.utility.scheduling.service import SchedulingService


def add_days(day: str, n: int) -> str:
    return (Date.fromisoformat(day) + timedelta(days=n)).isoformat()


class BookingService:
    def __init__(self, db: Database, scheduling: SchedulingService, masters: MastersService, orders: OrderService, settings: SettingsService, bus: EventBus):
        self.db = db
        self.scheduling = scheduling
        self.masters = masters
        self.orders = orders
        self.settings = settings
        bus.subscribe("OrderCancelled", "booking.release-slot", self._release_slot)

    def _release_slot(self, e: DeliveredEvent) -> None:
        with self.db.tx() as s:
            b = s.scalar(select(Booking).where(Booking.order_id == str(e.payload.get("orderId"))))
            if b is None or b.status != "BOOKED":
                return
            self.scheduling.cancel(b.sched_booking_id, s)
            b.status = "CANCELLED"

    def _window(self) -> tuple[str, str]:
        days = int(self.settings.get_or("booking.horizonDays", 30))
        today = ist_date()
        return add_days(today, 1), add_days(today, days)

    def slots(self, dealer_code: str, date: str) -> dict[str, Any]:
        dealer = self.masters.dealer_by_code(dealer_code)
        res = self.scheduling.resource_for(SUBJECT.dealer, dealer.id)
        if res is None:
            raise Problem.unprocessable("This centre has no fitment calendar", "no-calendar")
        first, last = self._window()
        if date < first or date > last:
            return {"date": date, "first": first, "last": last, "slots": []}
        return {"date": date, "first": first, "last": last, "slots": self.scheduling.slots(res.id, date)}

    def book(self, s: Session, order_id: str, dealer_id: str, date: str, slot_start: str) -> Booking:
        first, last = self._window()
        if date < first or date > last:
            raise Problem.unprocessable(f"Pick a date between {first} and {last}", "date-out-of-range")
        res = self.scheduling.resource_for(SUBJECT.dealer, dealer_id, s)
        if res is None:
            raise Problem.unprocessable("This centre has no fitment calendar", "no-calendar")
        sb = self.scheduling.book(res.id, date, slot_start, SUBJECT.order, order_id, s)
        b = Booking(tenant_id=request_context.tenant_id(), order_id=order_id, dealer_id=dealer_id, sched_booking_id=sb.id, slot_date=date, slot_start=slot_start)
        s.add(b)
        s.flush()
        return b

    def reschedule(self, order_id: str, date: str, slot_start: str) -> Booking:
        order = self.orders.get(order_id)
        if order.status in ("FITTED", "COMPLETED", "CANCELLED", "REJECTED"):
            raise Problem.conflict(f"Order is {order.status}; the appointment cannot change", "booking-locked")
        max_ = int(self.settings.get_or("booking.maxReschedules", 2))
        with self.db.tx() as s:
            b = s.scalar(select(Booking).where(Booking.order_id == order_id))
            if b is None or b.status != "BOOKED":
                raise Problem.not_found("Booking")
            if b.reschedule_count >= max_:
                raise Problem.conflict(f"An appointment can be rescheduled at most {max_} times", "reschedule-limit")
            first, last = self._window()
            if date < first or date > last:
                raise Problem.unprocessable(f"Pick a date between {first} and {last}", "date-out-of-range")
            sb = self.scheduling.reschedule(b.sched_booking_id, date, slot_start, s)
            b.sched_booking_id, b.slot_date, b.slot_start = sb.id, date, slot_start
            b.reschedule_count += 1
            s.flush()
            return b

    def for_order(self, order_id: str) -> Booking | None:
        with self.db.tx() as s:
            return s.scalar(select(Booking).where(Booking.order_id == order_id))

    def appointments(self, dealer_id: str, date: str) -> list[dict[str, Any]]:
        with self.db.tx() as s:
            rows = s.scalars(
                select(Booking).where(Booking.dealer_id == dealer_id, Booking.slot_date == date, Booking.status == "BOOKED").order_by(Booking.slot_start)
            ).all()
        orders = {o.id: o for o in self.orders.by_ids([r.order_id for r in rows])}
        out = []
        for r in rows:
            o = orders.get(r.order_id)
            out.append(
                {
                    **row(r),
                    "orderNo": o.order_no if o else None,
                    "regnNo": o.regn_no if o else None,
                    "ownerName": o.owner_name if o else None,
                    "orderStatus": o.status if o else None,
                }
            )
        return out
