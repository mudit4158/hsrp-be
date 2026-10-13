"""Route class every router uses. It runs the same request pipeline as the NestJS app, in the same order:
throttling → authentication and permissions (guards) → audit and idempotency (interceptors) → validation and the
handler. Results are converted with to_jsonable before FastAPI's own encoder (which would write datetimes with
'+00:00' and cannot read ORM rows)."""

import functools
import hashlib
import inspect
import json
import re
import threading
import time
from collections import deque
from collections.abc import Callable
from typing import Any

import jwt
from fastapi import APIRouter
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.requests import Request
from starlette.responses import Response

from app.platform.config import env
from app.platform.context import Actor, request_context
from app.platform.http import decorators as d
from app.platform.http.json import ApiResponse, to_jsonable
from app.platform.http.problem import Problem
from app.platform.registry import services

AUDIT_SKIP = {"/api/v1/auth/login"}
MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
DEFAULT_THROTTLE = (600, 60)


def _wrap(endpoint: Callable[..., Any], status_code: int) -> Callable[..., Any]:
    if getattr(endpoint, "__hsrp_wrapped__", False):
        return endpoint

    def encode(result: Any) -> Any:
        if isinstance(result, Response):
            return result
        if result is None:
            # NestJS sent an empty body for handlers that return nothing.
            return Response(status_code=status_code)
        return to_jsonable(result)

    # functools.wraps keeps __wrapped__ (FastAPI reads the endpoint's own signature) and the route metadata.
    if inspect.iscoroutinefunction(endpoint):

        @functools.wraps(endpoint)
        async def run_async(*args: Any, **kwargs: Any) -> Any:
            return encode(await endpoint(*args, **kwargs))

        wrapped: Callable[..., Any] = run_async
    else:

        @functools.wraps(endpoint)
        def run(*args: Any, **kwargs: Any) -> Any:
            return encode(endpoint(*args, **kwargs))

        wrapped = run
    wrapped.__hsrp_wrapped__ = True  # type: ignore[attr-defined]
    return wrapped


class _Throttle:
    def __init__(self) -> None:
        self._hits: dict[tuple[str, str], deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: tuple[str, str], limit: int, ttl_s: int) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits.setdefault(key, deque())
            while q and q[0] <= now - ttl_s:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True


_throttle = _Throttle()


def _check(required: list[str], have: list[str]) -> None:
    if not required or "*" in have or any(p in have for p in required):
        return
    raise Problem.forbidden(f"Needs permission: {' or '.join(required)}")


class ApiRoute(APIRoute):
    def __init__(self, path: str, endpoint: Callable[..., Any], **kwargs: Any) -> None:
        methods = {m.upper() for m in (kwargs.get("methods") or ["GET"])}
        if kwargs.get("status_code") is None:
            kwargs["status_code"] = 201 if "POST" in methods else 200
        super().__init__(path, _wrap(endpoint, kwargs["status_code"]), **kwargs)
        # Express-style route path ("/api/v1/orders/:id") for audit actions and idempotency scopes, as NestJS wrote them.
        self.express_path = re.sub(r"\{(\w+)(:[^}]*)?\}", r":\1", self.path)

    def get_route_handler(self) -> Callable[[Request], Any]:
        handle = super().get_route_handler()
        endpoint = self.endpoint

        async def pipeline(request: Request) -> Response:
            limit, ttl = d.meta(endpoint, d.THROTTLE, DEFAULT_THROTTLE)
            ip = request_context.get().ip or ""
            if not _throttle.hit((self.express_path, ip), limit, ttl):
                raise Problem(429, "Throttler", "ThrottlerException: Too Many Requests", "rate-limited")

            await self._authenticate(request)

            response = await self._idempotent(request, handle) if d.meta(endpoint, d.IDEMPOTENT) else await handle(request)

            if request.method in MUTATING and request.url.path not in AUDIT_SKIP and response.status_code < 400:
                await self._audit(request)
            return response

        return pipeline

    async def _authenticate(self, request: Request) -> None:
        container = services()
        is_public = bool(d.meta(self.endpoint, d.PUBLIC))
        required: list[str] = d.meta(self.endpoint, d.PERMISSIONS) or []

        if d.meta(self.endpoint, d.API_CLIENT):
            raw = await request.body()
            tenant_id, actor = await run_in_threadpool(
                container.api_clients.authenticate, request.headers.get("x-api-key"), request.headers.get("x-signature"), raw
            )
            request_context.set(tenant_id=tenant_id, actor=actor)
            _check(required, actor.permissions)
            return

        header = request.headers.get("authorization") or ""
        if header.startswith("Bearer "):
            try:
                claims = jwt.decode(header[7:], env.jwt_secret, algorithms=["HS256"])
            except jwt.PyJWTError:
                if is_public:
                    return
                raise Problem.unauthorized("Session expired or invalid. Sign in again.") from None
            dev = claims.get("dev")
            if dev:
                if request.headers.get("x-device-id") != dev:
                    raise Problem.unauthorized("This session is bound to another device")
                await run_in_threadpool(container.devices.assert_active, claims["tid"], claims["sub"], dev)
            request_context.set(
                tenant_id=claims["tid"],
                device_id=dev,
                actor=Actor(
                    id=claims["sub"],
                    type=claims["kind"],
                    name=claims.get("name"),
                    roles=claims.get("roles") or [],
                    permissions=claims.get("perms") or [],
                    org_id=claims.get("org"),
                    claims=claims.get("claims"),
                ),
            )
            _check(required, claims.get("perms") or [])
            return

        if is_public:
            return
        raise Problem.unauthorized()

    async def _idempotent(self, request: Request, handle: Callable[[Request], Any]) -> Response:
        idem = services().idempotency
        key = (request.headers.get("idempotency-key") or "").strip()
        if not key:
            raise Problem.bad_request("Idempotency-Key header is required for this request", "idempotency-key-required")
        if len(key) > 100:
            raise Problem.bad_request("Idempotency-Key is too long", "idempotency-key-invalid")

        scope = f"{request_context.actor_id() or 'anonymous'}:{request.method}:{self.express_path}"
        request_hash = await _request_hash(request)
        begin = await run_in_threadpool(idem.begin, scope, key, request_hash)
        if begin.state == "replay":
            replay: Response = Response(status_code=begin.code) if begin.body is None else ApiResponse(begin.body, status_code=begin.code)
            replay.headers["Idempotent-Replayed"] = "true"
            return replay
        try:
            response: Response = await handle(request)
        except BaseException:
            await run_in_threadpool(idem.abort, scope, key)
            raise
        body = json.loads(response.body) if getattr(response, "body", b"") else None
        await run_in_threadpool(idem.complete, scope, key, response.status_code, body)
        return response

    async def _audit(self, request: Request) -> None:
        params = dict(request.path_params)
        try:
            await run_in_threadpool(
                services().audit.record,
                f"http.{request.method.lower()} {self.express_path}",
                "http",
                params.get("id") or params.get("orderId") or params.get("code"),
                None,
                {"params": params, "status": "ok"},
            )
        except Exception:  # auditing the HTTP call must never fail the request
            pass


async def _request_hash(request: Request) -> str:
    """Path params, body and uploaded file names and sizes (a multipart body's boundary differs on every retry)."""
    ctype = request.headers.get("content-type", "")
    body: Any = None
    files: list[list[Any]] = []
    if ctype.startswith("multipart/form-data") or ctype.startswith("application/x-www-form-urlencoded"):
        form = await request.form()
        body = {}
        for k, v in form.multi_items():
            if isinstance(v, UploadFile):
                files.append([k, v.filename, v.size])
            else:
                body[k] = v
    else:
        raw = await request.body()
        if raw:
            try:
                body = json.loads(raw)
            except ValueError:
                body = raw.decode("utf-8", "replace")
    data = json.dumps({"p": dict(request.path_params), "b": body, "f": files}, separators=(",", ":"), default=str)
    return hashlib.sha256(data.encode()).hexdigest()


class Router(APIRouter):
    """APIRouter whose routes use ApiRoute and inherit router-level metadata (a route's own value wins)."""

    def __init__(self, *, defaults: dict[str, Any] | None = None, **kwargs: Any) -> None:
        super().__init__(route_class=ApiRoute, **kwargs)
        self._defaults = defaults or {}

    def add_api_route(self, path: str, endpoint: Callable[..., Any], **kwargs: Any) -> None:
        for name, value in self._defaults.items():
            if not hasattr(endpoint, name):
                setattr(endpoint, name, value)
        super().add_api_route(path, endpoint, **kwargs)


def router(prefix: str = "", tags: list[str] | None = None, *, public: bool | None = None, perms: list[str] | None = None, api_client: bool | None = None) -> Router:
    defaults: dict[str, Any] = {}
    if public is not None:
        defaults[d.PUBLIC] = public
    if perms is not None:
        defaults[d.PERMISSIONS] = perms
    if api_client is not None:
        defaults[d.API_CLIENT] = api_client
    return Router(prefix=prefix, tags=tags or [], defaults=defaults)
