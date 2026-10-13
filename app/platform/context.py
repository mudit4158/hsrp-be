"""Request context: tenant, actor, IP, device and request id for the current request or background job."""

from collections.abc import Callable
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, TypeVar

from app.platform.config import env

T = TypeVar("T")


@dataclass
class Actor:
    id: str
    # user | customer | api-client | system
    type: str
    name: str | None = None
    roles: list[str] = field(default_factory=list)
    permissions: list[str] = field(default_factory=list)
    org_id: str | None = None
    # Free-form claims, e.g. the registration number a customer proved by OTP.
    claims: dict[str, Any] | None = None


@dataclass
class RequestContext:
    tenant_id: str
    actor: Actor | None = None
    ip: str | None = None
    device_id: str | None = None
    request_id: str | None = None


SYSTEM_ACTOR = Actor(id="system", type="system", name="System", roles=["SYSTEM"], permissions=["*"])

_ctx: ContextVar[RequestContext | None] = ContextVar("hsrp_request_context", default=None)


class _Ctx:
    def get(self) -> RequestContext:
        c = _ctx.get()
        if c is None:
            c = RequestContext(tenant_id=env.default_tenant_id)
            _ctx.set(c)
        return c

    def tenant_id(self) -> str:
        return self.get().tenant_id

    def actor(self) -> Actor | None:
        return self.get().actor

    def actor_id(self) -> str | None:
        a = self.get().actor
        return a.id if a else None

    def set(self, **patch: Any) -> None:
        """Mutates the current context (the auth dependency fills in the caller once authenticated)."""
        c = self.get()
        for k, v in patch.items():
            setattr(c, k, v)

    def start(self, ctx: RequestContext):
        """Opens a context for a request; returns the token to reset it."""
        return _ctx.set(ctx)

    def reset(self, token) -> None:
        _ctx.reset(token)

    def run(self, ctx: RequestContext, fn: Callable[[], T]) -> T:
        token = _ctx.set(ctx)
        try:
            return fn()
        finally:
            _ctx.reset(token)

    def run_as_system(self, tenant_id: str, fn: Callable[[], T]) -> T:
        """Runs `fn` as the system actor of the tenant (worker, scheduled jobs, event handlers)."""
        return self.run(RequestContext(tenant_id=tenant_id, actor=SYSTEM_ACTOR), fn)


request_context = _Ctx()
