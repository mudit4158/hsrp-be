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
| P0 Scaffold | pyproject, app skeleton, settings, database session, SQLAlchemy models for all 75 tables, Alembic baseline, Dockerfile, health route | `GET /api/v1/health` answers; Alembic builds the same schema as Prisma (schema diff empty) |
| P1 Platform | request context, JWT and API-client auth, permissions, RFC 7807 errors, idempotency, audit, pagination, outbox and worker, scheduler | unit tests for each |
| P2 Utilities | identity, configuration, audit, integration hub, notification, file storage, payments, wallet, scheduling, documents, import/export, approvals, tickets, reporting | unit tests ported from Jest |
| P3 Adapters | mock VAHAN, OEM, PayU (and its gateway pages), messaging, file store, OCR, simulator endpoints | — |
| P4 Core | masters, pricing, inventory, order intake and OEM data, booking, production, dispatch, rejection, fitment, billing, oversight and reports (the customer portal stays detached, D37) | — |
| P5 Seed and parity | seed and upgrades, OpenAPI-generated contracts for the web app | `demo:e2e` all flows pass and `pnpm sim` all cases pass against the Python API; pytest green |
| P6 Cut-over | Python API on port 3000 in Docker Compose; NestJS code, Prisma and the contracts package removed; docs updated | the same checks pass from a fresh database |

Progress is tracked in `docs/TRACKER.md` (item N-12).
