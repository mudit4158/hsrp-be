"""HSRP reports, registered with the generic Reporting utility. Each reads through the owning module's service."""

from datetime import datetime, timedelta
from typing import Any

from app.core.shared.subjects import IST
from app.platform.http.json import row
from app.utility.reporting.service import ReportDefinition, ReportingService

DATES = [{"name": "from", "label": "From", "type": "date"}, {"name": "to", "label": "To", "type": "date"}]


def rupees(p: int | None) -> str:
    return "" if p is None else f"{p / 100:.2f}"


def day(d: datetime | None) -> str:
    """'YYYY-MM-DD HH:MM' in IST."""
    return (d + IST).strftime("%Y-%m-%d %H:%M") if d else ""


def date_range(p: dict[str, str]) -> tuple[datetime | None, datetime | None] | None:
    """The from and to days of the report parameters as naive UTC bounds (whole days in IST)."""
    if not p.get("from") and not p.get("to"):
        return None
    start = datetime.fromisoformat(p["from"][:10]) - IST if p.get("from") else None
    end = datetime.fromisoformat(p["to"][:10]) + timedelta(hours=23, minutes=59, seconds=59) - IST if p.get("to") else None
    return start, end


def range_filter(p: dict[str, str]) -> dict[str, Any] | None:
    r = date_range(p)
    if r is None:
        return None
    return {k: v for k, v in (("gte", r[0]), ("lte", r[1])) if v is not None}


def register_reports(reporting: ReportingService, o: Any) -> None:
    def orders_register(p: dict[str, str]) -> list[dict[str, Any]]:
        filters: dict[str, Any] = dict(o.scope.where())
        if p.get("status"):
            filters["status"] = p["status"].split(",")
        if p.get("stateCode"):
            filters["state_code"] = p["stateCode"]
        if (r := range_filter(p)) is not None:
            filters["created_at"] = r
        rows = o.orders.raw_query(filters)
        dealers = {d.id: d.code for d in o.masters.dealers(list({x.dealer_id for x in rows if x.dealer_id}))}
        return [{**row(x), "createdAt": day(x.created_at), "dealer": dealers.get(x.dealer_id, ""), "amount": rupees(x.amount_paise)} for x in rows]

    reporting.register(
        ReportDefinition(
            "orders-register",
            "Orders register",
            "Every order with channel, status, dealer and amount.",
            [*DATES, {"name": "status", "label": "Status", "type": "text"}, {"name": "stateCode", "label": "State", "type": "select", "options": ["WB", "OD"]}],
            [
                {"key": "orderNo", "label": "Order no"},
                {"key": "createdAt", "label": "Received (IST)"},
                {"key": "channel", "label": "Channel"},
                {"key": "orderType", "label": "Type"},
                {"key": "status", "label": "Status"},
                {"key": "stateCode", "label": "State"},
                {"key": "dealer", "label": "Dealer"},
                {"key": "regnNo", "label": "Registration"},
                {"key": "vehicleClass", "label": "Class"},
                {"key": "amount", "label": "Amount (₹)"},
            ],
            orders_register,
        )
    )

    def fitments(p: dict[str, str]) -> list[dict[str, Any]]:
        sc = o.scope.current()
        r = date_range(p) or (None, None)
        rows = o.fitment.list(sc.dealer_id, r[0], r[1])
        orders = {x.id: x for x in o.orders.by_ids([x.order_id for x in rows])}
        dealers = {d.id: d.code for d in o.masters.dealers(list({x.dealer_id for x in rows}))}
        return [
            {
                **row(x),
                "fittedAt": day(x.fitted_at),
                "postedAt": day(x.posted_at),
                "orderNo": orders[x.order_id].order_no if x.order_id in orders else None,
                "regnNo": orders[x.order_id].regn_no if x.order_id in orders else None,
                "dealer": dealers.get(x.dealer_id),
            }
            for x in rows
        ]

    reporting.register(
        ReportDefinition(
            "fitments",
            "Fitments and VAHAN posts",
            "Fitments recorded by dealers and the state of their VAHAN post.",
            DATES,
            [
                {"key": "fittedAt", "label": "Fitted (IST)"},
                {"key": "orderNo", "label": "Order no"},
                {"key": "regnNo", "label": "Registration"},
                {"key": "dealer", "label": "Dealer"},
                {"key": "frontLaserCode", "label": "Front"},
                {"key": "rearLaserCode", "label": "Rear"},
                {"key": "vahanStatus", "label": "VAHAN"},
                {"key": "postedAt", "label": "Posted (IST)"},
                {"key": "vahanReply", "label": "VAHAN reply"},
            ],
            fitments,
        )
    )

    reporting.register(
        ReportDefinition(
            "challans",
            "Delivery challans",
            "Challans by dealer with plate count and inward state.",
            [{"name": "status", "label": "Status", "type": "select", "options": ["CREATED", "INWARDED", "CANCELLED"]}],
            [
                {"key": "challanNo", "label": "Challan no"},
                {"key": "createdAt", "label": "Created (IST)"},
                {"key": "dealerName", "label": "Dealer"},
                {"key": "plates", "label": "Plates"},
                {"key": "status", "label": "Status"},
                {"key": "inwardedAt", "label": "Inwarded (IST)"},
            ],
            lambda p: [{**c, "createdAt": day(c["createdAt"]), "inwardedAt": day(c["inwardedAt"])} for c in o.dispatch.list(p.get("status"))],
        )
    )

    reporting.register(
        ReportDefinition(
            "stock",
            "Plate stock by station",
            "Plates per station and product by status.",
            [],
            [
                {"key": "station", "label": "Station"},
                {"key": "productCode", "label": "Product"},
                {"key": "AVAILABLE", "label": "Available"},
                {"key": "ALLOCATED", "label": "Allocated"},
                {"key": "FITTED", "label": "Fitted"},
                {"key": "SCRAPPED", "label": "Scrapped"},
            ],
            lambda p: [{"station": st["stationCode"], **prod} for st in o.inventory.stock_by_station() for prod in st["products"]],
        )
    )

    reporting.register(
        ReportDefinition(
            "complaints",
            "Complaints and ageing",
            "Complaints against their 15-day limit.",
            [{"name": "status", "label": "Status", "type": "select", "options": ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]}],
            [
                {"key": "ticketNo", "label": "Ticket"},
                {"key": "categoryCode", "label": "Category"},
                {"key": "title", "label": "Title"},
                {"key": "createdAt", "label": "Raised (IST)"},
                {"key": "dueAt", "label": "Due (IST)"},
                {"key": "status", "label": "Status"},
                {"key": "ageDays", "label": "Age (days)"},
                {"key": "overdue", "label": "Overdue"},
            ],
            lambda p: [
                {**t, "createdAt": day(t["createdAt"]), "dueAt": day(t["dueAt"]), "overdue": "yes" if t["overdue"] else "no"}
                for t in o.tickets.list(p.get("status"), False, 1, 5000)["items"]
            ],
        )
    )

    reporting.register(
        ReportDefinition(
            "wallets",
            "Wallet balances",
            "Balance, held amount, credit limit and available funds per wallet.",
            [],
            [
                {"key": "name", "label": "Wallet"},
                {"key": "balance", "label": "Balance (₹)"},
                {"key": "held", "label": "Held (₹)"},
                {"key": "credit", "label": "Credit limit (₹)"},
                {"key": "available", "label": "Available (₹)"},
            ],
            lambda p: [
                {
                    "name": w["name"],
                    "balance": rupees(w["balancePaise"]),
                    "held": rupees(w["heldPaise"]),
                    "credit": rupees(w["creditLimitPaise"]),
                    "available": rupees(w["availablePaise"]),
                }
                for w in o.wallets.list()
            ],
        )
    )

    def rejections(p: dict[str, str]) -> list[dict[str, Any]]:
        rows = o.rejections.list({"status": p["status"]} if p.get("status") else {})
        orders = {x.id: x.order_no for x in o.orders.by_ids([r.order_id for r in rows])}
        return [{**row(r), "createdAt": day(r.created_at), "orderNo": orders.get(r.order_id), "positions": " + ".join(r.positions)} for r in rows]

    reporting.register(
        ReportDefinition(
            "rejections",
            "Plate rejections",
            "QC and dealer rejections with the station decision.",
            [{"name": "status", "label": "Status", "type": "select", "options": ["PENDING", "APPROVED", "DISAPPROVED"]}],
            [
                {"key": "createdAt", "label": "Raised (IST)"},
                {"key": "orderNo", "label": "Order no"},
                {"key": "source", "label": "Source"},
                {"key": "positions", "label": "Plates"},
                {"key": "reason", "label": "Reason"},
                {"key": "status", "label": "Decision"},
                {"key": "remarks", "label": "Remarks"},
            ],
            rejections,
        )
    )
