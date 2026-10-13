from datetime import UTC, datetime

from sqlalchemy import text

from app.platform.config import env
from app.platform.db.session import get_db
from app.platform.http.routing import router as api_router

router = api_router("/health", ["platform"])


@router.get("")
def health():
    with get_db().tx() as s:
        s.execute(text("SELECT 1"))
    return {"status": "ok", "worker": env.worker_enabled, "demoMode": env.demo_mode, "time": datetime.now(UTC)}
