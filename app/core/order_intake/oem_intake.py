"""OEM orders by API push and by CSV file (through the Import utility with one mapping profile per OEM)."""

from typing import Any

from pydantic import ValidationError

from app.contracts.schemas import OemOrderRequest
from app.core.masters.service import MastersService
from app.core.order_intake.models import Order
from app.core.order_intake.oem_vehicle_data import pydantic_errors
from app.core.order_intake.orders import NewOrder, OrderService
from app.core.ports import OrderSource
from app.platform.context import request_context
from app.platform.db.session import Database
from app.platform.http.problem import Problem
from app.utility.import_export.service import ImportRowContext, ImportService


class OemIntakeService:
    def __init__(self, db: Database, orders: OrderService, masters: MastersService, imports: ImportService, source: OrderSource):
        self.db = db
        self.orders = orders
        self.masters = masters
        self.source = source
        imports.register_target("hsrp.oem-order", self)

    def process_row(self, mapped: dict[str, str], ctx: ImportRowContext) -> dict[str, Any]:
        oem_code = ctx.context.get("oemCode")
        if not oem_code:
            raise RuntimeError("Import profile has no oemCode in its context")
        try:
            req = OemOrderRequest.model_validate(mapped)
        except ValidationError as e:
            raise Problem.bad_request(pydantic_errors(e)) from None
        return {"ref": self._intake(oem_code, req, "OEM_FILE").id}

    def push(self, oem_code: str, payload: Any) -> dict[str, Any]:
        """API push. The caller must be the OEM's own API client."""
        oem = self.masters.oem_by_code(oem_code)
        actor = request_context.actor()
        if actor is not None and actor.type == "api-client" and actor.org_id != oem.org_id:
            raise Problem.forbidden("This API key belongs to another OEM")
        canonical = self.source.to_canonical(oem.code, payload)
        order = self._intake(oem.code, canonical, "OEM_API")
        return {"orderId": order.id, "orderNo": order.order_no, "status": order.status, "oemOrderRef": order.source_ref}

    def _intake(self, oem_code: str, req: OemOrderRequest, channel: str) -> Order:
        oem = self.masters.oem_by_code(oem_code)
        dup = self.orders.find_by_source_ref(oem.id, req.oem_order_ref)
        if dup is not None:
            raise Problem.conflict(
                f"OEM order {req.oem_order_ref} was already received as {dup.order_no}", "duplicate-oem-order", {"orderId": dup.id, "orderNo": dup.order_no}
            )
        dealer = self.masters.dealer_by_code(req.dealer_code)
        with self.db.tx() as s:
            return self.orders.create(
                s,
                NewOrder(
                    regn_no=req.regn_no,
                    chassis_no=req.chassis_no,
                    engine_no=req.engine_no,
                    channel=channel,
                    owner_name=req.owner_name,
                    mobile=req.mobile,
                    dealer_id=dealer.id,
                    oem_id=oem.id,
                    source_ref=req.oem_order_ref,
                ),
            )

    def status(self, oem_code: str, ref: str) -> dict[str, Any]:
        oem = self.masters.oem_by_code(oem_code)
        o = self.orders.find_by_source_ref(oem.id, ref)
        if o is None:
            raise Problem.not_found("Order")
        return {"oemOrderRef": ref, "orderNo": o.order_no, "status": o.status, "rejectionReason": o.rejection_reason, "updatedAt": o.updated_at}
