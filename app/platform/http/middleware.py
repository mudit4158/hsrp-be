"""Opens a request context (tenant, IP, device, request id) that services and the audit log read."""

import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.platform.config import env
from app.platform.context import RequestContext, request_context


class ContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        forwarded = request.headers.get("x-forwarded-for")
        ip = (forwarded.split(",")[0] if forwarded else (request.client.host if request.client else "")).strip()
        token = request_context.start(
            RequestContext(tenant_id=env.default_tenant_id, ip=ip, device_id=request.headers.get("x-device-id"), request_id=request_id)
        )
        try:
            response = await call_next(request)
        finally:
            request_context.reset(token)
        response.headers["x-request-id"] = request_id
        return response
