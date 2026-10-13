"""Audit-style reports: every status change, every validation step, everything exchanged with OEMs, every laser code."""

from datetime import datetime
from typing import Any

from app.core.oversight.reports import DATES, date_range, range_filter
from app.core.shared.subjects import IST
from app.utility.reporting.service import ReportDefinition, ReportingService

STEP_LABEL = {
    "oem-catalogue-check": "OEM catalogue",
    "oem-vehicle-data": "OEM vehicle data",
    "vahan-check": "VAHAN",
    "state-eligibility-rules": "State rules",
    "pricing": "Pricing",
}


def day(d: datetime | None) -> str:
    """'YYYY-MM-DD HH:MM:SS' in IST."""
    return (d + IST).strftime("%Y-%m-%d %H:%M:%S") if d else ""


def scoped_orders(o: Any, p: dict[str, str], extra: dict[str, Any] | None = None, any_of: list[dict[str, Any]] | None = None) -> list[Any]:
    """Orders in the caller's scope matching the order-level filters (number, registration, dates)."""
    filters: dict[str, Any] = {**o.scope.where(), **(extra or {})}
    if (r := range_filter(p)) is not None:
        filters["created_at"] = r
    q = (p.get("orderNo") or "").strip().upper()
    if q:
        # Number OR registration; combined with an `any_of` the caller gave, both must hold (filter in Python).
        rows = o.orders.raw_query(filters, [{"order_no": {"contains": q}}, {"regn_no": {"contains": q}}])
        if any_of:
            keep = {x.id for x in o.orders.raw_query(filters, any_of)}
            rows = [x for x in rows if x.id in keep]
        return rows
    return o.orders.raw_query(filters, any_of)


def user_names(o: Any) -> dict[str, str]:
    return {u["id"]: u["username"] for u in o.identity.list_users()}


def oem_codes(o: Any, ids: list[str | None]) -> dict[str, str]:
    out = {}
    for i in {x for x in ids if x}:
        oem = o.masters.oem(i)
        if oem:
            out[oem.id] = oem.code
    return out


def register_audit_reports(reporting: ReportingService, o: Any) -> None:
    def order_history(p: dict[str, str]) -> list[dict[str, Any]]:
        orders = scoped_orders(o, p)
        history = o.orders.history_for([x.id for x in orders])
        names = user_names(o)
        dealers = {d.id: d.code for d in o.masters.dealers(list({x.dealer_id for x in orders if x.dealer_id}))}
        by_id = {x.id: x for x in orders}
        out = []
        for h in history:
            ord_ = by_id.get(h.order_id)
            out.append(
                {
                    "at": day(h.created_at),
                    "orderNo": ord_.order_no if ord_ else None,
                    "regnNo": ord_.regn_no if ord_ else None,
                    "dealer": dealers.get(ord_.dealer_id, "") if ord_ else "",
                    "from": h.from_status or "",
                    "to": h.to_status,
                    "trigger": h.trigger,
                    "by": names.get(h.actor_id, h.actor_id) if h.actor_id else "system",
                    "note": h.note or "",
                }
            )
        return out

    reporting.register(
        ReportDefinition(
            "order-history",
            "Order history",
            "Every status change of every order: when, from and to which status, why, and by whom.",
            [*DATES, {"name": "orderNo", "label": "Order or registration", "type": "text"}],
            [
                {"key": "at", "label": "When (IST)"},
                {"key": "orderNo", "label": "Order no"},
                {"key": "regnNo", "label": "Registration"},
                {"key": "dealer", "label": "Dealer"},
                {"key": "from", "label": "From"},
                {"key": "to", "label": "To"},
                {"key": "trigger", "label": "Trigger"},
                {"key": "by", "label": "By"},
                {"key": "note", "label": "Note"},
            ],
            order_history,
        )
    )

    def order_validations(p: dict[str, str]) -> list[dict[str, Any]]:
        orders = scoped_orders(o, p)
        by_id = {x.id: x for x in orders}
        out = []
        for v in o.orders.validations_for([x.id for x in orders]):
            if p.get("outcome") and v.outcome != p["outcome"]:
                continue
            ord_ = by_id.get(v.order_id)
            out.append(
                {
                    "at": day(v.created_at),
                    "orderNo": ord_.order_no if ord_ else None,
                    "regnNo": ord_.regn_no if ord_ else None,
                    "channel": ord_.channel if ord_ else None,
                    "step": STEP_LABEL.get(v.step, v.step),
                    "outcome": v.outcome,
                    "message": v.message or "",
                    "status": ord_.status if ord_ else None,
                }
            )
        return out

    reporting.register(
        ReportDefinition(
            "order-validations",
            "Order validation results",
            "Each validation step run on each order (OEM data, VAHAN, state rules, pricing) with its result.",
            [*DATES, {"name": "orderNo", "label": "Order or registration", "type": "text"}, {"name": "outcome", "label": "Result", "type": "select", "options": ["PASS", "FAIL"]}],
            [
                {"key": "at", "label": "When (IST)"},
                {"key": "orderNo", "label": "Order no"},
                {"key": "regnNo", "label": "Registration"},
                {"key": "channel", "label": "Channel"},
                {"key": "step", "label": "Step"},
                {"key": "outcome", "label": "Result"},
                {"key": "message", "label": "Message"},
                {"key": "status", "label": "Order status now"},
            ],
            order_validations,
        )
    )

    def oem_history(p: dict[str, str]) -> list[dict[str, Any]]:
        start, end = date_range(p) or (None, None)
        jobs = o.imports.jobs(["hsrp.oem-vehicle", "hsrp.oem-order"], start, end)
        calls = o.calls.list("OEM", start, end)
        oem_orders = scoped_orders(o, {"from": p.get("from", ""), "to": p.get("to", "")}, any_of=[{"channel": ["OEM_API", "OEM_FILE"]}, {"oem_id": {"not": None}}])
        checks = o.orders.validations_for([x.id for x in oem_orders], "oem-vehicle-data")
        by_id = {x.id: x for x in oem_orders}
        codes = oem_codes(o, [x.oem_id for x in oem_orders])
        vehicle_counts = o.oem_data.counts_by_job([j["id"] for j in jobs if j["targetType"] == "hsrp.oem-vehicle"])
        rows: list[tuple[datetime, dict[str, Any]]] = []
        for j in jobs:
            vehicle_file = j["targetType"] == "hsrp.oem-vehicle"
            rows.append(
                (
                    j["createdAt"],
                    {
                        "at": day(j["createdAt"]),
                        "oem": j["context"].get("oemCode", ""),
                        "event": "Vehicle data file received" if vehicle_file else "Order file received",
                        "reference": j["filename"],
                        "orderNo": "",
                        "result": f"{j['totalRows']} rows: {j['okRows']} accepted, {j['errorRows']} refused",
                        "detail": f"{vehicle_counts.get(j['id'], 0)} vehicles on file from this upload"
                        if vehicle_file
                        else f"{'Processed' if j['status'] == 'DONE' else 'Processing'} · {j['profileName']}",
                    },
                )
            )
        for ord_ in (x for x in oem_orders if x.channel in ("OEM_API", "OEM_FILE")):
            rows.append(
                (
                    ord_.created_at,
                    {
                        "at": day(ord_.created_at),
                        "oem": codes.get(ord_.oem_id or "", ""),
                        "event": "Order received by API" if ord_.channel == "OEM_API" else "Order received in file",
                        "reference": ord_.source_ref or "",
                        "orderNo": ord_.order_no,
                        "result": ord_.status,
                        "detail": ord_.rejection_reason or "",
                    },
                )
            )
        for v in checks:
            ord_ = by_id.get(v.order_id)
            rows.append(
                (
                    v.created_at,
                    {
                        "at": day(v.created_at),
                        "oem": codes.get((ord_.oem_id if ord_ else None) or "", ""),
                        "event": "Order checked against OEM vehicle data",
                        "reference": ord_.chassis_no if ord_ else "",
                        "orderNo": ord_.order_no if ord_ else None,
                        "result": v.outcome,
                        "detail": v.message or "",
                    },
                )
            )
        for c in calls:
            req = c.request or {}
            ord_ = by_id.get(c.subject_id) if c.subject_id else None
            event = f"Status sent to OEM: {req.get('status')}" if c.operation == "status-callback" else "OEM catalogue check" if c.operation == "catalogue-check" else c.operation
            rows.append(
                (
                    c.created_at,
                    {
                        "at": day(c.created_at),
                        "oem": req.get("oem", ""),
                        "event": event,
                        "reference": req.get("ref") or req.get("chassisNo") or "",
                        "orderNo": ord_.order_no if ord_ else "",
                        "result": c.outcome,
                        "detail": c.error or "",
                    },
                )
            )
        rows = [x for x in rows if not p.get("oemCode") or x[1]["oem"] == p["oemCode"]]
        rows.sort(key=lambda x: x[0], reverse=True)
        return [x[1] for x in rows]

    reporting.register(
        ReportDefinition(
            "oem-history",
            "OEM history",
            "Everything exchanged with OEMs: vehicle data and order files, orders received, orders checked against OEM data, status callbacks.",
            [*DATES, {"name": "oemCode", "label": "OEM", "type": "select", "options": ["KRANTI", "ZENMO"]}],
            [
                {"key": "at", "label": "When (IST)"},
                {"key": "oem", "label": "OEM"},
                {"key": "event", "label": "Event"},
                {"key": "reference", "label": "Reference"},
                {"key": "orderNo", "label": "Order no"},
                {"key": "result", "label": "Result"},
                {"key": "detail", "label": "Detail"},
            ],
            oem_history,
        )
    )

    def plate_photo_checks(p: dict[str, str]) -> list[dict[str, Any]]:
        orders = scoped_orders(o, p)
        ids = [x.id for x in orders]
        names = user_names(o)
        by_id = {x.id: x for x in orders}
        checks = [(c, "Embossing (station)", c.laser_code) for c in o.production.photo_checks_for(ids)]
        checks += [(c, "Fitment (dealer)" if c.fitment_id else "Fitment (dealer) — refused", "") for c in o.fitment.photo_checks(ids)]
        checks = [x for x in checks if not p.get("result") or x[0].result == p["result"]]
        checks.sort(key=lambda x: x[0].created_at, reverse=True)
        return [
            {
                "at": day(c.created_at),
                "stage": stage,
                "orderNo": by_id[c.order_id].order_no if c.order_id in by_id else None,
                "expected": c.expected,
                "position": c.position,
                "laserCode": laser or "",
                "readText": c.read_text or "(nothing read)",
                "result": c.result,
                "reason": c.reason,
                "engine": c.engine,
                "by": names.get(c.actor_id, c.actor_id) if c.actor_id else "",
            }
            for c, stage, laser in checks
        ]

    reporting.register(
        ReportDefinition(
            "plate-photo-checks",
            "Plate photo checks (OCR)",
            "Every OCR reading of a plate photo, after embossing and at fitment, with what was read and the result.",
            [*DATES, {"name": "orderNo", "label": "Order or registration", "type": "text"}, {"name": "result", "label": "Result", "type": "select", "options": ["PASS", "FAIL"]}],
            [
                {"key": "at", "label": "When (IST)"},
                {"key": "stage", "label": "Stage"},
                {"key": "orderNo", "label": "Order no"},
                {"key": "expected", "label": "Ordered registration"},
                {"key": "position", "label": "Plate"},
                {"key": "laserCode", "label": "Laser code"},
                {"key": "readText", "label": "Read from the photo"},
                {"key": "result", "label": "Result"},
                {"key": "reason", "label": "Reason"},
                {"key": "engine", "label": "OCR engine"},
                {"key": "by", "label": "By"},
            ],
            plate_photo_checks,
        )
    )

    def laser_code_audit(p: dict[str, str]) -> list[dict[str, Any]]:
        start, end = date_range(p) or (None, None)
        orders = scoped_orders(o, {"orderNo": p["orderNo"]} if p.get("orderNo") else {})
        allocations = o.inventory.allocations(start, end, p.get("laserCode"), [x.id for x in orders])
        order_ids = list({a.order_id for a in allocations})
        plates = {x["laserCode"]: x for x in o.inventory.plates_by_codes(list({a.laser_code for a in allocations}))}
        cards = {c["id"]: c["jobCardNo"] for c in o.production.job_cards_by_ids(list({a.job_card_id for a in allocations if a.job_card_id}))}
        qcs = o.production.qc_records_for(order_ids)
        lines = o.dispatch.lines_for_allocations([a.id for a in allocations])
        fitments = o.fitment.for_orders(order_ids)
        ocr = o.production.photo_checks_for(order_ids)
        challans = {c.id: c.challan_no for c in o.dispatch.challans_by_ids(list({x.challan_id for x in lines}))}
        by_id = {x.id: x for x in orders}
        out = []
        for a in allocations:
            plate = plates.get(a.laser_code)
            line = next((x for x in lines if x.allocation_id == a.id), None)
            fit = next((f for f in fitments if f.order_id == a.order_id and a.laser_code in (f.front_laser_code, f.rear_laser_code)), None)
            # QC records name positions, not laser codes (a PASS names none: it covers every plate of the order). The
            # one that applies is the first after this allocation was issued and before it was closed.
            qc = next(
                (
                    q
                    for q in qcs
                    if q.order_id == a.order_id
                    and (q.result == "PASS" or a.position in q.positions)
                    and q.created_at >= a.created_at
                    and (not a.closed_at or q.created_at <= a.closed_at)
                ),
                None,
            )
            ord_ = by_id.get(a.order_id)
            photos = [c for c in ocr if c.allocation_id == a.id]
            photo = photos[-1] if photos else None
            out.append(
                {
                    "laserCode": a.laser_code,
                    "ocr": f"{photo.result}{f' ({photo.read_text})' if photo.read_text else ''}" if photo else "",
                    "product": plate["productCode"] if plate else "",
                    "box": (plate or {}).get("boxNo") or "",
                    "plateStatus": plate["status"] if plate else "",
                    "orderNo": ord_.order_no if ord_ else None,
                    "regnNo": ord_.regn_no if ord_ else None,
                    "position": a.position,
                    "allocatedAt": day(a.created_at),
                    "jobCardNo": cards.get(a.job_card_id, ""),
                    "qc": f"{qc.result}{f' ({qc.reason})' if qc.reason else ''}" if qc else "",
                    "challanNo": challans.get(line.challan_id, "") if line else "",
                    "inward": f"{line.inward_status}{f' ({line.reject_reason})' if line.reject_reason else ''}" if line else "",
                    "fittedAt": day(fit.fitted_at) if fit else "",
                    "vahan": fit.vahan_status if fit else "",
                    "allocation": a.status,
                    "closeReason": a.close_reason or "",
                }
            )
        return out

    reporting.register(
        ReportDefinition(
            "laser-code-audit",
            "Laser code audit",
            "Every laser code issued to an order: job card, QC, challan, dealer inward, fitment and VAHAN, and why an allocation was closed.",
            [*DATES, {"name": "laserCode", "label": "Laser code", "type": "text"}, {"name": "orderNo", "label": "Order or registration", "type": "text"}],
            [
                {"key": "laserCode", "label": "Laser code"},
                {"key": "product", "label": "Product"},
                {"key": "box", "label": "Box"},
                {"key": "plateStatus", "label": "Plate now"},
                {"key": "orderNo", "label": "Order no"},
                {"key": "regnNo", "label": "Registration"},
                {"key": "position", "label": "Position"},
                {"key": "allocatedAt", "label": "Issued (IST)"},
                {"key": "jobCardNo", "label": "Job card"},
                {"key": "ocr", "label": "Photo OCR"},
                {"key": "qc", "label": "QC"},
                {"key": "challanNo", "label": "Challan"},
                {"key": "inward", "label": "Dealer inward"},
                {"key": "fittedAt", "label": "Fitted (IST)"},
                {"key": "vahan", "label": "VAHAN"},
                {"key": "allocation", "label": "Allocation"},
                {"key": "closeReason", "label": "Closed because"},
            ],
            laser_code_audit,
        )
    )
