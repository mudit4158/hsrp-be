from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import Query
from pydantic import Field, StringConstraints

from app.contracts.enums import OrderType, PlateSet, VehicleClass, VehicleType
from app.core.pricing.service import PriceQuery
from app.platform.db.base import utcnow
from app.platform.http.decorators import require
from app.platform.http.json import ApiModel
from app.platform.http.routing import router as api_router
from app.platform.registry import services

router = api_router("", ["pricing"])

TwoLetters = Annotated[str, StringConstraints(min_length=2, max_length=2)]


class PriceRuleBody(ApiModel):
    state_code: TwoLetters
    vehicle_class: VehicleClass
    vehicle_type: VehicleType | None = None
    oem_code: str | None = None
    order_type: OrderType
    plate_set: PlateSet = "BOTH"
    amount_rupees: float = Field(gt=0, le=100_000)
    published: bool = False
    effective_from: datetime | None = None


class ExtraChargeBody(ApiModel):
    code: Annotated[str, StringConstraints(min_length=2)]
    name: Annotated[str, StringConstraints(min_length=2)]
    amount_rupees: float = Field(gt=0)
    conditions: dict[str, Any]


class QuoteQuery(ApiModel):
    state_code: TwoLetters
    vehicle_class: VehicleClass
    vehicle_type: VehicleType | None = None
    oem_code: str | None = None
    order_type: OrderType = "NEW"
    plate_set: PlateSet = "BOTH"
    green_strip: Literal["true", "false"] | None = None


@router.get("/pricing/rules")
@require("masters.read", "pricing.manage")
def rules(stateCode: str | None = None, current: str | None = None):  # noqa: N803
    return services().pricing.rules(stateCode, current == "true")


@router.post("/pricing/rules")
@require("pricing.manage")
def set_price(body: PriceRuleBody):
    return services().pricing.set_price(
        body.state_code,
        body.vehicle_class,
        body.order_type,
        body.plate_set,
        body.amount_rupees,
        body.vehicle_type,
        body.oem_code,
        body.published,
        body.effective_from,
    )


@router.get("/pricing/extra-charges")
@require("masters.read", "pricing.manage")
def extras():
    return services().pricing.extra_charges()


@router.post("/pricing/extra-charges")
@require("pricing.manage")
def add_extra(body: ExtraChargeBody):
    return services().pricing.add_extra_charge(body.code, body.name, body.amount_rupees, body.conditions)


@router.get("/pricing/quote")
@require("orders.read", "masters.read")
def quote(q: Annotated[QuoteQuery, Query()]):
    pq = PriceQuery(q.state_code, q.vehicle_class, q.order_type, q.plate_set, utcnow(), q.vehicle_type, q.oem_code)
    return services().pricing.quote(pq, {"greenStrip": q.green_strip == "true"})
