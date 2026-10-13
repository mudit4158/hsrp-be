from typing import Any

from fastapi import Body

from app.core.masters.service import MASTER_RESOURCES
from app.platform.http.decorators import require
from app.platform.http.routing import router as api_router
from app.platform.registry import services

router = api_router("/masters", ["masters"])


@router.get("")
@require("masters.read")
def resources():
    return [{"key": key, "label": r.label} for key, r in MASTER_RESOURCES.items()]


@router.get("/{resource}")
@require("masters.read", "orders.read")
def list_resource(resource: str, q: str | None = None):
    return services().masters.list(resource, q)


@router.post("/{resource}")
@require("masters.manage")
def create(resource: str, body: Any = Body(None)):
    return services().masters.create(resource, body)


@router.patch("/{resource}/{id}")
@require("masters.manage")
def update(resource: str, id: str, body: Any = Body(None)):
    return services().masters.update(resource, id, body)
