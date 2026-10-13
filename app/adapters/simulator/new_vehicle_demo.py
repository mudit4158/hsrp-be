"""The new-vehicle demo batch: fresh fictional vehicles registered in mock VAHAN, a Kranti vehicle data file for them,
and a sheet saying which vehicle plays which part. The Simulator page uses DEFAULT_SPECS; the scripted simulator
(`pnpm sim`) sends one spec per vehicle its test cases need (docs/SIMULATION.md)."""

import secrets
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters.models import MockOemCatalogue, MockVahanVehicle

DEFAULT_SPECS: list[dict[str, Any]] = [
    {"role": "VALID", "category": "LMV", "inOemFile": True, "title": "Valid order", "expected": "Passes OEM data and VAHAN, goes through production, inward and fitment to COMPLETED."},
    {
        "role": "NOT_IN_OEM_DATA",
        "category": "2WN",
        "inOemFile": False,
        "title": "Chassis not in the OEM data",
        "expected": "Left out of the Kranti file on purpose: the order is REJECTED at the oem-vehicle-data step.",
    },
    {
        "role": "ENGINE_MISMATCH",
        "category": "LMV",
        "inOemFile": True,
        "engineMismatch": True,
        "title": "Chassis and engine do not match",
        "expected": 'Order it with the "engine to type" number: REJECTED at the oem-vehicle-data step.',
    },
    {
        "role": "QC_REJECT",
        "category": "LMV",
        "inOemFile": True,
        "title": "QC rejects a plate",
        "expected": "QC rejects the front plate; the station approves the rejection, re-issues it, QC passes; completes.",
    },
    {
        "role": "DEALER_REJECT",
        "category": "2WN",
        "inOemFile": True,
        "title": "Dealer rejects a plate at inward",
        "expected": "Dealer rejects the rear plate at inward; the station re-issues it on a new challan; completes.",
    },
    {
        "role": "VAHAN_DOWN",
        "category": "2WN",
        "inOemFile": True,
        "title": "VAHAN down at fitment",
        "expected": "Fitment is recorded while VAHAN is down; the post waits in the retry queue and completes after a replay.",
    },
    {"role": "CANCELLED", "category": "LMV", "inOemFile": True, "title": "Cancelled after confirmation", "expected": "Operations cancel it before production; the wallet hold is released."},
]

ALNUM = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789"
MODELS = {"LMV": "Kranti Vista (fictional)", "2WN": "Kranti Sprint 110 (fictional)"}
ZENMO_MODELS = {"LMV": "Zenmo Aura (fictional)", "2WN": "Zenmo Zip 125 (fictional)"}
VEHICLE_TYPE = {"LPV": "TRANSPORT", "3WT": "TRANSPORT", "2WT": "TRANSPORT", "HGV": "TRANSPORT", "TRL": "TRANSPORT"}
IST = timedelta(hours=5, minutes=30)


def _str(n: int) -> str:
    return "".join(secrets.choice(ALNUM) for _ in range(n))


def _rand(lo: int, hi: int) -> int:
    """Random integer in [lo, hi), as Node's randomInt(lo, hi)."""
    return lo + secrets.randbelow(hi - lo)


def _dmy(d: datetime) -> str:
    return (d + IST).strftime("%d-%m-%Y")


def create_demo_batch(s: Session, tenant_id: str, specs: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    vehicles = []
    now = datetime.now(UTC).replace(tzinfo=None)
    stamp = str(int(time.time() * 1000))
    for i, r in enumerate(specs or DEFAULT_SPECS):
        while True:
            regn_no = f"WB02K{'ABCDEFGHJ'[secrets.randbelow(9)]}{_rand(1, 10_000):04d}"
            if s.scalar(select(MockVahanVehicle.id).where(MockVahanVehicle.regn_no == regn_no)) is None:
                break
        oem = r.get("oem") or "KRANTI"
        chassis_no = f"{'MZ' if oem == 'ZENMO' else 'MK'}{_str(10)}{_rand(10_000, 100_000)}"
        engine_no = f"K{_str(4)}{_rand(10_000, 100_000)}"
        registered = now - timedelta(days=_rand(2, 20))
        invoiced = registered - timedelta(days=3)
        s.add(
            MockVahanVehicle(
                tenant_id=tenant_id,
                regn_no=regn_no,
                chassis_no=chassis_no,
                engine_no=engine_no,
                state_cd="WB",
                off_cd="WB02",
                maker="ZENMO MOTORS (FICTIONAL)" if oem == "ZENMO" else "KRANTI AUTOS (FICTIONAL)",
                fuel="PETROL",
                vch_type=VEHICLE_TYPE.get(r["category"], "NON TRANSPORT"),
                vch_catg=r["category"],
                norms="BHARAT STAGE VI",
                regn_date=_dmy(registered),
                scenario="demo-batch",
            )
        )
        # Zenmo is API-integrated: its orders are checked against its (mock) catalogue, not a vehicle data file.
        if oem == "ZENMO":
            s.add(MockOemCatalogue(tenant_id=tenant_id, oem_code="ZENMO", chassis_no=chassis_no, model=ZENMO_MODELS.get(r["category"], "Zenmo (fictional)")))
        s.flush()
        vehicles.append(
            {
                "no": i + 1,
                "role": r["role"],
                "title": r["title"],
                "expected": r.get("expected", ""),
                "regnNo": regn_no,
                "chassisNo": chassis_no,
                "engineNo": engine_no,
                "orderEngineNo": f"K{_str(4)}{_rand(10_000, 100_000)}" if r.get("engineMismatch") else engine_no,
                "vchCatg": r["category"],
                "model": (ZENMO_MODELS if oem == "ZENMO" else MODELS).get(r["category"], "Demo model (fictional)"),
                "inOemFile": oem == "KRANTI" and r.get("inOemFile", True),
                "oem": oem,
                "invoiceNo": f"KRA-INV-{stamp[-5:]}{i + 1}",
                "invoiceDate": _dmy(invoiced),
            }
        )
    created = now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
    return {"createdAt": created, "oemCode": "KRANTI", "dealerCode": "WB01", "stateCode": "WB", "vehicles": vehicles}


def demo_csv_rows(sheet: dict[str, Any]) -> list[dict[str, str]]:
    """Kranti's vehicle data file for the batch, plus two rows the import must refuse (error report)."""
    rows = [
        {
            "Chassis No": v["chassisNo"],
            "Engine No": v["engineNo"],
            "Model": v["model"],
            "Category": v["vchCatg"],
            "Dealer Code": sheet["dealerCode"],
            "Invoice No": v["invoiceNo"],
            "Invoice Date": v["invoiceDate"],
        }
        for v in sheet["vehicles"]
        if v["inOemFile"]
    ]
    first = sheet["vehicles"][0]
    rows.append(
        {"Chassis No": "", "Engine No": f"K{_str(4)}00001", "Model": first["model"], "Category": "LMV", "Dealer Code": sheet["dealerCode"], "Invoice No": "KRA-INV-BAD1", "Invoice Date": first["invoiceDate"]}
    )
    rows.append(
        {
            "Chassis No": f"MK{_str(10)}00002",
            "Engine No": f"K{_str(4)}00002",
            "Model": first["model"],
            "Category": "LMV",
            "Dealer Code": "WB02",
            "Invoice No": "KRA-INV-BAD2",
            "Invoice Date": first["invoiceDate"],
        }
    )
    return rows
