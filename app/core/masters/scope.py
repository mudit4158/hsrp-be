"""Translates the signed-in actor's organisation into the HSRP records it may see."""

from dataclasses import dataclass
from typing import Any

from app.core.masters.service import MastersService
from app.platform.context import Actor, request_context
from app.platform.http.problem import Problem


@dataclass
class ActorScope:
    # Staff (admin, operations) see everything.
    all: bool
    dealer_id: str | None = None
    station_id: str | None = None
    oem_id: str | None = None
    customer_regn_no: str | None = None
    customer_mobile: str | None = None


class ScopeService:
    def __init__(self, masters: MastersService):
        self.masters = masters

    def current(self, actor: Actor | None = None) -> ActorScope:
        actor = actor or request_context.actor()
        if actor is None:
            raise Problem.unauthorized()
        if "*" in actor.permissions or "ADMIN" in actor.roles or "OPERATIONS" in actor.roles:
            return ActorScope(True)
        if "DEALER" in actor.roles:
            d = self.masters.dealer_for_org(actor.org_id)
            if d is None:
                raise Problem.forbidden("Your user is not linked to a dealer")
            return ActorScope(False, dealer_id=d.id)
        if "STATION_USER" in actor.roles:
            st = self.masters.station_for_org(actor.org_id)
            if st is None:
                raise Problem.forbidden("Your user is not linked to an embossing station")
            return ActorScope(False, station_id=st.id)
        if "OEM_CLIENT" in actor.roles:
            o = self.masters.oem_for_org(actor.org_id)
            if o is None:
                raise Problem.forbidden("This client is not linked to an OEM")
            return ActorScope(False, oem_id=o.id)
        if "CUSTOMER" in actor.roles:
            claims = actor.claims or {}
            return ActorScope(False, customer_regn_no=claims.get("regnNo"), customer_mobile=claims.get("mobile"))
        raise Problem.forbidden()

    def dealer_id(self) -> str:
        sc = self.current()
        if not sc.dealer_id:
            raise Problem.forbidden("Only dealers can do this")
        return sc.dealer_id

    def where(self) -> dict[str, str]:
        """Filter (model attribute → value) for records that carry dealer_id / station_id / oem_id."""
        sc = self.current()
        if sc.all:
            return {}
        if sc.dealer_id:
            return {"dealer_id": sc.dealer_id}
        if sc.station_id:
            return {"station_id": sc.station_id}
        if sc.oem_id:
            return {"oem_id": sc.oem_id}
        if sc.customer_regn_no:
            return {"regn_no": sc.customer_regn_no}
        return {"id": "__none__"}

    def conditions(self, model: Any) -> list[Any]:
        """where() as SQLAlchemy conditions on `model`."""
        return [getattr(model, k) == v for k, v in self.where().items()]
