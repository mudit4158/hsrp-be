"""Read-side composition across core modules: dashboard, order detail and dealer home. Owns no tables."""

from __future__ import annotations

from collections import Counter
from datetime import datetime
from typing import Any

from app.core.shared.subjects import IST, SUBJECT, ist_date
from app.platform.http.json import row
from app.platform.http.problem import Problem


class OversightService:
    """Holds the services the reports read through (they are registered with the reporting utility)."""

    def __init__(self, c: Any):
        self.orders = c.orders
        self.inventory = c.inventory
        self.fitment = c.fitment
        self.dispatch = c.dispatch
        self.production = c.production
        self.rejections = c.rejections
        self.booking = c.booking
        self.masters = c.masters
        self.scope = c.scope
        self.approvals = c.approvals
        self.payments = c.payments
        self.tickets = c.tickets
        self.wallets = c.wallets
        self.files = c.files
        self.audit = c.audit
        self.bus = c.bus
        self.oem_data = c.oem_data
        self.imports = c.imports
        self.calls = c.call_log
        self.identity = c.identity
        self.billing = c.billing

    def dashboard(self) -> dict[str, Any]:
        sc = self.scope.current()
        where = {"station_id": sc.station_id} if sc.station_id else {"dealer_id": sc.dealer_id} if sc.dealer_id else {}
        today = datetime.fromisoformat(ist_date()) - IST
        by_status = self.orders.count_by_status(where)
        stock = self.inventory.stock_by_station()
        approvals = self.approvals.list(status="PENDING", page_size=500)
        return {
            "ordersByStatus": by_status,
            "ordersToday": len(self.orders.raw_query({**where, "created_at": {"gte": today}})),
            "ordersOpen": sum(v for k, v in by_status.items() if k not in ("COMPLETED", "REJECTED", "CANCELLED")),
            "ageing": self.orders.ageing(where),
            "fitments": self.fitment.counts(),
            "stock": [{"station": f"{x['stationCode']} · {x['stationName']}", **x["totals"]} for x in stock if not sc.station_id or x["stationId"] == sc.station_id],
            "complaints": {"open": self.tickets.list("OPEN,IN_PROGRESS", False, 1, 1)["total"], "overdue": self.tickets.list(None, True, 1, 1)["total"]},
            "approvalsPending": dict(Counter(a.type for a in approvals)),
            "integration": self.bus.stats(),
        }

    def order_detail(self, id: str) -> dict[str, Any]:
        order = self.orders.get_scoped(id)
        lines = self.dispatch.lines_for_order(id)
        fitment = self.fitment.for_order(id)
        rejections = self.rejections.for_order(id)
        rejection_approvals = [a for r in rejections for a in self.approvals.for_subject(SUBJECT.rejection, r.id)]
        challans = {c.id: c for c in self.dispatch.challans_by_ids(list({x.challan_id for x in lines}))}
        dealer = self.masters.dealer(order.dealer_id) if order.dealer_id else None
        station = self.masters.station(order.station_id) if order.station_id else None

        def link(fid: str | None) -> str | None:
            return self.files.signed_path(fid) if fid else None

        plate_checks = [
            *({**row(c), "stage": "EMBOSSING", "photoUrl": link(c.file_id)} for c in self.production.photo_checks(id)),
            *({**row(c), "stage": "FITMENT", "laserCode": None, "photoUrl": link(c.file_id)} for c in self.fitment.photo_checks([id])),
        ]
        plate_checks.sort(key=lambda x: x["createdAt"])
        return {
            "order": order,
            "dealer": dealer and {"id": dealer.id, "code": dealer.code, "name": dealer.name, "city": dealer.city},
            "station": station and {"id": station.id, "code": station.code, "name": station.name},
            "history": self.orders.history(id),
            "validations": self.orders.validations(id),
            "allocations": self.inventory.allocation_history(id),
            "challanLines": [
                {
                    **row(x),
                    "challanNo": challans[x.challan_id].challan_no if x.challan_id in challans else None,
                    "challanStatus": challans[x.challan_id].status if x.challan_id in challans else None,
                }
                for x in lines
            ],
            "fitment": fitment
            and {
                **row(fitment),
                "frontPhotoUrl": link(fitment.front_photo_id),
                "rearPhotoUrl": link(fitment.rear_photo_id),
                "chassisPhotoUrl": link(fitment.chassis_photo_id),
            },
            "qc": self.production.qc_records(id),
            # OCR of plate photos (D45): after embossing (station) and at fitment (dealer), refused attempts included.
            "plateChecks": plate_checks,
            "stickerPrints": self.production.sticker_prints(id),
            # Postpaid OEM orders (D46): the charge and the bill that took it.
            "billing": self.billing.for_order(id),
            "rejections": rejections,
            "approvals": [*self.approvals.for_subject(SUBJECT.order, id), *rejection_approvals],
            "payments": self.payments.for_subject(SUBJECT.order, id),
            "booking": self.booking.for_order(id),
            "files": [{"id": f.id, "filename": f.filename, "purpose": f.purpose, "mimeType": f.mime_type, "url": link(f.id)} for f in self.files.list_for(SUBJECT.order, id)],
            "audit": self.audit.for_subject(SUBJECT.order, id),
            "events": [{"id": e.id, "type": e.event_type, "at": e.occurred_at, "payload": e.payload} for e in self.bus.events_for(SUBJECT.order, id)],
        }

    def dealer_home(self) -> dict[str, Any]:
        dealer_id = self.scope.dealer_id()
        dealer = self.masters.dealer(dealer_id)
        by_status = self.orders.count_by_status({"dealer_id": dealer_id})
        return {
            "dealer": {"id": dealer.id, "code": dealer.code, "name": dealer.name, "city": dealer.city, "stateCode": dealer.state_code},
            "counts": {
                "toInward": len(self.dispatch.list("CREATED")),
                "toFit": by_status.get("INWARDED", 0),
                "awaitingVahan": by_status.get("FITTED", 0),
                "inProduction": sum(by_status.get(k, 0) for k in ("CONFIRMED", "ISSUED", "QC_PASSED", "STICKER_PRINTED", "DISPATCHED")),
                "rejectionReview": by_status.get("REJECTION_REVIEW", 0),
                "completed": by_status.get("COMPLETED", 0),
            },
            "ordersByStatus": by_status,
            "appointments": self.booking.appointments(dealer_id, ist_date()),
            "wallet": self.wallets.summary(dealer.wallet_account_id) if dealer.wallet_account_id else None,
        }

    def dealer_wallet(self) -> dict[str, Any]:
        dealer = self.masters.dealer(self.scope.dealer_id())
        if not dealer.wallet_account_id:
            raise Problem.not_found("Wallet")
        return {"summary": self.wallets.summary(dealer.wallet_account_id), "statement": self.wallets.statement(dealer.wallet_account_id, 1, 30)}
