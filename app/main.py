"""FastAPI application: same routes, bodies and errors as the NestJS API it replaces (D48, docs/FASTAPI-PORT.md).

Run: `uvicorn app.main:app --port 3001` (during the port; :3000 after cut-over)."""

import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.adapters.payment import gateway as mock_payu_gateway
from app.adapters.simulator import router as simulator
from app.container import container
from app.contracts import openapi
from app.core.billing import router as billing
from app.core.booking import router as booking
from app.core.dispatch import router as dispatch
from app.core.fitment import router as fitment
from app.core.inventory import router as inventory
from app.core.masters import router as masters
from app.core.order_intake import router as order_intake
from app.core.oversight import router as oversight
from app.core.pricing import router as pricing
from app.core.production import router as production
from app.core.rejection import router as rejection
from app.platform import health
from app.platform.http import errors
from app.platform.http.json import ApiResponse
from app.platform.http.middleware import ContextMiddleware
from app.utility.approvals import router as approvals
from app.utility.audit import router as audit
from app.utility.configuration import router as configuration
from app.utility.documents import router as documents
from app.utility.file_storage import router as files
from app.utility.identity import router as identity
from app.utility.import_export import router as imports
from app.utility.integration_hub import router as integration_hub
from app.utility.notification import router as notifications
from app.utility.payments import router as payments
from app.utility.reporting import router as reporting
from app.utility.scheduling import router as scheduling
from app.utility.tickets import router as tickets
from app.utility.wallet import router as wallets

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
    openapi.install(app)

    api = APIRouter(prefix=API_PREFIX)
    for module in (
        health,
        identity,
        configuration,
        audit,
        integration_hub,
        notifications,
        files,
        payments,
        wallets,
        scheduling,
        documents,
        imports,
        approvals,
        tickets,
        reporting,
        masters,
        pricing,
        inventory,
        booking,
        production,
        dispatch,
        rejection,
        fitment,
        billing,
        oversight,
        simulator,
    ):
        api.include_router(module.router)
    for r in (order_intake.orders_router, order_intake.oem_router, order_intake.oem_vehicles_router):
        api.include_router(r)
    app.include_router(api)
    # The mock gateway's pages live outside /api/v1, as in the NestJS app.
    app.include_router(mock_payu_gateway.router)
    return app


app = create_app()
