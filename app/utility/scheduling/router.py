from typing import Annotated

from pydantic import Field, StringConstraints
from sqlalchemy import select

from app.platform.context import request_context
from app.platform.http.decorators import require
from app.platform.http.json import ApiModel
from app.platform.http.routing import router as api_router
from app.platform.registry import services
from app.utility.scheduling.models import SchedCalendarRule, SchedResource
from app.utility.scheduling.service import CalendarRule

router = api_router("/scheduling", ["scheduling"])

HHMM = Annotated[str, StringConstraints(pattern=r"^\d{2}:\d{2}$")]


class RuleBody(ApiModel):
    weekday: int = Field(ge=0, le=6)
    start_time: HHMM
    end_time: HHMM
    slot_minutes: int = Field(ge=10, le=480)
    capacity: int = Field(ge=1, le=100)


class CalendarBody(ApiModel):
    rules: list[RuleBody]


@router.get("/resources")
@require("scheduling.manage", "masters.read")
def resources():
    with services().db.tx() as s:
        return list(s.scalars(select(SchedResource).where(SchedResource.tenant_id == request_context.tenant_id()).order_by(SchedResource.code)))


@router.get("/resources/{id}/calendar")
@require("scheduling.manage", "masters.read")
def calendar(id: str):
    with services().db.tx() as s:
        return list(s.scalars(select(SchedCalendarRule).where(SchedCalendarRule.resource_id == id).order_by(SchedCalendarRule.weekday, SchedCalendarRule.start_time)))


@router.put("/resources/{id}/calendar")
@require("scheduling.manage")
def set_calendar(id: str, body: CalendarBody):
    rules = [CalendarRule(r.weekday, r.start_time, r.end_time, r.slot_minutes, r.capacity) for r in body.rules]
    services().scheduling.set_calendar(id, rules)


@router.get("/resources/{id}/slots")
@require("scheduling.manage", "masters.read", "orders.read")
def slots(id: str, date: str):
    return services().scheduling.slots(id, date)


@router.get("/resources/{id}/bookings")
@require("scheduling.manage", "orders.read")
def bookings(id: str, date: str):
    return services().scheduling.bookings_for(id, date)
