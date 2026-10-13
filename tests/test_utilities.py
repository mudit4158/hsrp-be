"""Behaviour of the P2 utilities through their services and routes."""

import re
import time
from datetime import datetime, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.adapters.models import MockOutboundMessage
from app.platform.config import env
from app.platform.context import Actor, RequestContext, request_context
from app.platform.http.problem import Problem
from app.utility.configuration.service import Scope
from app.utility.documents.models import DocSequence, DocTemplate
from app.utility.documents.service import format_number
from app.utility.identity.models import IamRole
from app.utility.import_export.csv_tools import BOM, map_row, parse_csv, template_csv, to_csv
from app.utility.import_export.models import ImportJob, ImportProfile, ImportRow
from app.utility.notification.models import NotifyMessage, NotifyTemplate
from app.utility.notification.service import render_template
from app.utility.payments.models import Payment
from app.utility.scheduling.service import CalendarRule, slot_starts, weekday_of
from app.utility.tickets.models import TicketCategory
from app.utility.tickets.service import ageing
from tests.conftest import TEST_TENANT, as_system


@pytest.fixture
def c(clean):
    from app.container import container

    return container()


@pytest.fixture
def api(db):
    from app.main import create_app

    return TestClient(create_app(), raise_server_exceptions=False)


def as_user(fn, roles=("ADMIN",), perms=("*",), org_id=None):
    actor = Actor(id="u-test", type="user", name="Tester", roles=list(roles), permissions=list(perms), org_id=org_id)
    return request_context.run(RequestContext(tenant_id=TEST_TENANT, actor=actor), fn)


def drain(c):
    while c.bus.run_once():
        pass


# ---------- pure helpers ----------


def test_pure_helpers():
    assert render_template("OTP {{otp}} valid {{ minutes }} min", {"otp": "123456", "minutes": 5.0}) == "OTP 123456 valid 5 min"
    with pytest.raises(ValueError, match='Missing template variable "x"'):
        render_template("{{x}}", {})
    assert format_number("ORD{YY}{MM}-", 42, 6, datetime(2026, 3, 31, 19, 0)) == "ORD2604-000042"  # 00:30 IST on 1 April
    assert slot_starts("10:00", "12:00", 45) == ["10:00", "10:45"]
    assert weekday_of("2026-10-11") == 0  # a Sunday
    now = datetime(2026, 10, 13, 12)
    a = ageing(now - timedelta(days=3, hours=1), now + timedelta(days=2), "OPEN", None, now)
    assert a == {"ageDays": 3, "daysLeft": 2, "overdue": False}
    assert ageing(now - timedelta(days=9), now - timedelta(days=2), "RESOLVED", now - timedelta(days=1), now)["overdue"] is True


def test_csv_tools():
    rows = parse_csv(BOM + 'Chassis No , Model\n abc123 ,"M, 1"\n\nX9,\n')
    assert rows == [{"Chassis No": "abc123", "Model": "M, 1"}, {"Chassis No": "X9", "Model": ""}]
    profile = {
        "columns": {
            "chassisNo": {"from": "Chassis No", "required": True, "transform": "upper", "example": "MA1AB"},
            "invoiceDate": {"from": "Date", "transform": "date-dmy", "example": "31-12-2026"},
        },
        "columnOrder": ["chassisNo", "invoiceDate"],
    }
    assert map_row({"Chassis No": "abc123", "Date": "1/2/2026"}, profile) == ({"chassisNo": "ABC123", "invoiceDate": "2026-02-01"}, [])
    assert map_row({"Date": "2026"}, profile)[1] == ["Chassis No is required", "Date must be a date like 31-12-2024"]
    assert template_csv(profile) == "Chassis No,Date\r\nMA1AB,31-12-2026\r\n"
    assert to_csv([{"a": 'x"y', "b": {"k": 1}, "c": None}]) == 'a,b,c\r\n"x""y","{""k"":1}",\r\n'


# ---------- identity ----------


def test_login_me_and_failed_login(c, api):
    with c.db.tx() as s:
        s.add(IamRole(tenant_id=env.default_tenant_id, code="OPS", name="Ops", permissions=["orders.read", "iam.manage"]))
    request_context.run(RequestContext(tenant_id=env.default_tenant_id), lambda: c.identity.create_user("Ops.One", "Ops One", "a-long-password", ["OPS"]))

    bad = api.post("/api/v1/auth/login", json={"username": "ops.one", "password": "wrong"})
    assert bad.status_code == 401 and bad.json()["detail"] == "Wrong username or password"

    ok = api.post("/api/v1/auth/login", json={"username": " OPS.ONE ", "password": "a-long-password", "deviceId": "dev-123"})
    assert ok.status_code == 201
    body = ok.json()
    claims = jwt.decode(body["token"], env.jwt_secret, algorithms=["HS256"])
    assert (claims["kind"], claims["dev"], claims["perms"], body["expiresIn"]) == ("user", "dev-123", ["orders.read", "iam.manage"], env.jwt_expires_in)
    assert claims["exp"] - claims["iat"] == 8 * 3600

    h = {"Authorization": f"Bearer {body['token']}", "X-Device-Id": "dev-123"}
    me = api.get("/api/v1/auth/me", headers=h).json()
    assert (me["username"], me["permissions"], me["org"]) == ("ops.one", ["orders.read", "iam.manage"], None)
    users = api.get("/api/v1/iam/users", headers=h).json()
    assert users[0]["lastLoginAt"].endswith("Z") and "passwordHash" not in users[0]


def test_password_hashes_from_node_still_verify():
    from app.utility.identity.passwords import hash_password, verify_password

    # Produced by the NestJS hashPassword('secret-pass') (Node crypto.scrypt, N=16384 r=8 p=1, 32 bytes).
    node = "scrypt$AAECAwQFBgcICQoLDA0ODw==$" + __import__("base64").b64encode(
        __import__("hashlib").scrypt(b"secret-pass", salt=bytes(range(16)), n=16384, r=8, p=1, dklen=32)
    ).decode()
    assert verify_password("secret-pass", node) and not verify_password("other", node)
    assert verify_password("x" * 9, hash_password("x" * 9))


# ---------- configuration ----------


def test_settings_scopes_and_effective_dates(c):
    def run():
        c.settings.set("pricing.rate", "global", "*", 100)
        c.settings.set("pricing.rate", "state", "WB", 120)
        assert c.settings.get("pricing.rate", [Scope("dealer", "D1"), Scope("state", "WB")]) == 120
        assert c.settings.get("pricing.rate", [Scope("state", "OD")]) == 100
        assert c.settings.get_or("missing.key", "fallback") == "fallback"
        c.settings.set("pricing.rate", "state", "WB", 150, datetime.now() + timedelta(days=1))
        assert c.settings.get("pricing.rate", [Scope("state", "WB")]) == 120  # the new value starts tomorrow
        c.settings.set("pricing.rate", "state", "WB", 130)
        assert c.settings.get("pricing.rate", [Scope("state", "WB")]) == 130
        return c.settings.list("pricing", include_history=True)

    rows = as_user(run)
    assert len(rows) == 4


# ---------- notification ----------


def test_notification_is_queued_then_sent_through_the_mock_gateway(c):
    with c.db.tx() as s:
        s.add(NotifyTemplate(tenant_id=TEST_TENANT, code="OTP", channel="SMS", sender_id="HSRPDM", dlt_template_id="DLT1", body="Your OTP is {{otp}}"))

    def send():
        with c.db.tx() as s:
            return c.notifications.send("OTP", "SMS", "9876500000", {"otp": "111222"}, "otp", "o-1", s=s).id

    msg_id = as_system(send)
    drain(c)
    with c.db.tx() as s:
        msg = s.get(NotifyMessage, msg_id)
        sent = s.scalars(select(MockOutboundMessage)).one()
    assert (msg.status, msg.provider_ref) == ("SENT", sent.provider_ref)
    assert sent.body == "Your OTP is 111222" and sent.to == "9876500000"
    with pytest.raises(Problem, match="No active SMS template NOPE"):
        as_system(lambda: c.notifications.send("NOPE", "SMS", "9", {}))


# ---------- files and documents ----------


def test_file_upload_signed_link_and_content(c, api):
    token = jwt.encode({"sub": "u", "tid": env.default_tenant_id, "kind": "user", "roles": [], "perms": ["*"], "exp": int(time.time()) + 60}, env.jwt_secret)
    h = {"Authorization": f"Bearer {token}"}
    res = api.post("/api/v1/files", files={"file": ("plate.png", b"\x89PNG fake", "image/png")}, data={"purpose": "test"}, headers=h)
    assert res.status_code == 201
    url = res.json()["url"]
    assert re.fullmatch(r"/api/v1/files/[\w-]+/content\?exp=\d+&sig=[\w-]+", url)
    got = api.get(url)
    assert got.status_code == 200 and got.content == b"\x89PNG fake" and got.headers["content-type"] == "image/png"
    assert api.get(url.replace("sig=", "sig=x")).status_code == 403
    bad = api.post("/api/v1/files", files={"file": ("x.exe", b"MZ", "application/x-msdownload")}, headers=h)
    assert bad.json()["type"].endswith("/file-type")


def test_document_numbers_and_pdf(c):
    def run():
        c.documents.ensure_sequence("order", "ORD{YY}-", 5)
        c.documents.ensure_sequence("order", "IGNORED-", 9)  # exists: unchanged
        a, b = c.documents.next_number("order"), c.documents.next_number("order")
        layout = {
            "page": "STICKER",
            "margin": 12,
            "repeatFor": "orders",
            "elements": [
                {"type": "heading", "text": "{{title}}"},
                {"type": "big", "text": "{{regnNo}}"},
                {"type": "fields", "items": [{"label": "Order", "value": "{{orderNo}}"}, {"label": "Missing", "value": "{{nope}}"}]},
                {"type": "table", "source": "lines", "columns": [{"header": "#", "value": "{{rowNo}}"}, {"header": "Code", "value": "{{code}}", "width": 3}]},
                {"type": "band", "text": "PAID", "color": "#16a34a", "when": "paid"},
                {"type": "rule"},
                {"type": "spacer"},
                {"type": "signature", "labels": ["Dealer", "Station"]},
            ],
        }
        c.documents.upsert_template("sticker", "Sticker", layout)
        t = c.documents.upsert_template("sticker", "Sticker v2", layout)
        pdf = c.documents.render(
            "sticker", {"title": "HSRP", "orders": [{"regnNo": "WB02AB1234", "orderNo": "O1", "lines": [{"code": "LC1"}], "paid": True}, {"regnNo": "OD02X9"}]}
        )
        return a, b, t.version, pdf

    a, b, version, pdf = as_system(run)
    assert re.fullmatch(r"ORD\d\d-00001", a) and b.endswith("-00002")
    assert version == 2
    assert pdf.startswith(b"%PDF") and pdf.count(b"/Type /Page\n") + pdf.count(b"/Type /Page\r") + pdf.count(b"/Type /Page ") >= 2
    with c.db.tx() as s:
        assert s.scalars(select(DocSequence)).one().prefix == "ORD{YY}-"
        assert s.scalars(select(DocTemplate)).one().name == "Sticker v2"


# ---------- scheduling, tickets, approvals ----------


def test_scheduling_slots_and_capacity(c):
    def run():
        r = c.scheduling.upsert_resource("DEALER-1", "Dealer one", "dealer", "d1")
        c.scheduling.set_calendar(r.id, [CalendarRule(weekday_of("2026-10-14"), "10:00", "11:00", 30, 1)])
        with c.db.tx() as s:
            c.scheduling.book(r.id, "2026-10-14", "10:00", "order", "o1", s)
        with pytest.raises(Problem, match="full"):
            with c.db.tx() as s:
                c.scheduling.book(r.id, "2026-10-14", "10:00", "order", "o2", s)
        return c.scheduling.slots(r.id, "2026-10-14")

    assert as_system(run) == [
        {"start": "10:00", "capacity": 1, "booked": 1, "available": 0},
        {"start": "10:30", "capacity": 1, "booked": 0, "available": 1},
    ]


def test_ticket_create_reply_and_list(c):
    with c.db.tx() as s:
        s.add(TicketCategory(tenant_id=TEST_TENANT, code="DELAY", name="Delay", sla_days=3))
        s.add(DocSequence(tenant_id=TEST_TENANT, name="ticket", prefix="TKT-", padding=4))

    t = as_system(lambda: c.tickets.create("DELAY", "Late plates", "Plates not fitted yet", "A. Customer", "9876500001"))
    assert t.ticket_no == "TKT-0001"
    as_user(lambda: c.tickets.reply(t.id, "Looking into it"))
    as_user(lambda: c.tickets.reply(t.id, "Fitted today", "RESOLVED", False))
    detail = as_user(lambda: c.tickets.get(t.id))
    assert detail["status"] == "RESOLVED" and [e.kind for e in detail["events"]] == ["CREATED", "STATUS", "STATUS"]
    assert as_user(lambda: c.tickets.by_number("TKT-0001", True))["events"][-1].message == "Looking into it"
    page = as_user(lambda: c.tickets.list("RESOLVED", False, 1, 10))
    assert page["total"] == 1 and page["items"][0]["overdue"] is False


def test_approval_rules(c):
    def request():
        with c.db.tx() as s:
            r = c.approvals.request(s, "REPLACEMENT", "order", "o1", "OPERATIONS", "Replace plates", scope_org_id="org-1")
            again = c.approvals.request(s, "REPLACEMENT", "order", "o1", "OPERATIONS", "Replace plates")
            assert again.id == r.id
            return r.id

    rid = as_system(request)
    with pytest.raises(Problem, match="Only OPERATIONS"):
        as_user(lambda: c.approvals.decide(rid, "APPROVE", "ok then"), roles=["DEALER"])
    with pytest.raises(Problem, match="another organisation"):
        as_user(lambda: c.approvals.decide(rid, "APPROVE", "ok then"), roles=["OPERATIONS"], org_id="org-2")
    with pytest.raises(Problem, match="Remarks are mandatory"):
        as_user(lambda: c.approvals.decide(rid, "APPROVE", " x "))
    assert as_user(lambda: c.approvals.list(), roles=["DEALER"]) == []
    decided = as_user(lambda: c.approvals.decide(rid, "REJECT", "  wrong evidence "), roles=["OPERATIONS"], org_id="org-1")
    assert (decided.status, decided.remarks) == ("REJECTED", "wrong evidence")
    with pytest.raises(Problem, match="Already rejected"):
        as_user(lambda: c.approvals.decide(rid, "APPROVE", "second try"))


# ---------- import ----------


def test_import_maps_checks_and_processes_rows(c):
    seen = []

    class Target:
        def process_row(self, mapped, ctx):
            if mapped["chassisNo"] == "BAD01":
                raise Problem.unprocessable("Unknown dealer")
            seen.append((mapped["chassisNo"], ctx.context["oemCode"]))
            return {"ref": f"V-{mapped['chassisNo']}"}

    c.imports.register_target("test-vehicles", Target())
    with c.db.tx() as s:
        s.add(
            ImportProfile(
                tenant_id=TEST_TENANT,
                code="TEST_VEHICLES",
                name="Test vehicles",
                source_name="Test",
                target_type="test-vehicles",
                delimiter=",",
                mapping={"columns": {"chassisNo": {"from": "Chassis", "required": True, "transform": "upper"}}, "requiredContext": ["oemCode"]},
            )
        )
    csv = b"Chassis\nabc01\n\nbad01\n,\n"
    with pytest.raises(Problem, match="needs oemCode"):
        as_user(lambda: c.imports.start("TEST_VEHICLES", "v.csv", csv))
    job = as_user(lambda: c.imports.start("TEST_VEHICLES", "v.csv", csv, {"oemCode": "KRANTI"}))
    drain(c)
    with c.db.tx() as s:
        done = s.get(ImportJob, job.id)
        rows = s.scalars(select(ImportRow).where(ImportRow.job_id == job.id).order_by(ImportRow.row_no)).all()
    assert seen == [("ABC01", "KRANTI")]
    assert (done.status, done.total_rows, done.ok_rows, done.error_rows) == ("DONE", 3, 1, 2)
    assert [(r.row_no, r.status, r.errors) for r in rows] == [(2, "OK", None), (3, "ERROR", ["Unknown dealer"]), (4, "ERROR", ["Chassis is required"])]
    report = as_user(lambda: c.imports.error_report(job.id))
    assert report.splitlines()[0] == "Row,Errors,Chassis" and "3,Unknown dealer,bad01" in report


# ---------- payments ----------


def test_payment_checkout_gateway_webhook(c, api, monkeypatch):
    from app.adapters.payment import gateway

    posted = []
    monkeypatch.setattr(gateway, "_send_webhook", lambda fields: posted.append(fields))
    monkeypatch.setattr(gateway.threading, "Timer", lambda _d, fn, args: type("T", (), {"start": lambda self: fn(*args)})())

    def create():
        return c.payments.create_payment(25_000, {"name": "Dealer WB01"}, "wallet-topup", "w1", "http://localhost:8080/return", "Wallet top-up")

    p = as_user(create)
    form = as_user(lambda: c.payments.checkout(p.id))
    assert form["action"].endswith("/mock-gateway/payu/_payment") and form["fields"]["amount"] == "250.00"
    page = api.post("/mock-gateway/payu/_payment", data=form["fields"])
    assert page.status_code == 200 and "Mock payment gateway" in page.text
    assert api.post("/mock-gateway/payu/_payment", data={**form["fields"], "amount": "1.00"}).status_code == 400
    back = api.post("/mock-gateway/payu/complete", data={"txnid": p.txn_id, "outcome": "success"})
    assert "Returning to the merchant" in back.text and len(posted) == 1

    tampered = api.post("/api/v1/payments/webhook/payu", json={**posted[0], "amount": "1.00"})
    assert tampered.json()["type"].endswith("/bad-hash")
    hook = api.post("/api/v1/payments/webhook/payu", json=posted[0])
    assert hook.status_code == 200 and hook.json() == {"ok": True}
    ret = api.post("/api/v1/payments/return/payu", data=posted[0], follow_redirects=False)
    assert ret.status_code == 303 and ret.headers["location"] == f"http://localhost:8080/return?paymentId={p.id}&result=success"
    drain(c)
    with c.db.tx() as s:
        paid = s.get(Payment, p.id)
    # The webhook settled it; the verify queued by the browser return finds it paid and does nothing (as in NestJS).
    assert (paid.status, paid.provider_ref) == ("SUCCESS", posted[0]["mihpayid"])
