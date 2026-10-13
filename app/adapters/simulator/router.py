"""Admin-only controls for the mocked outside world."""

import json
import time
import urllib.error
import urllib.request
import uuid
from typing import Annotated, Any, Literal

from fastapi import Body
from fastapi.responses import Response
from pydantic import Field, StringConstraints
from sqlalchemy import select

from app.adapters.models import MockOemCallback, MockOutboundMessage, MockPayuTxn, MockVahanVehicle
from app.adapters.simulator.new_vehicle_demo import create_demo_batch, demo_csv_rows
from app.contracts.schemas import VahanModeRequest
from app.platform.config import env
from app.platform.context import request_context
from app.platform.http.json import ApiModel
from app.platform.http.problem import Problem
from app.platform.http.routing import router as api_router
from app.platform.registry import services
from app.utility.identity.api_clients import sign_body
from app.utility.import_export.csv_tools import to_csv

router = api_router("/simulator", ["simulator"], perms=["simulator.use"])


class OemPushBody(ApiModel):
    oem_code: str | None = None
    repeat_last: bool = False


class VehicleSpecBody(ApiModel):
    role: Annotated[str, StringConstraints(min_length=1, max_length=40)]
    title: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    expected: Annotated[str, StringConstraints(max_length=300)] = ""
    category: Literal["2WN", "LMV", "LPV", "3WT", "2WT"]
    in_oem_file: bool = True
    engine_mismatch: bool | None = None
    oem: Literal["KRANTI", "ZENMO"] | None = None


class DemoBatchBody(ApiModel):
    vehicles: list[VehicleSpecBody] | None = Field(None, min_length=1, max_length=30)


class OemCsvBody(ApiModel):
    oem_code: str | None = None


def _state():
    return services().mock_state


def _demos() -> list[dict[str, Any]]:
    return _state().get("oem.demo", [])


@router.get("/state")
def get_state():
    return {
        "vahanMode": _state().get("vahan.mode", "normal"),
        "demoMode": env.demo_mode,
        "oems": [{"oemCode": d["oemCode"], "api": bool(d.get("apiKey")), "csvProfileCode": d.get("csvProfileCode"), "dealers": d["dealerCodes"]} for d in _demos()],
    }


@router.get("/oem-credentials")
def credentials():
    """The demo OEM's own credentials (they live on the 'OEM side' of the simulation). Used by demo:e2e."""
    return [{"oemCode": d["oemCode"], "apiKey": d["apiKey"], "secret": d.get("secret"), "dealerCodes": d["dealerCodes"]} for d in _demos() if d.get("apiKey")]


@router.put("/vahan-mode")
def set_vahan_mode(body: VahanModeRequest):
    _state().set("vahan.mode", body.mode)
    return {"vahanMode": body.mode}


@router.get("/messages")
def messages(to: str | None = None, channel: str | None = None):
    q = select(MockOutboundMessage)
    if to:
        q = q.where(MockOutboundMessage.to.contains(to, autoescape=True))
    if channel:
        q = q.where(MockOutboundMessage.channel == channel)
    with services().db.tx() as s:
        return list(s.scalars(q.order_by(MockOutboundMessage.created_at.desc()).limit(200)))


@router.get("/payments")
def payments():
    with services().db.tx() as s:
        return list(s.scalars(select(MockPayuTxn).order_by(MockPayuTxn.created_at.desc()).limit(100)))


@router.get("/oem-callbacks")
def callbacks():
    with services().db.tx() as s:
        return list(s.scalars(select(MockOemCallback).order_by(MockOemCallback.created_at.desc()).limit(100)))


@router.get("/vahan-vehicles")
def vehicles(scenario: str | None = None, q: str | None = None, state: str | None = None):
    stmt = select(MockVahanVehicle)
    if scenario:
        stmt = stmt.where(MockVahanVehicle.scenario == scenario)
    if state:
        stmt = stmt.where(MockVahanVehicle.state_cd == state)
    if q:
        stmt = stmt.where(MockVahanVehicle.regn_no.contains(q.upper(), autoescape=True))
    with services().db.tx() as s:
        return list(s.scalars(stmt.order_by(MockVahanVehicle.regn_no).limit(300)))


def _vehicle(regn_no: str) -> MockVahanVehicle | None:
    with services().db.tx() as s:
        return s.scalar(select(MockVahanVehicle).where(MockVahanVehicle.regn_no == regn_no))


@router.post("/oem-order")
def push_oem_order(body: OemPushBody):
    """Pushes a sample order to our own OEM endpoint exactly as an OEM system would (API key, signature, idempotency key)."""
    state = _state()
    demo = next((d for d in _demos() if d.get("apiKey") and (not body.oem_code or d["oemCode"] == body.oem_code)), None)
    if demo is None or not demo.get("apiKey") or not demo.get("secret"):
        raise Problem.bad_request("No API-integrated demo OEM is configured")
    last = state.get("oem.lastPush", None)
    if not body.repeat_last or not last:
        cursor = state.get(f"oem.cursor.{demo['oemCode']}", 0)
        if cursor >= len(demo["sampleRegnNos"]):
            raise Problem.conflict("All sample vehicles for this OEM have been used. Reseed to start over.")
        v = _vehicle(demo["sampleRegnNos"][cursor])
        if v is None:
            raise Problem.not_found("Sample vehicle")
        state.set(f"oem.cursor.{demo['oemCode']}", cursor + 1)
        last = {
            "idempotencyKey": str(uuid.uuid4()),
            "payload": {
                "oemOrderRef": f"{demo['oemCode']}-PO-{str(int(time.time() * 1000))[-8:]}",
                "dealerCode": demo["dealerCodes"][cursor % len(demo["dealerCodes"])],
                "regnNo": v.regn_no,
                "chassisNo": v.chassis_no,
                "engineNo": v.engine_no,
                "ownerName": "Test Owner (fictional)",
                "mobile": f"90000{str(10000 + cursor)[-5:]}",
            },
        }
        state.set("oem.lastPush", last)
    raw = json.dumps(last["payload"], separators=(",", ":"))
    path = f"/api/v1/oem/{demo['oemCode']}/orders"
    req = urllib.request.Request(
        f"{env.internal_api_url}{path}",
        data=raw.encode(),
        method="POST",
        headers={"content-type": "application/json", "x-api-key": demo["apiKey"], "x-signature": sign_body(demo["secret"], raw), "idempotency-key": last["idempotencyKey"]},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            status, headers, text = res.status, res.headers, res.read()
    except urllib.error.HTTPError as e:
        status, headers, text = e.code, e.headers, e.read()
    try:
        parsed = json.loads(text)
    except ValueError:
        parsed = None
    return {
        "request": {"url": path, "idempotencyKey": last["idempotencyKey"], "body": last["payload"]},
        "response": {"status": status, "replayed": headers.get("idempotent-replayed") == "true", "body": parsed},
    }


@router.post("/new-vehicle-demo")
def create_new_vehicle_demo(body: DemoBatchBody | None = Body(None)):
    """New-vehicle demo: fresh vehicles in mock VAHAN plus the sheet of who plays which part."""
    specs = [v.model_dump(by_alias=True, exclude_none=True) for v in body.vehicles] if body and body.vehicles else None
    with services().db.tx() as s:
        sheet = create_demo_batch(s, request_context.tenant_id(), specs)
    _state().set("demo.newVehicle", sheet)
    return sheet


@router.get("/new-vehicle-demo")
def new_vehicle_demo():
    return _state().get("demo.newVehicle", None)


def _require_sheet() -> dict[str, Any]:
    sheet = _state().get("demo.newVehicle", None)
    if not sheet:
        raise Problem.conflict("Prepare a new-vehicle demo batch first", "demo-missing")
    return sheet


@router.get("/new-vehicle-demo/csv")
def new_vehicle_demo_csv():
    """The batch's Kranti vehicle data file, for download (or upload by hand on the OEM files page)."""
    csv = to_csv(demo_csv_rows(_require_sheet()))
    return Response(csv, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="kranti-vehicle-data.csv"'})


@router.post("/new-vehicle-demo/upload")
def upload_new_vehicle_demo():
    """Sends the batch's vehicle data file through the import, exactly as an upload on the OEM files page would."""
    sheet = _require_sheet()
    return services().imports.start("OEM_KRANTI_VEHICLES", f"kranti-vehicle-data-{sheet['createdAt'][:10]}.csv", to_csv(demo_csv_rows(sheet)).encode())


def _build_csv(oem_code: str | None) -> tuple[str, dict[str, Any]]:
    """Sample file in the CSV OEM's own column layout: good rows plus deliberately bad ones."""
    state = _state()
    demo = next((d for d in _demos() if d.get("csvProfileCode") and (not oem_code or d["oemCode"] == oem_code)), None)
    if demo is None:
        raise Problem.bad_request("No CSV-integrated demo OEM is configured")
    cursor = state.get(f"oem.cursor.{demo['oemCode']}", 0)
    picks = demo["sampleRegnNos"][cursor : cursor + 4]
    if len(picks) < 2:
        raise Problem.conflict("Not enough unused sample vehicles left. Reseed to start over.")
    state.set(f"oem.cursor.{demo['oemCode']}", cursor + len(picks))
    with services().db.tx() as s:
        found = list(s.scalars(select(MockVahanVehicle).where(MockVahanVehicle.regn_no.in_(picks))))
    stamp = str(int(time.time() * 1000))[-6:]
    dealers = demo["dealerCodes"]
    rows = [
        {
            "Dealer Code": dealers[i % len(dealers)],
            "Invoice No": f"INV-{stamp}-{i + 1}",
            "Registration No": v.regn_no,
            "Chassis No": v.chassis_no,
            "Engine No": v.engine_no,
            "Customer Name": f"Sample Buyer {i + 1}",
            "Mobile": f"91111{str(10000 + i)[-5:]}",
        }
        for i, v in enumerate(found)
    ]
    rows.append({"Dealer Code": dealers[0], "Invoice No": f"INV-{stamp}-X1", "Registration No": "BAD REG", "Chassis No": "", "Engine No": "ENG00000", "Customer Name": "Missing chassis", "Mobile": "9999999999"})
    rows.append(
        {
            "Dealer Code": "NO-SUCH-DEALER",
            "Invoice No": f"INV-{stamp}-X2",
            "Registration No": "OD02ZZ9999",
            "Chassis No": "MCHXXXXXXXXX99999",
            "Engine No": "ENGXX99999",
            "Customer Name": "Unknown dealer",
            "Mobile": "9888888888",
        }
    )
    rows.append(
        {
            "Dealer Code": dealers[0],
            "Invoice No": f"INV-{stamp}-X3",
            "Registration No": "OD05QQ0001",
            "Chassis No": "MCHNOTINVAHAN0001",
            "Engine No": "ENGNOVAHAN01",
            "Customer Name": "Not in VAHAN",
            "Mobile": "9777777777",
        }
    )
    return to_csv(rows), demo


@router.get("/oem-csv")
def sample_csv(oemCode: str | None = None):  # noqa: N803
    csv, _ = _build_csv(oemCode)
    return Response(csv, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="sample-oem-orders.csv"'})


@router.post("/oem-csv")
def upload_sample_csv(body: OemCsvBody | None = Body(None)):
    csv, demo = _build_csv(body.oem_code if body else None)
    return services().imports.start(demo["csvProfileCode"], f"sample-{demo['oemCode']}-{int(time.time() * 1000)}.csv", csv.encode())
