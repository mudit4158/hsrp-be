"""The request pipeline (NestJS guards and interceptors): auth, permissions, device binding, idempotency, audit,
throttling, default status codes."""

import time
import uuid

import jwt
import pytest
from fastapi import Body
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.platform.config import env
from app.platform.http.decorators import api_client_auth, idempotent, public, require, throttle
from app.platform.http.routing import router
from app.utility.audit.models import AuditLog
from app.utility.identity.api_clients import sign_body
from app.utility.identity.models import IamApiClient, IamDevice, IamRole
from tests.conftest import TEST_TENANT

calls = {"n": 0}

r = router("/pipe", perms=["things.read"])


@r.get("/read")
def read():
    return {"ok": True}


@r.post("/write")
@require("things.write")
def write():
    return {"written": True}


@r.post("/nothing")
@require("things.write")
def nothing():
    return None


@r.get("/open")
@public
def open_():
    from app.platform.context import request_context

    actor = request_context.actor()
    return {"actor": actor.id if actor else None}


@r.post("/orders/{id}")
@idempotent
@require("things.write")
def create(id: str, body: dict = Body(...)):
    calls["n"] += 1
    if body.get("fail"):
        raise RuntimeError("handler failed")
    return {"id": id, "n": calls["n"], "body": body}


@r.post("/oem")
@api_client_auth
@require("oem.push")
def oem(body: dict = Body(...)):
    return {"got": body}


@r.get("/limited")
@public
@throttle(2, 60)
def limited():
    return {"ok": True}


def token(perms, **extra):
    now = int(time.time())
    claims = {"sub": "u-1", "tid": TEST_TENANT, "kind": "user", "name": "Tester", "roles": ["R"], "perms": perms, "org": None, "iat": now, "exp": now + 600}
    claims.update(extra)
    return {"Authorization": "Bearer " + jwt.encode(claims, env.jwt_secret, algorithm="HS256")}


@pytest.fixture(scope="module")
def api(db):
    from app.main import create_app

    app = create_app()
    app.include_router(r, prefix="/api/v1")
    return TestClient(app, raise_server_exceptions=False)


def test_sign_in_required(api):
    res = api.get("/api/v1/pipe/read")
    assert res.status_code == 401 and res.json()["detail"] == "Sign in required"
    res = api.get("/api/v1/pipe/read", headers={"Authorization": "Bearer nope"})
    assert res.status_code == 401 and res.json()["detail"] == "Session expired or invalid. Sign in again."


def test_public_reads_a_token_and_ignores_a_bad_one(api):
    assert api.get("/api/v1/pipe/open").json() == {"actor": None}
    assert api.get("/api/v1/pipe/open", headers={"Authorization": "Bearer nope"}).json() == {"actor": None}
    assert api.get("/api/v1/pipe/open", headers=token(["things.read"])).json() == {"actor": "u-1"}
    # As in NestJS: a token on a public route is still checked against the inherited permissions.
    assert api.get("/api/v1/pipe/open", headers=token([])).status_code == 403


def test_permissions_route_overrides_router(api):
    assert api.get("/api/v1/pipe/read", headers=token(["things.read"])).status_code == 200
    res = api.post("/api/v1/pipe/write", headers=token(["things.read"]))
    assert res.status_code == 403 and res.json()["detail"] == "Needs permission: things.write"
    assert api.post("/api/v1/pipe/write", headers=token(["*"])).status_code == 201


def test_post_defaults_to_201_and_none_is_an_empty_body(api):
    res = api.post("/api/v1/pipe/nothing", headers=token(["things.write"]))
    assert res.status_code == 201 and res.content == b""


def test_device_bound_session(api, clean):
    with clean.tx() as s:
        s.add(IamDevice(tenant_id=TEST_TENANT, user_id="u-1", device_id="dev-1", active=True))
    h = token(["things.read"], dev="dev-1")
    assert api.get("/api/v1/pipe/read", headers=h).status_code == 401  # no X-Device-Id
    assert api.get("/api/v1/pipe/read", headers={**h, "X-Device-Id": "dev-2"}).json()["detail"] == "This session is bound to another device"
    assert api.get("/api/v1/pipe/read", headers={**h, "X-Device-Id": "dev-1"}).status_code == 200
    with clean.tx() as s:
        s.scalars(select(IamDevice)).one().active = False
    res = api.get("/api/v1/pipe/read", headers={**h, "X-Device-Id": "dev-1"})
    assert res.json()["detail"] == "This device is not registered or has been deactivated"


def test_idempotency(api, clean):
    h = token(["things.write"])
    res = api.post("/api/v1/pipe/orders/o1", json={"a": 1}, headers=h)
    assert res.status_code == 400 and res.json()["type"].endswith("/idempotency-key-required")

    key = {"Idempotency-Key": str(uuid.uuid4())}
    first = api.post("/api/v1/pipe/orders/o1", json={"a": 1}, headers={**h, **key})
    again = api.post("/api/v1/pipe/orders/o1", json={"a": 1}, headers={**h, **key})
    assert first.status_code == again.status_code == 201
    assert again.json() == first.json() and again.headers["Idempotent-Replayed"] == "true"

    other = api.post("/api/v1/pipe/orders/o1", json={"a": 2}, headers={**h, **key})
    assert other.status_code == 422 and other.json()["type"].endswith("/idempotency-mismatch")

    # A failed request releases its key, so the client can retry with it.
    key2 = {"Idempotency-Key": str(uuid.uuid4())}
    assert api.post("/api/v1/pipe/orders/o2", json={"fail": True}, headers={**h, **key2}).status_code == 500
    assert api.post("/api/v1/pipe/orders/o2", json={"fail": True}, headers={**h, **key2}).status_code == 500


def test_mutations_are_audited_with_the_express_route(api, clean):
    h = token(["things.write"])
    api.post("/api/v1/pipe/orders/o9", json={"a": 1}, headers={**h, "Idempotency-Key": str(uuid.uuid4())})
    with clean.tx() as s:
        log = s.scalars(select(AuditLog).where(AuditLog.subject_type == "http")).one()
    assert log.action == "http.post /api/v1/pipe/orders/:id"
    assert (log.subject_id, log.actor_id, log.actor_type, log.tenant_id) == ("o9", "u-1", "user", TEST_TENANT)
    assert log.after == {"params": {"id": "o9"}, "status": "ok"}


def test_api_client_hmac(api, clean):
    with clean.tx() as s:
        s.add(IamRole(tenant_id=TEST_TENANT, code="OEM_SYSTEM", name="OEM", permissions=["oem.push"]))
    from app.platform.context import request_context
    from app.platform.registry import services

    creds = request_context.run_as_system(TEST_TENANT, lambda: services().api_clients.create(TEST_TENANT, "org-1", "Kranti", ["OEM_SYSTEM"]))
    raw = b'{"chassisNo":"X1"}'
    good = {"X-Api-Key": creds["apiKey"], "X-Signature": sign_body(creds["secret"], raw), "Content-Type": "application/json"}
    res = api.post("/api/v1/pipe/oem", content=raw, headers=good)
    assert res.status_code == 201 and res.json() == {"got": {"chassisNo": "X1"}}
    bad = {**good, "X-Signature": sign_body("wrong", raw)}
    assert api.post("/api/v1/pipe/oem", content=raw, headers=bad).json()["detail"] == "Request signature does not match"
    assert api.post("/api/v1/pipe/oem", content=raw, headers={"Content-Type": "application/json"}).json()["detail"] == "X-Api-Key header required"
    with clean.tx() as s:
        assert s.scalars(select(IamApiClient)).one().key_hash != creds["apiKey"]


def test_throttle(api):
    assert [api.get("/api/v1/pipe/limited").status_code for _ in range(3)] == [200, 200, 429]
    assert api.get("/api/v1/pipe/limited").json()["type"].endswith("/rate-limited")
