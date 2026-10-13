"""Fictional seed data: `python -m app.seed.run`. On an empty database it seeds everything; on a seeded one it applies
the additive upgrades only (set SEED_RESET=true to wipe and reseed). SEED_PASSWORD (8+ characters) becomes the
password of every demo user. Fixture data lives in fixtures.json (exported from the NestJS seed, D48)."""

import base64
import json
import logging
import math
import os
import re
import secrets
import sys
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import func, insert, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.adapters.models import FileBlob, MockOemCatalogue, MockSetting, MockVahanVehicle
from app.core.booking.models import Booking
from app.core.dispatch.models import Challan, ChallanLine
from app.core.fitment.models import Fitment
from app.core.inventory.models import Plate, PlateAllocation, PlateBox
from app.core.masters.models import Company, Dealer, DealerOem, Oem, Product, State, Station, VehicleCategory
from app.core.order_intake.models import OemVehicle, Order, OrderStatusHistory, OrderValidation
from app.core.pricing.models import ExtraCharge, PriceRule
from app.core.production.models import JobCard, QcRecord, StickerPrint
from app.core.rejection.models import RejectionCase
from app.core.shared.subjects import IST
from app.platform.context import request_context
from app.platform.db.base import Base, new_id, utcnow
from app.platform.db.session import Database, get_db
from app.platform.models import Tenant
from app.seed.vehicles import NEW_POOLS, Rng, generate_vehicles
from app.utility.approvals.models import ApprovalRequest
from app.utility.audit.service import AuditService
from app.utility.configuration.models import ConfigSetting
from app.utility.configuration.service import SettingsService
from app.utility.documents.models import DocSequence, DocTemplate
from app.utility.file_storage.models import FileObject
from app.utility.identity.api_clients import hash_key
from app.utility.identity.models import IamApiClient, IamOrg, IamRole, IamUser
from app.utility.identity.passwords import hash_password
from app.utility.import_export.models import ImportProfile
from app.utility.integration_hub.models import OutboxDelivery, OutboxEvent
from app.utility.notification.models import NotifyTemplate
from app.utility.payments.models import Payment
from app.utility.scheduling.models import SchedBooking, SchedCalendarRule, SchedResource
from app.utility.tickets.models import Ticket, TicketCategory, TicketEvent
from app.utility.wallet.service import WalletService

log = logging.getLogger("seed")
F: dict[str, Any] = json.loads((Path(__file__).parent / "fixtures.json").read_text(encoding="utf-8"))
TENANT = F["TENANT"]["id"]
DAY = timedelta(days=1)
# A 1×1 grey PNG used as the photo of every seeded (historical) fitment.
PLACEHOLDER_PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")
r = Rng(7)


def _snake(name: str) -> str:
    return re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", name).lower()


def make(model: type[Base], data: dict[str, Any], **extra: Any) -> Any:
    """A model from a camelCase fixture dict (plus snake_case extras)."""
    return model(**{_snake(k): v for k, v in data.items()}, **extra)


def _round(x: float) -> int:
    return math.floor(x + 0.5)


def price_rupees(state: str, vehicle_class: str, order_type: str, plate_set: str) -> int:
    return _round(F["BASE_PRICE"][vehicle_class] * F["ORDER_TYPE_FACTOR"][order_type] * F["PLATE_SET_FACTOR"][plate_set] * F["STATE_FACTOR"][state])


def kranti_model(vch_catg: str) -> str:
    return F["KRANTI_MODELS"].get(vch_catg, "Kranti Cargo (fictional)")


def _ist(d: datetime) -> datetime:
    return d + IST


def truncate_all(db: Database) -> None:
    with db.tx() as s:
        tables = s.scalars(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('alembic_version', '_prisma_migrations')")).all()
        s.execute(text(f"TRUNCATE TABLE {', '.join(chr(34) + t + chr(34) for t in tables)} RESTART IDENTITY CASCADE"))


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="[seed] %(message)s")
    # app.platform.config (imported with the session module) has loaded the repo-root .env by now.
    password = os.environ.get("SEED_PASSWORD") or ""
    if len(password) < 8:
        log.error("SEED_PASSWORD must be set (8+ characters) in .env. It becomes the password of every demo user.")
        return 1
    db = get_db()
    with db.tx() as s:
        existing = s.get(Tenant, TENANT)
    if existing is not None and os.environ.get("SEED_RESET") != "true":
        log.info("Seed data already present; applying upgrades only (set SEED_RESET=true to wipe and reseed).")
        request_context.run_as_system(TENANT, lambda: upgrade(db))
        return 0
    if existing is not None:
        log.info("SEED_RESET=true: wiping all tables")
        truncate_all(db)
    started = time.time()
    request_context.run_as_system(TENANT, lambda: seed(db, password))
    log.info("Done in %.1f s", time.time() - started)
    return 0


def seed(db: Database, password: str) -> None:
    audit = AuditService(db)
    wallets = WalletService(db, audit)
    now = utcnow()
    with db.tx() as s:
        s.add(Tenant(id=TENANT, tenant_id=TENANT, name=F["TENANT"]["name"]))
        for role in F["ROLES"]:
            s.add(make(IamRole, role, tenant_id=TENANT))

        # ------------------------------------------------------------ organisations and masters
        co = F["COMPANY"]
        company_org = IamOrg(tenant_id=TENANT, code=f"CMP-{co['code']}", name=co["name"], org_type="COMPANY")
        company = make(Company, co, tenant_id=TENANT)
        s.add_all([company_org, company])
        for st in F["STATES"]:
            s.add(make(State, st, tenant_id=TENANT))
        s.flush()
        stations: dict[str, dict[str, Any]] = {}
        for st in F["STATIONS"]:
            org = IamOrg(tenant_id=TENANT, code=f"STN-{st['code']}", name=st["name"], org_type="STATION", parent_id=company_org.id)
            s.add(org)
            s.flush()
            row = Station(
                tenant_id=TENANT, code=st["code"], name=st["name"], company_id=company.id, state_code=st["stateCode"], city=st["city"], address=st.get("address"), org_id=org.id
            )
            s.add(row)
            s.flush()
            stations[st["code"]] = {"id": row.id, "org_id": org.id, "laser_prefix": st["laserPrefix"], "code": st["code"]}
        for p in F["PRODUCTS"]:
            s.add(make(Product, p, tenant_id=TENANT))
        for c in F["VEHICLE_CATEGORIES"]:
            s.add(make(VehicleCategory, c, tenant_id=TENANT))

        oems: dict[str, dict[str, str]] = {}
        for o in F["OEMS"]:
            org = IamOrg(tenant_id=TENANT, code=f"OEM-{o['code']}", name=o["name"], org_type="OEM")
            s.add(org)
            s.flush()
            w = wallets.open_wallet("hsrp.oem", o["code"], f"OEM {o['name']}", 50_000_000, s=s)
            row = Oem(
                tenant_id=TENANT,
                code=o["code"],
                name=o["name"],
                integration=o["integration"],
                requires_catalogue_check=o["requiresCatalogueCheck"],
                org_id=org.id,
                wallet_account_id=w.id,
                import_profile_code=o.get("importProfileCode"),
            )
            s.add(row)
            s.flush()
            oems[o["code"]] = {"id": row.id, "wallet_id": w.id, "org_id": org.id}

        wallet_ids: dict[str, str] = {}
        for group, cfg in F["WALLETS"].items():
            w = wallets.open_wallet("hsrp.wallet-group", group, f"Wallet {group}", cfg["credit"] * 100, s=s)
            wallets.top_up(w.id, cfg["topUp"] * 100, f"SEED-OPENING-{group}", s=s)
            wallet_ids[group] = w.id

        dealers: dict[str, dict[str, Any]] = {}
        for d in F["DEALERS"]:
            st = stations[d["station"]]
            org = IamOrg(tenant_id=TENANT, code=f"DLR-{d['code']}", name=d["name"], org_type="DEALER", parent_id=st["org_id"])
            s.add(org)
            s.flush()
            row = Dealer(
                tenant_id=TENANT,
                code=d["code"],
                name=d["name"],
                state_code=d["stateCode"],
                city=d["city"],
                address=f"{r.int(1, 99)} Demo Road, {d['city']}",
                mobile=f"90000{str(10000 + len(dealers))[-5:]}",
                email=f"{d['code'].lower()}@dealer.example.invalid",
                station_id=st["id"],
                org_id=org.id,
                wallet_group=d["walletGroup"],
                wallet_account_id=wallet_ids[d["walletGroup"]],
                accepts_customer_orders=True,
                status="ACTIVE",
            )
            s.add(row)
            s.flush()
            for oc in d["oems"]:
                s.add(DealerOem(tenant_id=TENANT, dealer_id=row.id, oem_id=oems[oc]["id"]))
            res = SchedResource(tenant_id=TENANT, code=f"fitment-{d['code']}", name=f"Fitment bay {d['name']}", subject_type="hsrp.dealer", subject_id=row.id)
            s.add(res)
            s.flush()
            s.add_all(
                SchedCalendarRule(tenant_id=TENANT, resource_id=res.id, weekday=wd, start_time="10:00", end_time="17:00", slot_minutes=60, capacity=4) for wd in range(1, 7)
            )
            dealers[d["code"]] = {
                "id": row.id,
                "code": d["code"],
                "state_code": d["stateCode"],
                "station_code": d["station"],
                "wallet_id": wallet_ids[d["walletGroup"]],
                "oems": d["oems"],
                "org_id": org.id,
                "resource_id": res.id,
            }
        log.info("Masters: %s states, %s stations, %s OEMs, %s dealers, %s dealer wallets", len(F["STATES"]), len(F["STATIONS"]), len(F["OEMS"]), len(F["DEALERS"]), len(F["WALLETS"]))

        # ------------------------------------------------------------ users and API clients
        pw_hash = hash_password(password)
        users = [
            ("admin", "Asha Admin (demo)", ["ADMIN"], company_org.id),
            ("ops", "Omkar Operations (demo)", ["OPERATIONS"], company_org.id),
            ("station.kol", "Kolkata Station User (demo)", ["STATION_USER"], stations["KOL1"]["org_id"]),
            ("station.bbs", "Bhubaneswar Station User (demo)", ["STATION_USER"], stations["BBS1"]["org_id"]),
            ("dealer.wb01", "Howrah Wheels Desk (demo)", ["DEALER"], dealers["WB01"]["org_id"]),
            ("dealer.od02", "Kalinga Motors Desk (demo)", ["DEALER"], dealers["OD02"]["org_id"]),
        ]
        for username, display, roles, org_id in users:
            s.add(IamUser(tenant_id=TENANT, username=username, display_name=display, roles=roles, org_id=org_id, password_hash=pw_hash, email=f"{username}@hsrp-demo.invalid"))
        zenmo_key = "hk_demo_" + base64.urlsafe_b64encode(secrets.token_bytes(12)).rstrip(b"=").decode()
        zenmo_secret = base64.urlsafe_b64encode(secrets.token_bytes(24)).rstrip(b"=").decode()
        s.add(
            IamApiClient(
                tenant_id=TENANT, org_id=oems["ZENMO"]["org_id"], name="Zenmo order system (demo)", roles=["OEM_CLIENT"], key_hash=hash_key(zenmo_key), secret=zenmo_secret
            )
        )
        log.info("Users: %s (password = SEED_PASSWORD from .env)", ", ".join(u[0] for u in users))

        # ------------------------------------------------------------ configuration, templates, sequences
        for st in F["SETTINGS"]:
            s.add(make(ConfigSetting, st, tenant_id=TENANT, effective_from=datetime(2024, 1, 1)))
        for q in F["SEQUENCES"]:
            s.add(make(DocSequence, q, tenant_id=TENANT))
        for t in F["NOTIFY_TEMPLATES"]:
            s.add(make(NotifyTemplate, t, tenant_id=TENANT))
        for t in F["DOC_TEMPLATES"]:
            s.add(DocTemplate(tenant_id=TENANT, code=t["code"], name=t["name"], layout=t["layout"]))
        for p in F["IMPORT_PROFILES"]:
            s.add(make(ImportProfile, p, tenant_id=TENANT))
        for c in F["TICKET_CATEGORIES"]:
            s.add(make(TicketCategory, c, tenant_id=TENANT))

        # ------------------------------------------------------------ prices
        effective_from = datetime(2024, 4, 1) - IST
        price_rows = [
            {
                "id": new_id(),
                "tenant_id": TENANT,
                "state_code": st["code"],
                "vehicle_class": cls,
                "order_type": ot,
                "plate_set": ps,
                "amount_paise": price_rupees(st["code"], cls, ot, ps) * 100,
                "published": st["code"] == "OD",
                "effective_from": effective_from,
                "created_at": now,
                "updated_at": now,
            }
            for st in F["STATES"]
            for cls in F["BASE_PRICE"]
            for ot in ("NEW", "OLD", "REPLACEMENT")
            for ps in ("BOTH", "FRONT", "REAR")
        ]
        price_rows.append({**price_rows[0], "id": new_id(), "state_code": "WB", "vehicle_class": "LMV", "oem_code": "ZENMO", "order_type": "NEW", "plate_set": "BOTH", "amount_paise": 74000, "published": False})
        s.execute(insert(PriceRule), [{"oem_code": None, "vehicle_type": None, **p} for p in price_rows])
        s.add_all(
            [
                ExtraCharge(tenant_id=TENANT, code="GREEN_STRIP", name="BS-VI green strip sticker", amount_paise=2500, conditions={"greenStrip": True}, effective_from=effective_from),
                ExtraCharge(tenant_id=TENANT, code="PORTAL_FEE", name="Online booking fee", amount_paise=2000, conditions={"channel": "CUSTOMER_PORTAL"}, effective_from=effective_from),
            ]
        )
        log.info("Prices: %s rules, 2 extra charges", len(price_rows))

        # ------------------------------------------------------------ plate inventory: 40 boxes × 50 plates
        box_plan = {"285X45": 4, "200X100": 6, "500X120": 6, "340X200": 4}
        product_codes = [p["code"] for p in F["PRODUCTS"]]
        stock: dict[str, list[dict[str, str]]] = {}
        box_count = 0
        for st in stations.values():
            box_seq = 0
            for product_code, boxes in box_plan.items():
                p_index = product_codes.index(product_code) + 1
                for _ in range(boxes):
                    box_seq += 1
                    box_count += 1
                    box_no = f"BX-{st['code']}-{box_seq:03d}"
                    box = PlateBox(tenant_id=TENANT, box_no=box_no, station_id=st["id"], product_code=product_code, plate_count=50, received_at=now - 40 * DAY)
                    s.add(box)
                    s.flush()
                    plates = [
                        {
                            "id": new_id(),
                            "tenant_id": TENANT,
                            "laser_code": f"{st['laser_prefix']}{p_index:02d}{box_seq:03d}{i + 1:05d}",
                            "box_id": box.id,
                            "station_id": st["id"],
                            "product_code": product_code,
                            "status": "AVAILABLE",
                            "created_at": now,
                            "updated_at": now,
                        }
                        for i in range(50)
                    ]
                    s.execute(insert(Plate), plates)
                    stock.setdefault(f"{st['code']}|{product_code}", []).extend({"id": p["id"], "laser_code": p["laser_code"], "box_no": box_no} for p in plates)
        log.info("Inventory: %s boxes, %s plates", box_count, box_count * 50)

        # ------------------------------------------------------------ mock VAHAN and OEM catalogue
        vehicles = generate_vehicles()
        s.execute(insert(MockVahanVehicle), [{"id": new_id(), "tenant_id": TENANT, "created_at": now, "updated_at": now, **v} for v in vehicles])
        zenmo = [v for v in vehicles if v["maker"].startswith("ZENMO")]
        s.execute(
            insert(MockOemCatalogue),
            [
                {
                    "id": new_id(),
                    "tenant_id": TENANT,
                    "oem_code": "ZENMO",
                    "chassis_no": v["chassis_no"],
                    "model": "Zenmo Zip 125 (fictional)" if v["vch_catg"] == "2WN" else "Zenmo Aura (fictional)",
                    "created_at": now,
                    "updated_at": now,
                }
                for v in zenmo
            ],
        )

        def sample(pool: str, state: str) -> list[str]:
            return [v["regn_no"] for v in vehicles if v["scenario"] == pool and v["state_cd"] == state]

        s.add(MockSetting(key="vahan.mode", tenant_id=TENANT, value="normal"))
        s.add(
            MockSetting(
                key="oem.demo",
                tenant_id=TENANT,
                value=[
                    {"oemCode": "ZENMO", "apiKey": zenmo_key, "secret": zenmo_secret, "dealerCodes": ["WB01", "WB02"], "sampleRegnNos": sample("oem-zenmo-sample", "WB")},
                    {"oemCode": "KRANTI", "csvProfileCode": "OEM_KRANTI_CSV", "dealerCodes": ["OD01", "OD02"], "sampleRegnNos": sample("oem-kranti-sample", "OD")},
                ],
            )
        )
        kranti_data = seed_kranti_vehicle_data(s, oems["KRANTI"]["id"], vehicles)
        log.info("Mock VAHAN: %s vehicles; Zenmo catalogue: %s chassis; Kranti vehicle data: %s chassis", len(vehicles), len(zenmo), kranti_data)

        # ------------------------------------------------------------ 200 orders across every status
        placeholder = FileObject(
            tenant_id=TENANT,
            filename="seed-placeholder.png",
            mime_type="image/png",
            size_bytes=len(PLACEHOLDER_PNG),
            sha256="seed",
            storage_key=f"{TENANT}/seed-placeholder",
            purpose="seed",
        )
        s.add(placeholder)
        s.add(FileBlob(key=f"{TENANT}/seed-placeholder", tenant_id=TENANT, data=PLACEHOLDER_PNG))
        s.flush()
        ctx = {"now": now, "dealers": dealers, "oems": oems, "stations": stations, "stock": stock, "vehicles": vehicles, "placeholder_id": placeholder.id}
        seed_orders(s, wallets, ctx)
        seed_tickets(s, now)
        audit.record("seed.run", "system", "seed", after={"vehicles": len(vehicles)}, s=s)


def seed_kranti_vehicle_data(s: Session, oem_id: str, vehicles: list[dict[str, Any]]) -> int:
    """Kranti's vehicle data for every new Kranti vehicle in mock VAHAN (no dealer: the dealer check is skipped for these)."""
    now = utcnow()
    rows = [
        {
            "id": new_id(),
            "tenant_id": TENANT,
            "oem_id": oem_id,
            "chassis_no": v["chassis_no"],
            "engine_no": v["engine_no"],
            "model": kranti_model(v["vch_catg"]),
            "vahan_category": v["vch_catg"],
            "source": "SEED",
            "created_at": now,
            "updated_at": now,
        }
        for v in vehicles
        if v["maker"].startswith("KRANTI") and v["scenario"] in NEW_POOLS
    ]
    if not rows:
        return 0
    count = select(func.count()).select_from(OemVehicle).where(OemVehicle.oem_id == oem_id)
    before = s.scalar(count) or 0
    s.execute(pg_insert(OemVehicle).on_conflict_do_nothing(), rows)
    return (s.scalar(count) or 0) - before


def upgrade(db: Database) -> None:
    """Additive changes for a database seeded by an earlier version. Each block checks its own marker, so a restart
    applies it once; existing data is never removed."""
    settings = SettingsService(db, AuditService(db))
    profiles = {p["code"]: p for p in F["IMPORT_PROFILES"]}
    with db.tx() as s:
        # D42: OEM vehicle data file and the oem-vehicle-data validation step for Kranti.
        profile = profiles["OEM_KRANTI_VEHICLES"]
        if s.scalar(select(ImportProfile.id).where(ImportProfile.tenant_id == TENANT, ImportProfile.code == profile["code"])) is None:
            s.add(make(ImportProfile, profile, tenant_id=TENANT))
            settings.set("order.validationSteps", "oem", "KRANTI", F["KRANTI_STEPS"], s=s)
            kranti = s.scalars(select(Oem).where(Oem.tenant_id == TENANT, Oem.code == "KRANTI")).one()
            vehicles = [
                {"maker": v.maker, "scenario": v.scenario, "chassis_no": v.chassis_no, "engine_no": v.engine_no, "vch_catg": v.vch_catg}
                for v in s.scalars(select(MockVahanVehicle).where(MockVahanVehicle.tenant_id == TENANT))
            ]
            n = seed_kranti_vehicle_data(s, kranti.id, vehicles)
            log.info("Upgrade D42: import profile %s, Kranti validation steps, %s Kranti vehicle data rows", profile["code"], n)
        # D47: standard OEM bulk-upload profiles. System-owned, so they are kept equal to the fixture on every start.
        for p in F["STANDARD_OEM_PROFILES"]:
            existing = s.scalar(select(ImportProfile).where(ImportProfile.tenant_id == TENANT, ImportProfile.code == p["code"]))
            if existing is None:
                s.add(make(ImportProfile, p, tenant_id=TENANT))
            elif existing.mapping != p["mapping"]:
                existing.name, existing.source_name, existing.mapping = p["name"], p["sourceName"], p["mapping"]
                log.info("Upgrade D47: import profile %s refreshed", p["code"])
        # D46: postpaid billing settings, the bill sequence, e-mail template, PDF layout and permissions.
        bill_tpl = F["BILL_TEMPLATE"]
        if s.scalar(select(DocTemplate.id).where(DocTemplate.tenant_id == TENANT, DocTemplate.code == bill_tpl["code"])) is None:
            for st in F["BILLING_SETTINGS"]:
                settings.set(st["key"], st["scopeType"], st["scopeId"], st["value"], s=s)
            if s.scalar(select(DocSequence.id).where(DocSequence.tenant_id == TENANT, DocSequence.name == "bill")) is None:
                s.add(DocSequence(tenant_id=TENANT, name="bill", prefix="BL{YY}{MM}-", padding=5))
            s.add(make(NotifyTemplate, F["BILL_EMAIL"], tenant_id=TENANT))
            s.add(DocTemplate(tenant_id=TENANT, code=bill_tpl["code"], name=bill_tpl["name"], layout=bill_tpl["layout"]))
            ops = s.scalar(select(IamRole).where(IamRole.tenant_id == TENANT, IamRole.code == "OPERATIONS"))
            if ops is not None:
                ops.permissions = list(dict.fromkeys([*(ops.permissions or []), "billing.read", "billing.manage"]))
            log.info("Upgrade D46: billing settings (Zenmo postpaid monthly, Kranti prepaid), bill sequence, template, layout, permissions")


# =====================================================================================================

MAIN = ["RECEIVED", "VALIDATED", "CONFIRMED", "ISSUED", "QC_PASSED", "STICKER_PRINTED", "DISPATCHED", "INWARDED", "FITTED", "COMPLETED"]
PLAN = [
    ("RECEIVED", 4),
    ("VALIDATED", 3),
    ("AWAITING_APPROVAL", 4),
    ("AWAITING_PAYMENT", 5),
    ("CONFIRMED", 22),
    ("ISSUED", 12),
    ("QC_PASSED", 6),
    ("STICKER_PRINTED", 10),
    ("DISPATCHED", 15),
    ("INWARDED", 15),
    ("FITTED", 8),
    ("COMPLETED", 72),
    ("REJECTION_REVIEW", 6),
    ("REJECTED", 10),
    ("CANCELLED", 8),
]
AGE = {
    "RECEIVED": (0, 0),
    "VALIDATED": (0, 1),
    "AWAITING_APPROVAL": (0, 2),
    "AWAITING_PAYMENT": (0, 2),
    "CONFIRMED": (1, 4),
    "ISSUED": (2, 5),
    "QC_PASSED": (2, 5),
    "STICKER_PRINTED": (3, 6),
    "DISPATCHED": (3, 7),
    "INWARDED": (4, 9),
    "FITTED": (2, 4),
    "COMPLETED": (8, 30),
    "REJECTION_REVIEW": (2, 6),
    "REJECTED": (1, 20),
    "CANCELLED": (1, 15),
}


def seed_orders(s: Session, wallets: WalletService, c: dict[str, Any]) -> None:
    now: datetime = c["now"]
    category = {x["vahanCategory"]: x for x in F["VEHICLE_CATEGORIES"]}
    used: set[str] = set()

    def take(pool: str, state: str, pred=lambda v: True) -> dict[str, Any]:
        v = next((x for x in c["vehicles"] if x["scenario"] == pool and x["state_cd"] == state and x["regn_no"] not in used and pred(x)), None) or next(
            (x for x in c["vehicles"] if x["scenario"] == pool and x["regn_no"] not in used and pred(x)), None
        )
        if v is None:
            raise RuntimeError(f"Seed ran out of {pool} vehicles")
        used.add(v["regn_no"])
        return v

    stock_ptr: dict[str, int] = {}

    def next_plate(station_code: str, product_code: str) -> dict[str, str]:
        key = f"{station_code}|{product_code}"
        stock_ptr[key] = stock_ptr.get(key, -1) + 1
        plates = c["stock"][key]
        if stock_ptr[key] >= len(plates):
            raise RuntimeError(f"Seed ran out of {product_code} plates at {station_code}")
        return plates[stock_ptr[key]]

    seq_no: dict[str, int] = {}

    def next_no(name: str, prefix: str, pad: int) -> str:
        seq_no[name] = seq_no.get(name, 0) + 1
        return f"{prefix}{seq_no[name]:0{pad}d}"

    job_cards: dict[str, dict[str, Any]] = {}
    challans: dict[str, dict[str, Any]] = {}
    approvers = {"ops": "seed-ops", "station": "seed-station"}
    mobile_seq = 0
    orders_made = 0

    for target, count in PLAN:
        for i in range(count):
            state = "WB" if r.next() < 0.55 else "OD"
            channel, order_type = "DEALER_APP", "NEW"
            rejection_reason: str | None = None
            reject_source: str | None = None
            dealer_code: str | None = None

            def pick_dealer(st: str, pred=lambda d: True) -> str:
                return r.pick([d for d in c["dealers"].values() if d["state_code"] == st and pred(d)])["code"]

            if target == "AWAITING_PAYMENT":
                channel, order_type = "CUSTOMER_PORTAL", "OLD"
                vehicle = take("seed-old", state)
                path = ["RECEIVED", "VALIDATED", "AWAITING_PAYMENT"]
            elif target == "AWAITING_APPROVAL":
                channel = "CUSTOMER_PORTAL" if i % 2 else "DEALER_APP"
                order_type = "REPLACEMENT"
                vehicle = take("seed-repl", state)
                path = ["RECEIVED", "VALIDATED", "AWAITING_APPROVAL"]
            elif target == "VALIDATED":
                vehicle = take("seed-new", "OD", lambda v: category.get(v["vch_catg"], {}).get("vehicleClass") == "LMV")
                dealer_code = "OD03"
                path = ["RECEIVED", "VALIDATED"]
            elif target == "REJECTED":
                if i < 6:
                    vehicle = take("seed-new", state)
                    rejection_reason = r.pick(
                        [
                            "VAHAN: Vehicle details not found",
                            "VAHAN: Chassis number or engine number does not match",
                            "Registered before the new-vehicle cut-off 2019-04-01; this is an old-vehicle order",
                            "Vehicle is registered in another state",
                        ]
                    )
                    path = ["RECEIVED", "REJECTED"]
                else:
                    order_type, channel = "REPLACEMENT", "CUSTOMER_PORTAL"
                    vehicle = take("seed-repl", state)
                    rejection_reason = "Replacement rejected: police report is not legible, please re-apply"
                    path = ["RECEIVED", "VALIDATED", "AWAITING_APPROVAL", "REJECTED"]
            elif target == "CANCELLED":
                if i < 4:
                    channel, order_type = "CUSTOMER_PORTAL", "OLD"
                    vehicle = take("seed-old", state)
                    path = ["RECEIVED", "VALIDATED", "AWAITING_PAYMENT", "CANCELLED"]
                else:
                    vehicle = take("seed-new", state)
                    path = ["RECEIVED", "VALIDATED", "CONFIRMED", "CANCELLED"]
            elif target == "REJECTION_REVIEW":
                reject_source = "QC" if i < 3 else "DEALER_INWARD"
                vehicle = take("seed-new", state)
                upto = "ISSUED" if reject_source == "QC" else "DISPATCHED"
                path = [*MAIN[: MAIN.index(upto) + 1], "REJECTION_REVIEW"]
            else:
                # main path: CONFIRMED .. COMPLETED, plus RECEIVED
                roll = r.next()
                if target not in ("RECEIVED", "QC_PASSED") and roll < 0.05:
                    order_type = "REPLACEMENT"
                    channel = "CUSTOMER_PORTAL" if r.next() < 0.5 else "DEALER_APP"
                    vehicle = take("seed-repl", state)
                elif target != "RECEIVED" and roll < 0.24:
                    order_type, channel = "OLD", "CUSTOMER_PORTAL"
                    vehicle = take("seed-old", state, lambda v: target != "QC_PASSED" or category.get(v["vch_catg"], {}).get("stickerRequired"))  # noqa: B023 (called at once, in this iteration)
                else:
                    channel = r.weighted([("DEALER_APP", 50), ("OEM_API", 20), ("OEM_FILE", 20), ("STAFF_WEB", 10)])

                    def maker_pred(v: dict[str, Any], channel: str = channel) -> bool:
                        maker_ok = v["maker"].startswith("ZENMO") if channel == "OEM_API" else v["maker"].startswith("KRANTI") if channel == "OEM_FILE" else True
                        return maker_ok and (target != "QC_PASSED" or bool(category.get(v["vch_catg"], {}).get("stickerRequired"))) and v["vch_catg"] in category  # noqa: B023 (called at once, in this iteration)

                    vehicle = take("seed-new", state, maker_pred)
                base = MAIN[: MAIN.index(target) + 1]
                if order_type == "REPLACEMENT":
                    path = ["RECEIVED", "VALIDATED", "AWAITING_APPROVAL", *(["AWAITING_PAYMENT"] if channel == "CUSTOMER_PORTAL" else []), *base[2:]]
                elif order_type == "OLD":
                    path = ["RECEIVED", "VALIDATED", "AWAITING_PAYMENT", *base[2:]]
                else:
                    path = base
                if target == "RECEIVED":
                    path = ["RECEIVED"]
            if vehicle["vch_catg"] not in category:
                vehicle = take("seed-new", state)
            v = vehicle
            st = v["state_cd"]
            oem_code = "ZENMO" if channel == "OEM_API" else "KRANTI" if channel == "OEM_FILE" else None
            if dealer_code is None:
                dealer_code = (
                    pick_dealer(st, lambda d: oem_code in d["oems"] and d["code"] != "OD03") if oem_code else pick_dealer(st, lambda d: d["code"] != "OD03")  # noqa: B023 (called at once, in this iteration)
                )
            dealer = c["dealers"][dealer_code]
            station = c["stations"][dealer["station_code"]]
            cat = category[v["vch_catg"]]
            green_strip = "VI" in v["norms"]
            plate_set = r.pick(["BOTH", "FRONT", "REAR"]) if order_type == "REPLACEMENT" else "BOTH"
            positions = ["FRONT", "REAR"] if plate_set == "BOTH" else [plate_set]
            base_paise = price_rupees(st, cat["vehicleClass"], order_type, plate_set) * 100
            is_customer = channel == "CUSTOMER_PORTAL"
            extras = [
                *([{"code": "GREEN_STRIP", "name": "BS-VI green strip sticker", "amountPaise": 2500}] if green_strip else []),
                *([{"code": "PORTAL_FEE", "name": "Online booking fee", "amountPaise": 2000}] if is_customer else []),
            ]
            amount_paise = base_paise + sum(x["amountPaise"] for x in extras)
            mobile = None
            if is_customer or st == "OD" or r.next() < 0.6:
                mobile_seq += 1
                mobile = f"90000{str(10000 + mobile_seq)[-5:]}"

            # ---------------------------------------------- timeline
            min_age, max_age = AGE[target]
            created_at = now - timedelta(days=min_age + r.next() * (max_age - min_age)) - timedelta(hours=r.int(1, 8))
            span = max(3600.0, (now - created_at).total_seconds() - 1800)
            times = [created_at + timedelta(seconds=round(span * k / max(1, len(path) - 1)) if k else 0) for k in range(len(path))]

            def at(status: str, path: list[str] = path, times: list[datetime] = times, created_at: datetime = created_at) -> datetime:
                return times[len(path) - 1 - path[::-1].index(status)] if status in path else created_at

            def reached(status: str, path: list[str] = path) -> bool:
                return status in path

            final_status = path[-1]
            orders_made += 1
            ist_created = _ist(created_at)
            order_no = f"HS{st}{str(ist_created.year)[-2:]}{ist_created.month:02d}{str(90000 + orders_made)[-5:]}"
            vahan_reply = {
                "message": "Success",
                "fuel": v["fuel"],
                "maker": v["maker"],
                "vchType": v["vch_type"],
                "norms": v["norms"],
                "vchCatg": v["vch_catg"],
                "regnDate": v["regn_date"],
                "hsrpFrontLaserCode": v["hsrp_front_laser_code"] or "",
                "hsrpRearLaserCode": v["hsrp_rear_laser_code"] or "",
                "stateCd": v["state_cd"],
                "offCd": v["off_cd"],
            }
            quote = {"ruleId": "seed", "basePaise": base_paise, "extras": extras, "totalPaise": amount_paise}
            validated, confirmed, issued = reached("VALIDATED"), reached("CONFIRMED"), reached("ISSUED")

            order = Order(
                tenant_id=TENANT,
                order_no=order_no,
                channel=channel,
                order_type=order_type,
                plate_set=plate_set,
                status=final_status,
                state_code=st,
                regn_no=v["regn_no"],
                chassis_no=v["chassis_no"][-5:] if is_customer else v["chassis_no"],
                engine_no=v["engine_no"][-5:] if is_customer else v["engine_no"],
                replacement_reason=r.pick(["DAMAGED", "THEFT"]) if order_type == "REPLACEMENT" else None,
                evidence_file_id=c["placeholder_id"] if order_type == "REPLACEMENT" else None,
                oem_id=c["oems"][oem_code]["id"] if oem_code else None,
                dealer_id=dealer["id"],
                station_id=station["id"],
                source_ref=f"{oem_code}-{'PO' if channel == 'OEM_API' else 'INV'}-{700000 + orders_made}" if oem_code else None,
                pending_positions=[] if issued and final_status != "CANCELLED" else positions,
                owner_name=f"Demo Owner {orders_made:03d}",
                mobile=mobile,
                email=f"owner{orders_made}@example.invalid" if is_customer else None,
                price_snapshot=quote if confirmed else None,
                vahan_snapshot=vahan_reply if confirmed else None,
                rejection_reason=rejection_reason if final_status == "REJECTED" else None,
                cancel_reason=r.pick(["Customer changed mind", "Duplicate order placed by mistake", "Vehicle sold before fitment"]) if final_status == "CANCELLED" else None,
                remarks="Waiting for wallet funds: wallet balance is not enough" if target == "VALIDATED" else None,
                confirmed_at=at("CONFIRMED") if confirmed else None,
                completed_at=at("COMPLETED") if reached("COMPLETED") else None,
                created_by="seed",
                created_at=created_at,
                updated_at=times[-1],
            )
            if validated:
                order.vehicle_class, order.vehicle_type, order.vahan_category = cat["vehicleClass"], cat["vehicleType"], cat["vahanCategory"]
                order.fuel, order.maker, order.norms, order.regn_date = v["fuel"], v["maker"], v["norms"], v["regn_date"]
                order.green_strip, order.sticker_required = green_strip, cat["stickerRequired"]
                order.front_product_code, order.rear_product_code, order.amount_paise = cat["frontProductCode"], cat["rearProductCode"], amount_paise
            s.add(order)
            s.flush()

            # ---------------------------------------------- history and validations
            s.add_all(
                OrderStatusHistory(
                    tenant_id=TENANT,
                    order_id=order.id,
                    from_status=path[k - 1] if k else None,
                    to_status=status,
                    trigger=f"seed:{status.lower()}" if k else f"received:{channel}",
                    actor_id="seed",
                    created_at=times[k],
                    note=rejection_reason if status == "REJECTED" else None,
                )
                for k, status in enumerate(path)
            )
            if validated:
                s.add_all(
                    [
                        OrderValidation(tenant_id=TENANT, order_id=order.id, step="vahan-check", outcome="PASS", message=f"{v['maker']} · {v['vch_catg']} · {v['norms']}", data=vahan_reply, created_at=at("VALIDATED")),
                        OrderValidation(tenant_id=TENANT, order_id=order.id, step="state-eligibility-rules", outcome="PASS", message="Eligible", created_at=at("VALIDATED")),
                        OrderValidation(tenant_id=TENANT, order_id=order.id, step="pricing", outcome="PASS", message=f"₹{amount_paise / 100:.2f}", data=quote, created_at=at("VALIDATED")),
                    ]
                )
            elif final_status == "REJECTED":
                s.add(OrderValidation(tenant_id=TENANT, order_id=order.id, step="vahan-check", outcome="FAIL", message=rejection_reason, created_at=times[1]))

            # ---------------------------------------------- money: wallet or payment
            if not is_customer and (confirmed or reached("AWAITING_APPROVAL")):
                wallet_id = c["oems"][oem_code]["wallet_id"] if oem_code else dealer["wallet_id"]
                hold = wallets.hold(wallet_id, amount_paise, "hsrp.order", order.id, s=s)
                if confirmed:
                    wallets.capture(hold.id, s=s)
                if final_status == "CANCELLED":
                    wallets.refund_captured(hold.id, s=s)
                if final_status == "REJECTED":
                    wallets.release(hold.id, s=s)
                order.wallet_hold_id = hold.id
            if is_customer and (reached("AWAITING_PAYMENT") or confirmed):
                paid = confirmed
                p = Payment(
                    tenant_id=TENANT,
                    txn_id=f"TXNSEED{orders_made:05d}",
                    provider="payu",
                    amount_paise=amount_paise,
                    product_info=f"HSRP {order_no}",
                    payer={"name": f"Demo Owner {orders_made}", "mobile": mobile},
                    subject_type="hsrp.order",
                    subject_id=order.id,
                    status="SUCCESS" if paid else "CANCELLED" if final_status == "CANCELLED" else "CREATED",
                    return_url="http://localhost:8080/portal/payment-return",
                    provider_ref=str(r.int(100000000, 999999999)) if paid else None,
                    succeeded_at=at("CONFIRMED") if paid else None,
                    created_at=at("AWAITING_PAYMENT"),
                )
                s.add(p)
                s.flush()
                order.payment_id = p.id
                slot_date = (created_at + 3 * DAY).strftime("%Y-%m-%d")
                slot_start = r.pick(["10:00", "11:00", "12:00", "14:00", "15:00", "16:00"])
                booked = "CANCELLED" if final_status == "CANCELLED" else "BOOKED"
                sb = SchedBooking(tenant_id=TENANT, resource_id=dealer["resource_id"], date=slot_date, slot_start=slot_start, subject_type="hsrp.order", subject_id=order.id, status=booked)
                s.add(sb)
                s.flush()
                s.add(Booking(tenant_id=TENANT, order_id=order.id, dealer_id=dealer["id"], sched_booking_id=sb.id, slot_date=slot_date, slot_start=slot_start, status=booked))

            # ---------------------------------------------- approvals
            if reached("AWAITING_APPROVAL"):
                decided = final_status != "AWAITING_APPROVAL"
                appr = ApprovalRequest(
                    tenant_id=TENANT,
                    type="replacement-order",
                    subject_type="hsrp.order",
                    subject_id=order.id,
                    required_role="OPERATIONS",
                    title=f"Replacement {order_no} · {v['regn_no']} · {order.replacement_reason}",
                    details={"orderNo": order_no, "regnNo": v["regn_no"], "reason": order.replacement_reason, "evidenceFileId": c["placeholder_id"], "plateSet": plate_set},
                    status="PENDING" if not decided else "REJECTED" if final_status == "REJECTED" else "APPROVED",
                    requested_by="seed",
                    decided_by=approvers["ops"] if decided else None,
                    remarks=(rejection_reason if final_status == "REJECTED" else "Evidence checked, replacement approved") if decided else None,
                    decided_at=times[path.index("AWAITING_APPROVAL") + 1] if decided else None,
                    created_at=at("AWAITING_APPROVAL"),
                )
                s.add(appr)
                s.flush()
                order.approval_id = appr.id

            # ---------------------------------------------- production: allocation, job card, QC, sticker
            allocations: list[dict[str, str]] = []
            if issued:
                issue_at = at("ISSUED")
                jc_key = f"{dealer['id']}|{issue_at.strftime('%Y-%m-%d')}"
                jc = job_cards.get(jc_key)
                if jc is None:
                    ist_issue = _ist(issue_at)
                    jc = {
                        "id": str(uuid.uuid4()),
                        "no": next_no("jc", f"JC{str(ist_issue.year)[-2:]}{ist_issue.month:02d}-", 5),
                        "station_id": station["id"],
                        "dealer_id": dealer["id"],
                        "order_ids": [],
                        "box_nos": [],
                        "plates": 0,
                        "at": issue_at,
                    }
                    job_cards[jc_key] = jc
                jc["order_ids"].append(order.id)
                fitted = reached("FITTED")
                for pos in positions:
                    product = cat["frontProductCode"] if pos == "FRONT" else cat["rearProductCode"]
                    plate = next_plate(station["code"], product)
                    if plate["box_no"] not in jc["box_nos"]:
                        jc["box_nos"].append(plate["box_no"])
                    jc["plates"] += 1
                    a = PlateAllocation(tenant_id=TENANT, plate_id=plate["id"], laser_code=plate["laser_code"], order_id=order.id, position=pos, job_card_id=jc["id"], created_at=issue_at)
                    s.add(a)
                    s.flush()
                    s.execute(update(Plate).where(Plate.id == plate["id"]).values(status="FITTED" if fitted else "ALLOCATED"))
                    allocations.append({"id": a.id, "position": pos, "laser_code": plate["laser_code"]})
                if reached("QC_PASSED"):
                    s.add(QcRecord(tenant_id=TENANT, order_id=order.id, result="PASS", positions=[], actor_id=approvers["station"], created_at=at("QC_PASSED")))
                if reached("STICKER_PRINTED") and cat["stickerRequired"]:
                    s.add(StickerPrint(tenant_id=TENANT, order_id=order.id, print_no=1, reprint=False, actor_id=approvers["station"], created_at=at("STICKER_PRINTED")))

            # ---------------------------------------------- dispatch and inward
            if reached("DISPATCHED"):
                disp_at = at("DISPATCHED")
                inwarded = reached("INWARDED") or reject_source == "DEALER_INWARD"
                key = f"{dealer['id']}|{disp_at.strftime('%Y-%m-%d')}|{inwarded}"
                ch = challans.get(key)
                if ch is None:
                    ist_disp = _ist(disp_at)
                    ch = {
                        "id": str(uuid.uuid4()),
                        "no": next_no("dc", f"DC{str(ist_disp.year)[-2:]}{ist_disp.month:02d}-", 5),
                        "station_id": station["id"],
                        "dealer_id": dealer["id"],
                        "at": disp_at,
                        "inwarded_at": at("INWARDED" if reached("INWARDED") else "REJECTION_REVIEW") if inwarded else None,
                        "lines": [],
                    }
                    challans[key] = ch
                for a in allocations:
                    rejected = reject_source == "DEALER_INWARD" and a["position"] == "REAR"
                    ch["lines"].append(
                        {
                            "order_id": order.id,
                            "allocation_id": a["id"],
                            "laser_code": a["laser_code"],
                            "position": a["position"],
                            "inward_status": "PENDING" if not inwarded else "REJECTED" if rejected else "ACCEPTED",
                            "reject_reason": "Plate edge chipped in transit" if rejected else None,
                        }
                    )

            # ---------------------------------------------- rejection review
            if reject_source:
                rejected_positions = [positions[0]] if reject_source == "QC" else ["REAR"] if "REAR" in positions else [positions[0]]
                reason = "Embossing uneven on hologram area" if reject_source == "QC" else "REAR: Plate edge chipped in transit"
                if reject_source == "QC":
                    s.add(QcRecord(tenant_id=TENANT, order_id=order.id, result="REJECT", positions=rejected_positions, reason=reason, actor_id=approvers["station"], created_at=at("REJECTION_REVIEW")))
                rc = RejectionCase(
                    tenant_id=TENANT,
                    order_id=order.id,
                    station_id=station["id"],
                    source=reject_source,
                    positions=rejected_positions,
                    reason=reason,
                    return_status="QC_PASSED" if reject_source == "QC" else "INWARDED",
                    created_at=at("REJECTION_REVIEW"),
                )
                s.add(rc)
                s.flush()
                appr = ApprovalRequest(
                    tenant_id=TENANT,
                    type="plate-rejection",
                    subject_type="hsrp.rejection",
                    subject_id=rc.id,
                    required_role="STATION_USER",
                    scope_org_id=station["org_id"],
                    title=f"{'QC' if reject_source == 'QC' else 'Dealer'} rejection · {order_no} · {' + '.join(rejected_positions)}",
                    details={
                        "orderId": order.id,
                        "orderNo": order_no,
                        "regnNo": v["regn_no"],
                        "source": reject_source,
                        "positions": rejected_positions,
                        "reason": reason,
                        "laserCodes": [f"{a['position']}: {a['laser_code']}" for a in allocations if a["position"] in rejected_positions],
                    },
                    requested_by="seed",
                    created_at=at("REJECTION_REVIEW"),
                )
                s.add(appr)
                s.flush()
                rc.approval_id = appr.id

            # ---------------------------------------------- fitment and VAHAN
            if reached("FITTED"):
                fitted_at = at("FITTED")
                completed = reached("COMPLETED")
                front = next((a["laser_code"] for a in allocations if a["position"] == "FRONT"), None)
                rear = next((a["laser_code"] for a in allocations if a["position"] == "REAR"), None)
                garbled = not completed and r.next() < 0.5
                f = Fitment(
                    tenant_id=TENANT,
                    order_id=order.id,
                    dealer_id=dealer["id"],
                    front_laser_code=front,
                    rear_laser_code=rear,
                    front_photo_id=c["placeholder_id"] if front else None,
                    rear_photo_id=c["placeholder_id"] if rear else None,
                    fitted_at=fitted_at,
                    recorded_by="seed",
                    vahan_status="POSTED" if completed else "MANUAL",
                    posted_at=at("COMPLETED") if completed else None,
                    vahan_reply=f"HSRP details updated successfully for {v['regn_no']}"
                    if completed
                    else "ERR#5503 <html>Gateway Timeout</html>"
                    if garbled
                    else "VAHAN not reachable (timeout after 30 s)",
                    created_at=fitted_at,
                )
                s.add(f)
                s.flush()
                if completed:
                    s.execute(
                        update(MockVahanVehicle)
                        .where(MockVahanVehicle.regn_no == v["regn_no"])
                        .values(hsrp_front_laser_code=front or v["hsrp_front_laser_code"], hsrp_rear_laser_code=rear or v["hsrp_rear_laser_code"])
                    )
                else:
                    # Historical post that exhausted its retries: it sits in the manual queue; "Replay" posts it.
                    ev = OutboxEvent(
                        tenant_id=TENANT,
                        event_type="FitmentRecorded",
                        subject_type="hsrp.order",
                        subject_id=order.id,
                        payload={"orderId": order.id, "orderNo": order_no, "fitmentId": f.id},
                        occurred_at=fitted_at,
                        dispatched_at=fitted_at,
                    )
                    s.add(ev)
                    s.flush()
                    s.add(
                        OutboxDelivery(
                            tenant_id=TENANT,
                            event_id=ev.id,
                            event_type="FitmentRecorded",
                            subscriber="fitment.vahan-post",
                            status="DEAD",
                            attempts=10,
                            max_attempts=10,
                            last_error="Unrecognised VAHAN reply: ERR#5503 <html>Gateway Timeout</html>" if garbled else "VAHAN not reachable (timeout after 30 s)",
                            next_attempt_at=fitted_at,
                        )
                    )

            # RECEIVED orders: their validation is in the retry queue (VAHAN timed out); replay or wait to process them.
            if final_status == "RECEIVED":
                ev = OutboxEvent(
                    tenant_id=TENANT,
                    event_type="OrderReceived",
                    subject_type="hsrp.order",
                    subject_id=order.id,
                    payload={"orderId": order.id, "orderNo": order_no, "channel": channel},
                    occurred_at=created_at,
                    dispatched_at=created_at,
                )
                s.add(ev)
                s.flush()
                s.add(
                    OutboxDelivery(
                        tenant_id=TENANT,
                        event_id=ev.id,
                        event_type="OrderReceived",
                        subscriber="orders.validate",
                        status="FAILED",
                        attempts=3,
                        max_attempts=10,
                        last_error="VAHAN not reachable (timeout after 30 s)",
                        next_attempt_at=now + timedelta(hours=6),
                    )
                )
            s.flush()

    for jc in job_cards.values():
        s.add(
            JobCard(
                id=jc["id"],
                tenant_id=TENANT,
                job_card_no=jc["no"],
                station_id=jc["station_id"],
                dealer_id=jc["dealer_id"],
                order_ids=jc["order_ids"],
                box_nos=jc["box_nos"],
                plate_count=jc["plates"],
                created_by="seed",
                created_at=jc["at"],
            )
        )
    for ch in challans.values():
        s.add(
            Challan(
                id=ch["id"],
                tenant_id=TENANT,
                challan_no=ch["no"],
                station_id=ch["station_id"],
                dealer_id=ch["dealer_id"],
                status="INWARDED" if ch["inwarded_at"] else "CREATED",
                created_by="seed",
                inwarded_at=ch["inwarded_at"],
                inwarded_by="seed" if ch["inwarded_at"] else None,
                created_at=ch["at"],
            )
        )
        s.flush()
        s.add_all(ChallanLine(tenant_id=TENANT, challan_id=ch["id"], **line) for line in ch["lines"])
    # Sequences continue after the seeded numbers.
    for name, value in (("job-card", seq_no.get("jc", 0) + 1), ("challan", seq_no.get("dc", 0) + 1), ("order", 1)):
        s.execute(update(DocSequence).where(DocSequence.tenant_id == TENANT, DocSequence.name == name).values(next_value=value))
    log.info("Orders: %s across %s statuses; %s job cards; %s challans", orders_made, len(PLAN), len(job_cards), len(challans))


def seed_tickets(s: Session, now: datetime) -> None:
    rows = [
        ("PLATE_DELAY", "Plates not received after 10 days", "OPEN", 18),
        ("FITMENT_ISSUE", "Rear plate loose after fitment", "IN_PROGRESS", 9),
        ("PAYMENT", "Paid twice for one order", "RESOLVED", 12),
        ("WRONG_DETAILS", "Wrong engine number on sticker", "IN_PROGRESS", 16),
        ("OTHER", "Cannot find fitment centre in my town", "OPEN", 2),
        ("PLATE_DELAY", "Appointment missed by the centre", "CLOSED", 25),
        ("PAYMENT", "Refund not received for cancelled order", "OPEN", 6),
        ("FITMENT_ISSUE", "Front plate scratched", "OPEN", 1),
    ]
    for n, (cat, title, status, age) in enumerate(rows, start=1):
        created_at = now - age * DAY
        resolved = status in ("RESOLVED", "CLOSED")
        t = Ticket(
            tenant_id=TENANT,
            ticket_no=f"CMP-SEED-{n:03d}",
            category_code=cat,
            title=title,
            description=f"{title}. (Fictional complaint created by the seed.)",
            status=status,
            raised_by_name=f"Demo Complainant {n}",
            raised_by_contact=f"90001{str(10000 + n)[-5:]}",
            due_at=created_at + 15 * DAY,
            resolved_at=created_at + 5 * DAY if resolved else None,
            created_at=created_at,
        )
        s.add(t)
        s.flush()
        s.add(TicketEvent(tenant_id=TENANT, ticket_id=t.id, kind="CREATED", message=t.description, to_status="OPEN", actor=t.raised_by_name, created_at=created_at))
        if status != "OPEN":
            s.add(
                TicketEvent(
                    tenant_id=TENANT,
                    ticket_id=t.id,
                    kind="STATUS",
                    message="Checked with the centre and fixed." if resolved else "We are checking with the fitment centre.",
                    from_status="OPEN",
                    to_status=status,
                    actor="Omkar Operations (demo)",
                    created_at=created_at + 2 * DAY,
                )
            )
    log.info("Tickets: %s (some past the 15-day limit)", len(rows))


if __name__ == "__main__":
    sys.exit(main())
