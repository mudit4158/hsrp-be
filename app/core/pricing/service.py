"""Prices per state, vehicle class, order type and plate set (optionally OEM- and type-specific), plus extra charges."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.pricing.models import ExtraCharge, PriceRule
from app.platform.context import request_context
from app.platform.db.base import naive_utc, utcnow
from app.platform.db.session import Database
from app.platform.http.json import row
from app.platform.http.problem import Problem
from app.utility.audit.service import AuditService
from app.utility.wallet.service import to_paise


@dataclass
class PriceQuery:
    state_code: str
    vehicle_class: str
    order_type: str
    plate_set: str
    at: datetime
    vehicle_type: str | None = None
    oem_code: str | None = None

    def wire(self) -> dict[str, Any]:
        return {
            "stateCode": self.state_code,
            "vehicleClass": self.vehicle_class,
            "vehicleType": self.vehicle_type,
            "oemCode": self.oem_code,
            "orderType": self.order_type,
            "plateSet": self.plate_set,
            "at": self.at,
        }


def best_rule(rules: list[Any], q: PriceQuery) -> Any:
    """The most specific effective rule: OEM-specific beats generic, then type-specific beats any type."""
    candidates = [
        r
        for r in rules
        if r.state_code == q.state_code
        and r.vehicle_class == q.vehicle_class
        and r.order_type == q.order_type
        and r.plate_set == q.plate_set
        and r.effective_from <= q.at
        and (r.effective_to is None or r.effective_to > q.at)
        and (r.oem_code is None or r.oem_code == q.oem_code)
        and (r.vehicle_type is None or r.vehicle_type == q.vehicle_type)
    ]
    candidates.sort(key=lambda r: ((2 if r.oem_code else 0) + (1 if r.vehicle_type else 0), r.effective_from), reverse=True)
    return candidates[0] if candidates else None


def charge_applies(conditions: dict[str, Any], facts: dict[str, Any]) -> bool:
    """An extra charge applies when every condition key equals the order's value (or is one of a list)."""
    return all(facts.get(k) in v if isinstance(v, list) else facts.get(k) == v for k, v in conditions.items())


class PricingService:
    def __init__(self, db: Database, audit: AuditService):
        self.db = db
        self.audit = audit

    def quote(self, q: PriceQuery, facts: dict[str, Any] | None = None, s: Session | None = None) -> dict[str, Any]:
        tenant_id = request_context.tenant_id()
        with self.db.use(s) as session:
            rules = session.scalars(
                select(PriceRule).where(
                    PriceRule.tenant_id == tenant_id,
                    PriceRule.state_code == q.state_code,
                    PriceRule.vehicle_class == q.vehicle_class,
                    PriceRule.order_type == q.order_type,
                    PriceRule.plate_set == q.plate_set,
                )
            ).all()
            rule = best_rule(list(rules), q)
            if rule is None:
                raise Problem.unprocessable(f"No price for {q.vehicle_class} {q.order_type} {q.plate_set} in {q.state_code}", "price-missing")
            charges = session.scalars(
                select(ExtraCharge).where(
                    ExtraCharge.tenant_id == tenant_id,
                    ExtraCharge.effective_from <= q.at,
                    or_(ExtraCharge.effective_to.is_(None), ExtraCharge.effective_to > q.at),
                )
            ).all()
        all_facts = {**(facts or {}), "stateCode": q.state_code, "vehicleClass": q.vehicle_class, "orderType": q.order_type, "plateSet": q.plate_set}
        extras = [{"code": c.code, "name": c.name, "amountPaise": c.amount_paise} for c in charges if charge_applies(c.conditions or {}, all_facts)]
        return {
            "ruleId": rule.id,
            "basePaise": rule.amount_paise,
            "extras": extras,
            "totalPaise": rule.amount_paise + sum(e["amountPaise"] for e in extras),
            "query": q.wire(),
        }

    def rules(self, state_code: str | None = None, current: bool = False) -> list[PriceRule]:
        now = utcnow()
        q = select(PriceRule).where(PriceRule.tenant_id == request_context.tenant_id())
        if state_code:
            q = q.where(PriceRule.state_code == state_code)
        if current:
            q = q.where(PriceRule.effective_from <= now, or_(PriceRule.effective_to.is_(None), PriceRule.effective_to > now))
        q = q.order_by(PriceRule.state_code, PriceRule.vehicle_class, PriceRule.order_type, PriceRule.plate_set, PriceRule.effective_from.desc())
        with self.db.tx() as s:
            return list(s.scalars(q))

    def set_price(
        self,
        state_code: str,
        vehicle_class: str,
        order_type: str,
        plate_set: str,
        amount_rupees: float,
        vehicle_type: str | None = None,
        oem_code: str | None = None,
        published: bool = False,
        effective_from: datetime | None = None,
    ) -> PriceRule:
        """Adds a price from `effective_from`, closing the previous rule with the same key. Old prices stay for history."""
        start = naive_utc(effective_from) if effective_from else utcnow()
        key = {
            "tenant_id": request_context.tenant_id(),
            "state_code": state_code,
            "vehicle_class": vehicle_class,
            "vehicle_type": vehicle_type,
            "oem_code": oem_code,
            "order_type": order_type,
            "plate_set": plate_set,
        }
        with self.db.tx() as s:
            conds = [getattr(PriceRule, k).is_(None) if v is None else getattr(PriceRule, k) == v for k, v in key.items()]
            open_rules = s.scalars(select(PriceRule).where(*conds, PriceRule.effective_to.is_(None), PriceRule.effective_from <= start)).all()
            before = [{"id": o.id, "amountPaise": o.amount_paise} for o in open_rules]
            for o in open_rules:
                o.effective_to = start
            rule = PriceRule(**key, amount_paise=to_paise(amount_rupees), published=published, effective_from=start)
            s.add(rule)
            s.flush()
            self.audit.record("price.set", "hsrp.price", rule.id, before, row(rule), s=s)
            return rule

    def extra_charges(self) -> list[ExtraCharge]:
        with self.db.tx() as s:
            return list(s.scalars(select(ExtraCharge).where(ExtraCharge.tenant_id == request_context.tenant_id()).order_by(ExtraCharge.code)))

    def add_extra_charge(self, code: str, name: str, amount_rupees: float, conditions: dict[str, Any]) -> ExtraCharge:
        with self.db.tx() as s:
            c = ExtraCharge(
                tenant_id=request_context.tenant_id(), code=code, name=name, amount_paise=to_paise(amount_rupees), conditions=conditions, effective_from=utcnow()
            )
            s.add(c)
            s.flush()
        self.audit.record("price.extra-charge.create", "hsrp.extra-charge", c.id, after=row(c))
        return c
