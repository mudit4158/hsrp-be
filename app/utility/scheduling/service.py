"""Resources with weekly capacity calendars, slots and bookings. Knows nothing about what is booked."""

from dataclasses import dataclass
from datetime import date as Date
from typing import Any

from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.platform.context import request_context
from app.platform.db.base import new_id, utcnow
from app.platform.db.session import Database
from app.platform.http.problem import Problem
from app.utility.scheduling.models import SchedBooking, SchedCalendarRule, SchedClosure, SchedResource


@dataclass
class CalendarRule:
    weekday: int
    start_time: str
    end_time: str
    slot_minutes: int
    capacity: int


def _to_min(t: str) -> int:
    h, m = (int(x) for x in t.split(":"))
    return h * 60 + m


def _to_hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def slot_starts(start_time: str, end_time: str, slot_minutes: int) -> list[str]:
    """Slot starts for one calendar rule."""
    out = []
    m = _to_min(start_time)
    while m + slot_minutes <= _to_min(end_time):
        out.append(_to_hhmm(m))
        m += slot_minutes
    return out


def weekday_of(date: str) -> int:
    """Weekday (0 = Sunday, as JavaScript getUTCDay) of a YYYY-MM-DD date."""
    return (Date.fromisoformat(date).weekday() + 1) % 7


class SchedulingService:
    def __init__(self, db: Database):
        self.db = db

    def upsert_resource(self, code: str, name: str, subject_type: str | None = None, subject_id: str | None = None, s: Session | None = None) -> SchedResource:
        now = utcnow()
        stmt = (
            insert(SchedResource)
            .values(
                id=new_id(),
                tenant_id=request_context.tenant_id(),
                code=code,
                name=name,
                subject_type=subject_type,
                subject_id=subject_id,
                active=True,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_update(index_elements=["tenant_id", "code"], set_={"name": name, "updated_at": now})
            .returning(SchedResource)
        )
        with self.db.use(s) as session:
            return session.scalars(stmt).one()

    def set_calendar(self, resource_id: str, rules: list[CalendarRule], s: Session | None = None) -> None:
        tenant_id = request_context.tenant_id()
        with self.db.use(s) as session:
            session.execute(delete(SchedCalendarRule).where(SchedCalendarRule.resource_id == resource_id))
            session.add_all(
                SchedCalendarRule(
                    tenant_id=tenant_id,
                    resource_id=resource_id,
                    weekday=r.weekday,
                    start_time=r.start_time,
                    end_time=r.end_time,
                    slot_minutes=r.slot_minutes,
                    capacity=r.capacity,
                )
                for r in rules
            )
            session.flush()

    def resource_for(self, subject_type: str, subject_id: str, s: Session | None = None) -> SchedResource | None:
        with self.db.use(s) as session:
            return session.scalar(
                select(SchedResource).where(
                    SchedResource.tenant_id == request_context.tenant_id(),
                    SchedResource.subject_type == subject_type,
                    SchedResource.subject_id == subject_id,
                    SchedResource.active.is_(True),
                )
            )

    def slots(self, resource_id: str, date: str, s: Session | None = None) -> list[dict[str, Any]]:
        with self.db.use(s) as session:
            closed = session.scalar(select(SchedClosure).where(SchedClosure.resource_id == resource_id, SchedClosure.date == date))
            if closed is not None:
                return []
            rules = session.scalars(select(SchedCalendarRule).where(SchedCalendarRule.resource_id == resource_id, SchedCalendarRule.weekday == weekday_of(date))).all()
            booked = dict(
                session.execute(
                    select(SchedBooking.slot_start, func.count())
                    .where(SchedBooking.resource_id == resource_id, SchedBooking.date == date, SchedBooking.status == "BOOKED")
                    .group_by(SchedBooking.slot_start)
                ).all()
            )
        slots = sorted(({"start": start, "capacity": r.capacity} for r in rules for start in slot_starts(r.start_time, r.end_time, r.slot_minutes)), key=lambda x: x["start"])
        return [{**x, "booked": booked.get(x["start"], 0), "available": max(0, x["capacity"] - booked.get(x["start"], 0))} for x in slots]

    def book(self, resource_id: str, date: str, slot_start: str, subject_type: str, subject_id: str, s: Session) -> SchedBooking:
        """Books one unit of capacity. Serialised per slot with an advisory lock so capacity is never exceeded."""
        s.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"{resource_id}|{date}|{slot_start}"})
        slot = next((x for x in self.slots(resource_id, date, s) if x["start"] == slot_start), None)
        if slot is None:
            raise Problem.unprocessable("That slot does not exist on that date", "slot-invalid")
        if slot["available"] <= 0:
            raise Problem.conflict("That slot is full. Pick another one.", "slot-full")
        b = SchedBooking(
            tenant_id=request_context.tenant_id(), resource_id=resource_id, date=date, slot_start=slot_start, subject_type=subject_type, subject_id=subject_id
        )
        s.add(b)
        s.flush()
        return b

    def cancel(self, booking_id: str, s: Session | None = None) -> SchedBooking:
        with self.db.use(s) as session:
            b = session.get(SchedBooking, booking_id)
            if b is None:
                raise Problem(404, "Not found", "Record not found", "not-found")
            b.status = "CANCELLED"
            session.flush()
            return b

    def reschedule(self, booking_id: str, date: str, slot_start: str, s: Session) -> SchedBooking:
        old = s.get(SchedBooking, booking_id)
        if old is None:
            raise Problem(404, "Not found", "Record not found", "not-found")
        if old.status != "BOOKED":
            raise Problem.conflict("Booking is not active")
        old.status = "CANCELLED"
        s.flush()
        return self.book(old.resource_id, date, slot_start, old.subject_type, old.subject_id, s)

    def bookings_for(self, resource_id: str, date: str) -> list[SchedBooking]:
        with self.db.tx() as s:
            return list(
                s.scalars(
                    select(SchedBooking)
                    .where(SchedBooking.resource_id == resource_id, SchedBooking.date == date, SchedBooking.status == "BOOKED")
                    .order_by(SchedBooking.slot_start)
                )
            )
