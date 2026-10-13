"""OEM vehicle data: the vehicles an OEM reports as built and supplied to its dealers, loaded from the OEM's vehicle data
file (Import utility, one mapping profile per OEM, or the standard profile with the OEM chosen at upload). New-vehicle
orders are checked against it."""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, or_, select

from app.contracts.schemas import OemVehicleRecord
from app.core.masters.service import MastersService
from app.core.order_intake.models import OemVehicle
from app.core.order_intake.validation_steps import OemVehicleFacts
from app.platform.context import request_context
from app.platform.db.session import Database
from app.platform.http.json import row
from app.platform.http.problem import Problem
from app.utility.import_export.service import ImportRowContext, ImportService


def pydantic_errors(e: ValidationError) -> str:
    """'field: message; …' as the zod-based import targets reported row errors."""
    return "; ".join(f"{'.'.join(str(p) for p in err['loc'])}: {err['msg'].removeprefix('Value error, ')}" for err in e.errors())


class OemVehicleDataService:
    def __init__(self, db: Database, masters: MastersService, imports: ImportService):
        self.db = db
        self.masters = masters
        imports.register_target("hsrp.oem-vehicle", self)

    def process_row(self, mapped: dict[str, str], ctx: ImportRowContext) -> dict[str, Any]:
        oem_code = ctx.context.get("oemCode")
        if not oem_code:
            raise RuntimeError("Import profile has no oemCode in its context")
        try:
            rec = OemVehicleRecord.model_validate({k: (None if v == "" else v) for k, v in mapped.items()})
        except ValidationError as e:
            raise Problem.bad_request(pydantic_errors(e)) from None
        return {"ref": self.record(oem_code, rec, ctx.job_id).id}

    def record(self, oem_code: str, r: OemVehicleRecord, import_job_id: str | None = None) -> OemVehicle:
        """Adds or refreshes one vehicle. A chassis already on file with a different engine is refused, not overwritten."""
        tenant_id = request_context.tenant_id()
        oem = self.masters.oem_by_code(oem_code)
        dealer = self.masters.dealer_by_code(r.dealer_code)
        if not self.masters.dealer_serves_oem(dealer.id, oem.id):
            raise Problem.bad_request(f"Dealer {r.dealer_code} is not a {oem.name} dealer")
        with self.db.tx() as s:
            existing = s.scalar(select(OemVehicle).where(OemVehicle.tenant_id == tenant_id, OemVehicle.oem_id == oem.id, OemVehicle.chassis_no == r.chassis_no))
            if existing is not None and existing.engine_no != r.engine_no:
                raise Problem.conflict(f"Chassis {r.chassis_no} is already on file with engine ending {existing.engine_no[-5:]}; correct it with the OEM")
            data = {
                "engine_no": r.engine_no,
                "model": r.model,
                "vahan_category": r.vahan_category,
                "dealer_id": dealer.id,
                "invoice_no": r.invoice_no,
                "invoice_date": r.invoice_date,
                "source": "FILE",
                "import_job_id": import_job_id,
            }
            if existing is None:
                existing = OemVehicle(tenant_id=tenant_id, oem_id=oem.id, chassis_no=r.chassis_no, **data)
                s.add(existing)
            else:
                for k, v in data.items():
                    setattr(existing, k, v)
            s.flush()
            return existing

    def facts(self, chassis_no: str, oem_id: str | None = None) -> OemVehicleFacts | None:
        """The OEM's record for a chassis, in the form the validation step judges. Any OEM when `oem_id` is not given."""
        q = select(OemVehicle).where(OemVehicle.tenant_id == request_context.tenant_id(), OemVehicle.chassis_no == chassis_no.upper())
        if oem_id:
            q = q.where(OemVehicle.oem_id == oem_id)
        with self.db.tx() as s:
            r = s.scalar(q.order_by(OemVehicle.updated_at.desc()))
        if r is None:
            return None
        oem = self.masters.oem(r.oem_id)
        dealer = self.masters.dealer(r.dealer_id) if r.dealer_id else None
        return OemVehicleFacts(oem.name if oem else "OEM", r.model, r.engine_no, dealer.code if dealer else None, r.invoice_date)

    def list(self, page: int, page_size: int, oem_code: str | None = None, q: str | None = None, import_job_id: str | None = None) -> dict[str, Any]:
        conds = [OemVehicle.tenant_id == request_context.tenant_id()]
        if oem_code:
            conds.append(OemVehicle.oem_id == self.masters.oem_by_code(oem_code).id)
        if import_job_id:
            conds.append(OemVehicle.import_job_id == import_job_id)
        if q:
            conds.append(
                or_(
                    OemVehicle.chassis_no.contains(q.upper(), autoescape=True),
                    OemVehicle.engine_no.contains(q.upper(), autoescape=True),
                    OemVehicle.model.icontains(q, autoescape=True),
                )
            )
        with self.db.tx() as s:
            rows = s.scalars(select(OemVehicle).where(*conds).order_by(OemVehicle.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
            total = s.scalar(select(func.count()).select_from(OemVehicle).where(*conds)) or 0
        oems = {o.id: o.code for o in (self.masters.oem(i) for i in {r.oem_id for r in rows}) if o}
        dealers = {d.id: d.code for d in self.masters.dealers(list({r.dealer_id for r in rows if r.dealer_id}))}
        items = [{**row(r), "oemCode": oems.get(r.oem_id), "dealerCode": dealers.get(r.dealer_id)} for r in rows]
        return {"items": items, "total": total, "page": page, "pageSize": page_size}

    def counts_by_job(self, job_ids: list[str]) -> dict[str, int]:
        """Records per import job, for the OEM history report."""
        if not job_ids:
            return {}
        with self.db.tx() as s:
            rows = s.execute(
                select(OemVehicle.import_job_id, func.count())
                .where(OemVehicle.tenant_id == request_context.tenant_id(), OemVehicle.import_job_id.in_(job_ids))
                .group_by(OemVehicle.import_job_id)
            ).all()
        return dict(rows)
