# Backend port to Python (FastAPI)

**Last updated:** 13 Oct 2026

The backend moves from NestJS (TypeScript) to FastAPI (Python) with **the same REST API and the same PostgreSQL
schema**, so hsrp-fe and hsrp-mobile-app keep working unchanged (decision D48, user choice "rewrite, same API").
NestJS stays the running backend until the Python one passes the same acceptance checks; then the TypeScript
backend code is removed in one commit.

## Target stack

| Concern | NestJS today | Python |
| --- | --- | --- |
| Web framework | NestJS 10 | FastAPI, Uvicorn |
| Validation, contracts | zod (`packages/contracts`) | Pydantic v2 models; the web app generates its TypeScript types from FastAPI's OpenAPI |
| Database access | Prisma 6 | SQLAlchemy 2 (sync, psycopg 3), one models file per owning module |
| Migrations | Prisma migrations | Alembic; the baseline revision applies the existing SQL, so the schema stays identical |
| Outbox, retries, scheduler | in-process worker | same design, in-process thread when `WORKER_ENABLED=true` |
| Auth | JWT, scrypt passwords, device binding, HMAC API clients | same algorithms (PyJWT, hashlib.scrypt, hmac), so existing tokens and passwords keep working |
| PDFs | pdfkit + layout DSL | ReportLab + the same layout DSL (templates stay data) |
| OCR | tesseract.js | Tesseract via pytesseract (installed in the Docker image); `OCR_ADAPTER=mock` elsewhere |
| Architecture checks | dependency-cruiser, table ownership script | import-linter contracts, the same ownership rule in Python |
| Unit tests | Jest | pytest |
| Acceptance | `pnpm demo:e2e`, `pnpm sim` | unchanged: they call the HTTP API, so they run against either backend |

## Layout (during the port)

```
app/            Python backend: platform/, utility/, core/, adapters/, seed/ (mirrors src/)
alembic/        migrations (baseline = current schema)
tests/          pytest
pyproject.toml
src/, prisma/   NestJS backend, removed at cut-over
sim/, scripts/  acceptance tooling (TypeScript), kept
```

During the port the Python API runs on port 3001 against its own database (`hsrp_py`), so the two backends never
share an outbox. `API_BASE_URL=http://localhost:3001 pnpm demo:e2e` runs the acceptance flows against it.

## Phases and gates

| Phase | Scope | Done when |
| --- | --- | --- |
| P0 Scaffold | pyproject, app skeleton, settings, database session, SQLAlchemy models for all 75 tables, Alembic baseline, health route | `GET /api/v1/health` answers; Alembic builds the same schema as Prisma (schema diff empty) |
| P1 Platform | request context, JWT and API-client auth, permissions, RFC 7807 errors, idempotency, audit, pagination, outbox and worker, scheduler | unit tests for each |
| P2 Utilities | identity, configuration, audit, integration hub, notification, file storage, payments, wallet, scheduling, documents, import/export, approvals, tickets, reporting | unit tests ported from Jest |
| P3 Adapters | mock VAHAN, OEM, PayU (and its gateway pages), messaging, file store, OCR, simulator endpoints | — |
| P4 Core | masters, pricing, inventory, order intake and OEM data, booking, production, dispatch, rejection, fitment, billing, oversight and reports (the customer portal stays detached, D37) | — |
| P5 Seed and parity | seed and upgrades, Dockerfile for the Python API, OpenAPI-generated contracts for the web app | `demo:e2e` all flows pass and `pnpm sim` all cases pass against the Python API; pytest green |
| P6 Cut-over | Python API on port 3000 in Docker Compose; NestJS code, Prisma and the contracts package removed; docs updated | the same checks pass from a fresh database |

Progress is tracked in `docs/TRACKER.md` (item N-12).

## Progress

| Phase | Status | Notes |
| --- | --- | --- |
| P0 Scaffold | Done (13 Oct 2026) | Alembic revisions 0001–0005 replay the Prisma migration SQL; `pg_dump -s` of `hsrp_py` equals the Prisma-built `hsrp`. The 75 generated models compare clean against it (pytest `test_models_match_the_migrated_schema`). Health and unknown-route problem bodies match NestJS byte for byte. |
| P1 Platform | Done (13 Oct 2026) | Request pipeline in `ApiRoute` (throttle → auth → idempotency → handler → audit, the NestJS guard/interceptor order), JWT HS256 with the same claims and secret, device binding, HMAC API clients, pagination, outbox event bus and scheduler threads, integration monitor routes. Event-bus Jest spec ported; 21 pytest tests. |
| P2 Utilities | Done (13 Oct 2026) | identity, configuration, audit, notification, file storage, payments, wallet, scheduling, documents (PDF layout DSL on ReportLab), import/export, approvals, tickets, reporting; the mock PayU adapter and gateway pages were pulled forward from P3. Every utility route matches NestJS (`scripts/route_parity.py`). Wallet Jest spec ported (incl. concurrent holds); 42 pytest tests. Not ported: the OTP service and customer tokens, used only by the detached customer portal (D37). |
| P3 Adapters | Done (13 Oct 2026) | mock VAHAN, OEM order source and catalogue, mock state, simulator endpoints; OCR with the Tesseract binary through pytesseract (greyscale + block layout reads 40/40 simulator plates; the Windows installer path is found automatically) |
| P4 Core | Done (13 Oct 2026) | masters, pricing, inventory, order intake (order service, state machine, validation flow, OEM intake and vehicle data), booking, production with plate OCR, dispatch, rejection, fitment, postpaid billing, oversight and all reports. All 142 NestJS routes exist in FastAPI (`scripts/route_parity.py`). Pure-rule and allocation Jest specs ported; 67 pytest tests. |
| P5 Seed and parity | In progress | Seed ported (`python -m app.seed.run`: same fixtures as `app/seed/fixtures.json`, mulberry32 generator bit-identical, so the same fictional vehicles; upgrades D42/D46/D47). **`pnpm demo:e2e` passes 14/14 against the Python API** (`API_BASE_URL=http://localhost:3001`). OCR tuned on real headless-Chrome plate photos: crop the white plate, white out the IND strip, read one line (10/10), full photo as fallback. Also: `Dockerfile.python` (Tesseract installed; the entrypoint stamps a Prisma-built database at Alembic 0005 instead of recreating it, then seeds and starts Uvicorn); demo:e2e 14/14 against that container on the NestJS-built database. Contracts: enums and request models published in the OpenAPI document and exported to `openapi.json`; the web app generates `src/contracts/index.ts` from it. Next: `pnpm sim`, then cut-over. |

## Running the Python API (during the port)

From the repo root, with the Compose database up (`docker compose up -d db`):

```bash
python -m venv .venv && .venv/Scripts/pip install -e ".[dev]"   # once (Python 3.12+)
.venv/Scripts/alembic upgrade head                               # migrate PY_DATABASE_URL (create the hsrp_py database first)
.venv/Scripts/python -m app.seed.run                             # seed it (SEED_PASSWORD from .env; SEED_RESET=true to wipe)
.venv/Scripts/python scripts/export_openapi.py                   # after a route/model/enum change: openapi.json for the web app
.venv/Scripts/uvicorn app.main:app --reload --port 3001          # API on :3001, docs at /api/docs
.venv/Scripts/python -m pytest                                   # tests (builds hsrp_py_test from scratch)
.venv/Scripts/lint-imports                                       # architecture rule 1
.venv/Scripts/ruff check app tests alembic
```

While both backends run, any `PY_<NAME>` variable overrides `<NAME>` for the Python API only. `.env` sets
`PY_DATABASE_URL` (database `hsrp_py`), `PY_API_PORT=3001` and `PY_PUBLIC_API_URL` / `PY_INTERNAL_API_URL`
(`http://localhost:3001`, so the mock gateway's pages and webhooks come back to the Python API).
`.venv/Scripts/python scripts/route_parity.py` lists the NestJS routes the Python API does not have yet (both running).
Create the database once with `docker compose exec db psql -U hsrp -d postgres -c "CREATE DATABASE hsrp_py"`.

## Porting notes

- **Models** come from `scripts/prisma_to_sqlalchemy.py` (one `models.py` per owning module, attributes in
  snake_case, Prisma index names including its 63-character trimming, the two partial indexes of `0002_rules`). Re-run
  it if a Prisma schema file changes before cut-over; afterwards the models are edited by hand and the script goes.
- **JSON**: routers are built with `app.platform.http.routing.router()`; its route class converts results with
  `to_jsonable` (ORM rows → camelCase dicts, datetimes → `toISOString()` form with milliseconds and `Z`) before
  FastAPI's own encoder runs. Request bodies extend `ApiModel` (camelCase aliases).
- **Errors**: raise `Problem` (same factories as NestJS). Validation errors are 400 `validation` with
  `errors[{path, message}]`; unique violations 409 `duplicate`; unmatched routes 404 `http` "Cannot METHOD path",
  as Express answered.
- **Transactions**: `get_db().tx()` is one transaction with after-commit hooks (PrismaService `tx()`); services take
  an optional session and use `db.use(s)` to join the caller's transaction. Serial columns (`seq`) are
  `server_default=FetchedValue()` and Json columns `JSONB(none_as_null=True)`, so INSERTs behave as Prisma's did.
- **Routes**: `router(prefix, tags, perms=[...], public=..., api_client=...)` from `app.platform.http.routing`;
  per-route metadata with the decorators in `app.platform.http.decorators` (`@public`, `@require(...)`,
  `@idempotent`, `@api_client_auth`, `@throttle(limit, ttl_s)`) placed under the router decorator. A route's own
  value overrides the router's (NestJS `getAllAndOverride`). POST answers 201 unless the route passes
  `status_code=200` (NestJS `@HttpCode`). Audit actions and idempotency scopes use the Express-style path
  (`/api/v1/orders/:id`), as NestJS wrote them.
- **Services**: built once in `app/container.py` (the composition root). Modules reach them through
  `app.platform.registry.services()`, never by importing the container (it imports every layer, which would break
  the import-linter contracts).
- **Contracts**: shared enums live in `app/contracts/enums.py` (`CONSTANTS` names the web app's constant), request
  models in `app/contracts/schemas.py`. `app/contracts/openapi.py` adds both to the OpenAPI document;
  `scripts/export_openapi.py` writes `openapi.json` (committed; pytest fails when it is stale) and the web app's
  `pnpm contracts:sync` generates `src/contracts/index.ts` from it.
- **Lists**: `q: Page = Depends(page_query)`, then `paginate(s, stmt, q)`; other query parameters are in
  `q.get(name)` (FilteredPageQuery).
- **Cross-module queries**: a module reads another module's records through that module's service, passing plain
  filters (`app.platform.db.filters`, e.g. `orders.find({"status": "ISSUED", "station_id": sid})`), never its models.
- **Uploads**: routers read multipart files and pass `app.core.shared.uploads.Photo` to the service; sync services
  called from async routes run in the thread pool (`run_in_threadpool`).
- **Worker**: the event bus and the scheduler run as daemon threads started in the app lifespan when
  `WORKER_ENABLED=true`; subscribers and jobs are plain functions run as the system actor.

