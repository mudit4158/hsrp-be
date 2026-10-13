"""FastAPI application: same routes, bodies and errors as the NestJS API it replaces (D48, docs/FASTAPI-PORT.md).

Run: `uvicorn app.main:app --port 3001` (during the port; :3000 after cut-over)."""

import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.container import container
from app.platform import health
from app.platform.http import errors
from app.platform.http.json import ApiResponse
from app.platform.http.middleware import ContextMiddleware
from app.utility.integration_hub import router as integration_hub

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")

API_PREFIX = "/api/v1"


@asynccontextmanager
async def lifespan(app: FastAPI):
    c = container()
    c.start()
    try:
        yield
    finally:
        c.stop()


def create_app() -> FastAPI:
    container()
    app = FastAPI(
        lifespan=lifespan,
        title="HSRP Dealer Management System API",
        description="Prototype API. Errors are RFC 7807 problem JSON. Order, payment, fitment and inward calls need an Idempotency-Key header.",
        version="0.1.0",
        docs_url="/api/docs",
        openapi_url="/api/docs-json",
        redoc_url=None,
        default_response_class=ApiResponse,
    )
    app.add_middleware(ContextMiddleware)
    app.add_middleware(CORSMiddleware, allow_origin_regex=".*", allow_credentials=False, allow_methods=["*"], allow_headers=["*"], expose_headers=["x-request-id"])
    errors.install(app)

    api = APIRouter(prefix=API_PREFIX)
    for module in (health, integration_hub):
        api.include_router(module.router)
    app.include_router(api)
    return app


app = create_app()
