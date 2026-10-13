from app.contracts.schemas import ConfigSetRequest
from app.platform.http.decorators import require
from app.platform.http.routing import router as api_router
from app.platform.registry import services
from app.utility.configuration.service import Scope

router = api_router("/config", ["configuration"])


@router.get("")
@require("config.read", "config.manage")
def list_settings(key: str | None = None, history: str | None = None):
    return services().settings.list(key, history == "true")


@router.get("/resolve")
@require("config.read", "config.manage")
def resolve(key: str, scopes: str | None = None):
    parsed = []
    for part in filter(None, (scopes or "").split(",")):
        type_, _, id_ = part.partition(":")
        parsed.append(Scope(type_, id_.split(":")[0] if id_ else ""))
    return {"key": key, "value": services().settings.get(key, parsed)}


@router.post("")
@require("config.manage")
def set_setting(body: ConfigSetRequest):
    return services().settings.set(body.key, body.scope_type, body.scope_id, body.value, body.effective_from)
