"""Route metadata, the counterpart of the NestJS decorators. Put them under the router decorator:

    @r.post("/orders")
    @idempotent
    @require("orders.create")
    def create(...): ...

`router(..., perms=..., public=...)` sets the same metadata for every route of a router; a route's own value wins
(NestJS getAllAndOverride)."""

from collections.abc import Callable
from typing import Any

F = Callable[..., Any]

PUBLIC = "__hsrp_public__"
PERMISSIONS = "__hsrp_permissions__"
IDEMPOTENT = "__hsrp_idempotent__"
API_CLIENT = "__hsrp_api_client__"
THROTTLE = "__hsrp_throttle__"
NO_AUDIT = "__hsrp_no_audit__"


def public(fn: F) -> F:
    """No sign-in needed. A bearer token, if sent, is still read."""
    setattr(fn, PUBLIC, True)
    return fn


def require(*perms: str) -> Callable[[F], F]:
    """Caller needs at least one of these permission strings."""

    def mark(fn: F) -> F:
        setattr(fn, PERMISSIONS, list(perms))
        return fn

    return mark


def idempotent(fn: F) -> F:
    """Requires an `Idempotency-Key` header; a repeated key returns the first response instead of acting again."""
    setattr(fn, IDEMPOTENT, True)
    return fn


def api_client_auth(fn: F) -> F:
    """Authenticated by API key plus HMAC request signature (OEM systems)."""
    setattr(fn, API_CLIENT, True)
    return fn


def throttle(limit: int, ttl_s: int = 60) -> Callable[[F], F]:
    """At most `limit` calls per `ttl_s` seconds per client IP (default for every route: 600 a minute)."""

    def mark(fn: F) -> F:
        setattr(fn, THROTTLE, (limit, ttl_s))
        return fn

    return mark


def meta(fn: F, name: str, default: Any = None) -> Any:
    return getattr(fn, name, default)
