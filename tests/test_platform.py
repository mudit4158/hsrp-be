import app.models  # noqa: F401
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from app.platform.db.base import Base
from app.platform.http.json import iso
from app.platform.http.problem import Problem


def test_models_match_the_migrated_schema(db):
    # The generated models must map the Alembic schema exactly, or autogenerate would emit spurious changes.
    with db.engine.connect() as c:
        diffs = compare_metadata(MigrationContext.configure(c, opts={"compare_type": True}), Base.metadata)
    assert len(Base.metadata.tables) == 75
    assert diffs == []


def test_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["time"].endswith("Z") and len(body["time"]) == 24
    assert r.headers["x-request-id"]


def test_unknown_route_is_problem_json(client):
    r = client.post("/api/v1/nope")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/problem+json")
    assert r.json() == {
        "type": "https://hsrp.local/problems/http",
        "title": "NotFound",
        "status": 404,
        "detail": "Cannot POST /api/v1/nope",
        "instance": "/api/v1/nope",
    }


def test_problem_rendering(client):
    from app.platform.http.routing import router

    r = router("/t", public=True)

    @r.get("/conflict")
    def conflict():
        raise Problem.conflict("Plate photo must pass OCR first", "plate-ocr-required", {"orderId": "o1"})

    client.app.include_router(r, prefix="/api/v1")
    res = client.get("/api/v1/t/conflict")
    assert res.status_code == 409
    assert res.json() == {
        "type": "https://hsrp.local/problems/plate-ocr-required",
        "title": "Conflict",
        "status": 409,
        "detail": "Plate photo must pass OCR first",
        "orderId": "o1",
        "instance": "/api/v1/t/conflict",
    }


def test_iso_matches_javascript_toisostring():
    from datetime import UTC, datetime, timedelta, timezone

    assert iso(datetime(2026, 10, 12, 12, 53, 11, 100999)) == "2026-10-12T12:53:11.100Z"
    ist = timezone(timedelta(hours=5, minutes=30))
    assert iso(datetime(2026, 10, 12, 18, 23, 11, tzinfo=ist)) == "2026-10-12T12:53:11.000Z"
    assert iso(datetime(2026, 10, 12, 12, 53, 11, tzinfo=UTC)) == "2026-10-12T12:53:11.000Z"
