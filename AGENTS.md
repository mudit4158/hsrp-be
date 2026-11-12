# AGENTS.md — hsrp-be

**Last updated:** 12 Nov 2026

Guidance for anyone (human or coding agent) working in this repository. Read it before changing anything, and keep it
true: if you change how the repo is built, run, structured or tested, update this file in the same commit.

## What this repo is

The backend of the **HSRP Dealer Management System prototype**: a **FastAPI** API (Python 3.12+) with PostgreSQL
(SQLAlchemy 2 + Alembic), the in-process worker (outbox, retries, scheduled jobs), mock adapters for every external
system, the seed data, the acceptance script `pnpm demo:e2e`, the on-screen simulator `pnpm sim`, and the shared
**contracts** (published in the OpenAPI document, exported to `openapi.json`). It is also the home of the system-wide
**decision log** (`docs/DECISIONS.md`) and the system tracker (`docs/TRACKER.md`).

The backend was ported from NestJS to FastAPI with the same REST API and the same database schema (D48,
`docs/FASTAPI-PORT.md`); the NestJS code is in the git history before the cut-over commit.

Sibling repos (checked out next to this one under `C:\workspace\hsrp\`):

| Repo | What | Talks to this repo through |
| --- | --- | --- |
| `hsrp-fe` | Web app (staff and dealer screens; customer portal code detached) | REST `/api/v1`, mock gateway `/mock-gateway`; contracts generated from `openapi.json` |
| `hsrp-mobile-app` | Dealer Android app | REST `/api/v1` |

Design background: the [High-Level Design](https://claude.ai/code/artifact/d7fce61b-0fe9-4bae-a8b2-7286684b9de4)
(a Claude Doc). Its "Prototype defaults and decision log" table is mirrored in `docs/DECISIONS.md`; when they
disagree, the HLD wins.

## Layout

```
app/
  main.py                  FastAPI app: middleware, error handlers, routers under /api/v1, mock gateway, OpenAPI
  container.py             composition root: builds every service (platform → utility → adapters → core), adapters
                           chosen by *_ADAPTER, scheduled jobs; modules reach it through app.platform.registry
  platform/                config (env), request context, db (Database.tx(), filters, start-up migration), http
                           (request pipeline in routing.py, decorators, problems, JSON, pagination), worker
  utility/                 generic modules with NO HSRP knowledge: identity, configuration, audit, integration_hub
                           (outbox/event bus, idempotency, call log), notification, file_storage, payments, wallet,
                           scheduling, documents (PDF layout DSL on ReportLab), import_export, approvals, tickets,
                           reporting
  core/                    HSRP modules: masters, pricing, inventory, order_intake, booking, production, dispatch,
                           rejection, fitment, billing (postpaid, D46), oversight (dashboard, detail, reports);
                           core/ports.py = interfaces; core/shared = OCR rule, IST helpers, subject types
  adapters/                one folder per external system (mock + real placeholder) + the simulator endpoints
  contracts/               shared enums (enums.py), request models (schemas.py), OpenAPI additions (openapi.py)
  seed/                    fictional seed data: run.py, vehicles.py (deterministic generator), fixtures.json
  */models.py              each module's tables (SQLAlchemy); a module owns the models in its own folder
alembic/                   migrations; 0001–0005 replay the original SQL (alembic/sql/), later revisions are Python
tests/                     pytest (unit, service and API tests; the test database is built from scratch)
openapi.json               exported API description incl. contracts (the web app generates its types from it)
scripts/                   export_openapi.py, check_module_tables.py, demo-e2e.ts, docs-check.mjs
sim/                       on-screen simulator (`pnpm sim`): core/ (browser + phone drivers, overlay, API helper),
                           scenes/ (reusable steps), cases/ (one file per end-to-end test case, run order in index.ts)
docs/                      DECISIONS.md (system-wide), TRACKER.md (system + backend), SIMULATION.md (test cases, run
                           plan), FASTAPI-PORT.md (how the port was done, conventions)
.claude/skills/            maintain-docs skill
.githooks/                 pre-commit (docs-check; import-linter, table ownership and ruff when app/ is staged)
```

## Commands

Run from the repo root. Needs Python 3.12+, Node 20+ (tested on 22 and 24) with pnpm 9 for the tooling, Docker Desktop.
On Windows the virtualenv's programs are in `.venv/Scripts/`, elsewhere in `.venv/bin/`.

| Command | What it does |
| --- | --- |
| `docker compose up --build -d` | Start PostgreSQL + API; migrates and seeds on start. API on :3000, DB on :5433 |
| `docker compose up -d db` | Only the database (for local development and tests) |
| `python -m venv .venv` then `.venv/Scripts/pip install -e ".[dev]"` | Python environment (once) |
| `.venv/Scripts/alembic upgrade head` | Apply migrations to `DATABASE_URL` (reads `.env`) |
| `.venv/Scripts/python -m app.platform.db.migrate_on_start` | Same, but stamps a database built by the old NestJS backend first (what the container runs) |
| `.venv/Scripts/python -m app.seed.run` | Seed fictional demo data (skips if data exists, then applies upgrades; `SEED_RESET=true` wipes and reseeds) |
| `.venv/Scripts/uvicorn app.main:app --reload --port 3000` | API with reload on :3000 (worker included when `WORKER_ENABLED=true`); docs at /api/docs |
| `.venv/Scripts/python -m pytest` | Tests. DB tests use the `hsrp_py_test` database on the Compose PostgreSQL (start `db` first) |
| `.venv/Scripts/lint-imports` | Architecture rule 1 (dependency direction) |
| `.venv/Scripts/python scripts/check_module_tables.py` | Architecture rule 7 (module table ownership; also a pytest test) |
| `.venv/Scripts/ruff check app tests alembic scripts` | Lint |
| `.venv/Scripts/python scripts/export_openapi.py` | Write `openapi.json` after a route, request model or enum change (`--check` to verify) |
| `pnpm install` | Install the TypeScript tooling; also enables the git hooks (`prepare` sets `core.hooksPath=.githooks`) |
| `pnpm demo:e2e` | Acceptance flows A–Q against a running API (`API_BASE_URL`, default http://localhost:3000) |
| `pnpm docs:check` | Documentation and consistency checks (also run by the pre-commit hook) |
| `pnpm sim` | On-screen simulator: runs the end-to-end test cases of `docs/SIMULATION.md` in Chrome and on the emulator (`--case`, `--from`, `--kind`, `--speed`, `--pace`, `--manual`, `--list`) |
| `pnpm sim:check` | Type-check the simulator |

Demo users: `admin`, `ops`, `station.kol`, `station.bbs`, `dealer.wb01`, `dealer.od02`; password = `SEED_PASSWORD`
in `.env`. **Never print, log or commit `SEED_PASSWORD` or other secrets.**

## Architecture rules (must hold — the checks enforce 1 and 7)

1. **One-way dependencies.** `core` may import `utility`; `utility` never imports `core` or `adapters`; `core` never
   imports `adapters` (only `core/ports.py`). Checked by import-linter (`pyproject.toml`).
2. **Generic references.** Utilities identify what they act on by `subject_type` + `subject_id` strings. No foreign
   keys from utility tables into core tables.
3. **Events before direct calls.** State changes publish events through `EventBus.publish(s, …)` in the same
   transaction (transactional outbox). Subscribers run from the outbox with retries.
4. **Ports and adapters.** Core depends on interfaces (`VehicleRegistry`, `OrderSource`, `OemVehicleCatalog`,
   `PaymentProvider`, `MessageSender`, `FileStore`, `PlateReader`). Adapters are chosen by `*_ADAPTER` env vars
   (mock/db, plus the real local OCR `OCR_ADAPTER=tesseract`, D45) in `app/container.py`.
5. **Configuration over code.** Prices, validation steps, rule packs, cut-off date, photo rules, slot capacity,
   templates, print layouts and number sequences are data (`util_config_setting`, templates, masters).
6. **External calls never inside a user request.** VAHAN, OEM callbacks, payment verify/refund, SMS and e-mail run
   from the outbox (`bus.subscribe(...)` handlers) with back-off; exhausted calls go to the dead-letter queue.
7. **Each module owns its tables.** A module imports and queries only the models in its own `models.py`; it reads
   other modules' records through their services, passing plain filters (`app/platform/db/filters.py`) where needed.
   `scripts/check_module_tables.py` fails otherwise.

## Conventions

- Every table has `tenant_id`, `created_at`, `updated_at`. Get the tenant and actor from `request_context`.
- Errors: raise `Problem` (RFC 7807). Lists: paginated (`page`, `pageSize`) and filterable (`Depends(page_query)`).
- Routers come from `app.platform.http.routing.router(...)`; route metadata with the decorators in
  `app.platform.http.decorators` placed under the route decorator: `@public`, `@require(...)`, `@idempotent`
  (requires `Idempotency-Key`; on order creation, payments/top-ups, fitment and inward), `@api_client_auth`,
  `@throttle(limit, ttl_s)`. POST answers 201 unless the route passes `status_code=200`.
- JSON on the wire is camelCase with ISO timestamps (`...Z`); request models extend `ApiModel`; results go through
  `to_jsonable` (ORM rows become camelCase dicts).
- Services take an optional session `s` and use `self.db.use(s)` to join the caller's transaction.
- Order status changes only through `OrderService.transition()` (guards the state machine, writes history, publishes
  events). Add new transitions to `app/core/order_intake/state_machine.py` and its tests, and record a decision.
- Schema change → change the module's `models.py` **and** add an Alembic revision (`alembic revision --autogenerate
  -m "…"`, then review it); the pre-commit hook blocks a models change without a revision. pytest checks that the
  models and the migrated schema agree.
- Contract change (an enum in `app/contracts/enums.py`, a request model, a route) → run
  `scripts/export_openapi.py`, commit `openapi.json`, then `pnpm contracts:sync` in `hsrp-fe` and commit there;
  update the Kotlin models in `hsrp-mobile-app` (`app/.../data/Api.kt`) if the Android app uses the changed endpoint.
- Seed and fixtures: fictional and obviously fake only. No real people, phone numbers or vehicles.
- Seed upgrades: the seed only runs fully on an empty database. Additive changes for existing databases go in
  `upgrade()` in `app/seed/run.py`, guarded by their own marker (e.g. the import profile they add).
- New end-to-end behaviour → add or extend a simulator case (`sim/cases`, built from `sim/scenes`) and its section
  in `docs/SIMULATION.md`; keep `pnpm demo:e2e` as the fast API-level regression.
- Simulator selectors use visible labels and button names; when you rename a label or button the simulator
  clicks, update `sim/scenes` in the same change (run `pnpm sim --case <id>` to check).
- Comments: explain why, not what; match the surrounding style. Commit messages: imperative summary + body.

## Safety

- Never call real VAHAN, PayU, SMS, e-mail or OEM endpoints. All adapters stay `mock`.
- Never push or create remotes without explicit confirmation from the user. The three repos are private on GitHub
  (`github.com/mudit4158/hsrp-be`, `hsrp-fe`, `hsrp-mobile-app`, remote `origin`); every push still needs confirmation.
- Ask before anything irreversible (dropping volumes, deleting data, rewriting published history).

## Keeping documentation current (required)

Every change that affects behaviour, setup, commands, structure, decisions or open items must update the docs **in the
same commit**. Use the **maintain-docs** skill (`.claude/skills/maintain-docs/SKILL.md`); in short:

| You changed… | Update |
| --- | --- |
| Commands, scripts, env vars, ports, setup | `README.md`, this file, `.env.example` |
| Structure, conventions, rules, gotchas | this file |
| A design choice not covered by an existing decision | `docs/DECISIONS.md` (next Dnn) **and** the HLD decision log (append-only) |
| Fixed, found or deferred work | `docs/TRACKER.md` (or the FE / Android tracker if only that repo is involved) |
| API contracts | `openapi.json` here, then `pnpm contracts:sync` in hsrp-fe; Android models if affected |
| A flow in the click-through | `README.md` section "Click-through" and `scripts/demo-e2e.ts` |

`pnpm docs:check` (and the pre-commit hook) enforces the mechanical part: required files, review dates, unique tracker
IDs and valid statuses, continuous decision numbers, every package script documented, an Alembic revision for model
changes. It warns when code changes without any doc change.

## Gotchas

- Inside containers use `127.0.0.1`, not `localhost` (some images resolve `localhost` to IPv6 first; the API binds IPv4).
- Outbox due times are compared with the application clock, not the database's `now()` (Docker VM clock can lag).
- The database for local runs and tests is on port **5433** (not 5432).
- FastAPI's `jsonable_encoder` would turn datetimes into `+00:00` strings and cannot read ORM rows; build routers with
  `app.platform.http.routing.router()` so results go through `to_jsonable` first.
- Balances and other columns changed by UPDATE statements: load the row with `populate_existing=True` (the wallet does)
  so a cached ORM object is never trusted.
- Services that define a `list()` method use `from __future__ import annotations` (the method name shadows the builtin
  in later annotations).
- `pnpm demo:e2e` consumes demo vehicles; after many runs reseed (`docker compose down -v` or `SEED_RESET=true`).
- The customer portal is detached (D37): `/api/v1/public/*` returns 404 by design; flows D and K are skipped. Its code
  was not ported; it is in the git history (NestJS) if it is ever re-enabled.
- `pnpm sim` needs the emulator running with the **debug** dealer app (its automation bridge answers on
  127.0.0.1:7777 through `adb forward`). It prepares fresh vehicles every run; each run uses ~26 plates and ~₹4,000
  of the WB01 wallet, so reseed after many runs. A dealer app session older than 8 hours is refused (JWT expiry); the
  app signs in again.
- `pnpm demo:e2e` flow M and `pnpm sim` both replace the new-vehicle batch shown on the Simulator page.
- `pnpm demo:e2e` flows A–C, H–J use the seeded demo vehicle pools and use them up after many runs ("Not enough
  unused sample vehicles"); reseed then (`docker compose down -v` or `SEED_RESET=true`, which wipes the demo data).
- Billing (D46): payment mode, cycle, bill-to and contacts are settings (`billing.*`, scopes `oem` and `oem-dealer`
  "OEM:DEALER"), not columns. Order-flow and billing both read `billing.paymentMode`; keep them in step.
- Import profiles are stored as jsonb, which does not keep key order: give a profile `columnOrder` if its template
  column order matters (D47).
- Plate OCR (D45): QC "Pass" needs a passing plate photo per allocated plate, and fitment needs plate photos that
  read the order's number. `pnpm demo:e2e` therefore renders plate photos with headless Chrome
  (`sim/core/plate-image.ts`); Chrome must be installed. Turn either check off per state with the settings
  `production.plateOcrRequired` / `fitment.plateOcrRequired`.
- OCR uses the Tesseract program (installed in the Docker image; on Windows install it from UB Mannheim, the default
  path is found, or set `TESSERACT_CMD`). The reader crops the white plate and whites out the IND strip before reading;
  `OCR_ADAPTER=mock` reads the marker test images embed instead.

## Where things are tracked

- Open items and pending fixes: `docs/TRACKER.md` (start here when picking up work).
- Decisions: `docs/DECISIONS.md` (D1–D48) and the HLD.
- End-to-end test cases and run plan: `docs/SIMULATION.md`.
