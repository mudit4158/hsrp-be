# AGENTS.md — hsrp-be

**Last updated:** 13 Oct 2026

Guidance for anyone (human or coding agent) working in this repository. Read it before changing anything, and keep it
true: if you change how the repo is built, run, structured or tested, update this file in the same commit.

## What this repo is

The backend of the **HSRP Dealer Management System prototype**: a NestJS API with PostgreSQL (Prisma), the in-process
worker (outbox, retries, scheduled jobs), mock adapters for every external system, the seed data, the acceptance
script `pnpm demo:e2e`, and the shared request/response **contracts**. It is also the home of the system-wide
**decision log** (`docs/DECISIONS.md`) and the system tracker (`docs/TRACKER.md`).

Sibling repos (checked out next to this one under `C:\workspace\hsrp\`):

| Repo | What | Talks to this repo through |
| --- | --- | --- |
| `hsrp-fe` | Web app (staff and dealer screens; customer portal code detached) | REST `/api/v1`, mock gateway `/mock-gateway` |
| `hsrp-mobile-app` | Dealer Android app | REST `/api/v1` |

Design background: the [High-Level Design](https://claude.ai/code/artifact/d7fce61b-0fe9-4bae-a8b2-7286684b9de4)
(a Claude Doc). Its "Prototype defaults and decision log" table is mirrored in `docs/DECISIONS.md`; when they
disagree, the HLD wins.

## Layout

```
src/
  main.ts, app.module.ts   bootstrap and composition root (platform → utility → adapters → core)
  platform/                env, Prisma service + tx(), request context (tenant, actor, IP, device), auth guard,
                           RFC 7807 errors, idempotency + audit interceptors, worker/scheduler
  utility/                 generic modules with NO HSRP knowledge: identity, configuration, audit, integration-hub
                           (outbox/event bus, idempotency, call log), notification, file-storage, payments, wallet,
                           scheduling, documents, import-export, approvals, tickets, reporting
  core/                    HSRP modules: masters, pricing, inventory, order-intake, booking, production, dispatch,
                           rejection, fitment, billing (postpaid, D46), customer-portal (DETACHED, D37), oversight;
                           core/ports = interfaces
  adapters/                one folder per external system (mock + empty real placeholder) + the simulator
  seed/                    fictional seed data (run.ts, fixtures.ts, vehicles.ts)
prisma/schema/             one .prisma file per owning module; first line "// owner: <folder>"; migrations/ inside
packages/contracts/        shared enums, zod request schemas, event names (the FE keeps a synced copy)
scripts/                   demo-e2e.ts, check-module-tables.cjs, docs-check.mjs, with-env.cjs
sim/                       on-screen simulator (`pnpm sim`): core/ (browser + phone drivers, overlay, API helper),
                           scenes/ (reusable steps), cases/ (one file per end-to-end test case, run order in index.ts)
test/                      Jest setup (test database) and helpers
docs/                      DECISIONS.md (system-wide), TRACKER.md (system + backend), SIMULATION.md (test cases, run plan),
                           FASTAPI-PORT.md (the Python port: plan, progress, how to run it)
app/                       FastAPI backend being ported (D48): platform/, utility/, core/, adapters/ mirroring src/;
                           generated SQLAlchemy models in each module's models.py
alembic/                   Python migrations; 0001–0005 replay the Prisma migration SQL (alembic/sql/)
tests/                     pytest for the Python backend (test/ is Jest for the NestJS one)
pyproject.toml             Python dependencies, ruff, pytest and import-linter (architecture rule 1) settings
.claude/skills/            maintain-docs skill
.githooks/                 pre-commit (docs-check, architecture check)
```

## Commands

Run from the repo root. Needs Node 20+ (tested on 22 and 24), pnpm 9, Docker Desktop.

| Command | What it does |
| --- | --- |
| `pnpm install` | Install dependencies; also enables the git hooks (`prepare` sets `core.hooksPath=.githooks`) |
| `docker compose up --build` | Start PostgreSQL + API; migrates and seeds on start. API on :3000, DB on :5433 |
| `docker compose up -d db` | Only the database (for local development and tests) |
| `pnpm prisma:generate` | Generate the Prisma client (needed after install and after schema changes) |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL` (reads `.env`) |
| `pnpm db:sql` | Print the full schema as SQL (helper when writing a migration) |
| `pnpm seed` | Seed fictional demo data (skips if data exists unless `SEED_RESET=true`) |
| `pnpm seed:prod` | Same, from the compiled build (used by the Docker entrypoint) |
| `pnpm dev` | API with watch mode on :3000 (worker included when `WORKER_ENABLED=true`) |
| `pnpm build` | Build contracts, run the architecture checks, compile to `dist/` |
| `pnpm contracts:build` | Build only `packages/contracts` |
| `pnpm lint:deps` | Architecture checks: dependency direction (dependency-cruiser) + module table ownership |
| `pnpm test` | Unit tests (Jest). DB tests use the `hsrp_test` database on the Compose PostgreSQL (start `db` first) |
| `pnpm demo:e2e` | Acceptance flows A–Q against a running API (`API_BASE_URL`, default http://localhost:3000) |
| `pnpm docs:check` | Documentation and consistency checks (also run by the pre-commit hook) |
| `pnpm sim` | On-screen simulator: runs the end-to-end test cases of `docs/SIMULATION.md` in Chrome and on the emulator (`--case`, `--from`, `--kind`, `--speed`, `--pace`, `--manual`, `--list`) |
| `pnpm sim:check` | Type-check the simulator |

Demo users: `admin`, `ops`, `station.kol`, `station.bbs`, `dealer.wb01`, `dealer.od02`; password = `SEED_PASSWORD`
in `.env`. **Never print, log or commit `SEED_PASSWORD` or other secrets.**

### Python backend (port in progress, D48)

Needs Python 3.12+. Commands and the porting conventions are in `docs/FASTAPI-PORT.md`; in short `.venv/Scripts/uvicorn
app.main:app --port 3001`, `.venv/Scripts/python -m pytest`, `.venv/Scripts/lint-imports`, `.venv/Scripts/alembic
upgrade head`. It uses `PY_DATABASE_URL` (database `hsrp_py`) so it never shares an outbox with the NestJS API.

## Architecture rules (must hold — the build enforces 1 and 7)

1. **One-way dependencies.** `core` may import `utility`; `utility` never imports `core` or `adapters`; `core` never
   imports `adapters` (only `core/ports`). Checked by `.dependency-cruiser.cjs`; `src/platform/boundaries.spec.ts`
   proves the check fails on a violation.
2. **Generic references.** Utilities identify what they act on by `subjectType` + `subjectId` strings. No foreign keys
   from utility tables into core tables.
3. **Events before direct calls.** State changes publish events through `EventBus.publish(tx, …)` in the same
   transaction (transactional outbox). Subscribers run from the outbox with retries.
4. **Ports and adapters.** Core depends on interfaces (`VehicleRegistry`, `OrderSource`, `OemVehicleCatalog`,
   `PaymentProvider`, `MessageSender`, `FileStore`, `PlateReader`). Adapters are chosen by `*_ADAPTER` env vars (mock/db,
   plus the real local OCR `OCR_ADAPTER=tesseract`, D45).
5. **Configuration over code.** Prices, validation steps, rule packs, cut-off date, photo rules, slot capacity,
   templates, print layouts and number sequences are data (`util_config_setting`, templates, masters).
6. **External calls never inside a user request.** VAHAN, OEM callbacks, payment verify/refund, SMS and e-mail run
   from the outbox (`subscribe(...)` handlers) with back-off; exhausted calls go to the dead-letter queue.
7. **Each module owns its tables.** Prisma schema files declare their owner; `scripts/check-module-tables.cjs` fails if
   code touches another module's model or table. Read across modules through the owning module's service.

## Conventions

- Every table has `tenant_id`, `created_at`, `updated_at`. Get the tenant and actor from `requestContext`.
- Errors: throw `Problem` (RFC 7807). Lists: paginated (`page`, `pageSize`) and filterable.
- `@Idempotent()` (requires `Idempotency-Key`) on order creation, payments/top-ups, fitment and inward.
- Order status changes only through `OrderService.transition()` (guards the state machine, writes history, publishes
  events). Add new transitions to `order-state-machine.ts` and its spec, and record a decision.
- Schema change → new migration folder in `prisma/schema/migrations/` (generate SQL with `pnpm db:sql` or
  `prisma migrate diff`); custom SQL (partial indexes, triggers) goes in a migration too. The hook blocks a schema
  change without a migration.
- Contract change (`packages/contracts`) → also run `pnpm contracts:sync` in `hsrp-fe` and commit there; update
  the Kotlin models in `hsrp-mobile-app` (`app/.../data/Api.kt`) if the Android app uses the changed endpoint.
- Seed and fixtures: fictional and obviously fake only. No real people, phone numbers or vehicles.
- Seed upgrades: the seed only runs fully on an empty database. Additive changes for existing databases go in
  `upgrade()` in `src/seed/run.ts`, guarded by their own marker (e.g. the import profile they add).
- New end-to-end behaviour → add or extend a simulator case (`sim/cases`, built from `sim/scenes`) and its section
  in `docs/SIMULATION.md`; keep `pnpm demo:e2e` as the fast API-level regression.
- Simulator selectors use visible labels and button names; when you rename a label or button the simulator
  clicks, update `sim/scenes` in the same change (run `pnpm sim --case <id>` to check).
- Comments: explain why, not what; match the surrounding style. Commit messages: imperative summary + body.

## Safety

- Never call real VAHAN, PayU, SMS, e-mail or OEM endpoints. All adapters stay `mock`.
- Never push or create remotes without explicit confirmation from the user. Nothing is pushed today.
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
| API contracts | FE copy via `pnpm contracts:sync` (in hsrp-fe); Android models if affected |
| A flow in the click-through | `README.md` section "Click-through" and `scripts/demo-e2e.ts` |

`pnpm docs:check` (and the pre-commit hook) enforces the mechanical part: required files, review dates, unique tracker
IDs and valid statuses, continuous decision numbers, every package script documented, migration present for schema
changes. It warns when code changes without any doc change.

## Gotchas

- Inside containers use `127.0.0.1`, not `localhost` (Alpine resolves `localhost` to IPv6 first; the API binds IPv4).
- Outbox due times are compared with the Node clock, not the database's `now()` (Docker VM clock can lag).
- The database for local runs and tests is on port **5433** (not 5432).
- dependency-cruiser 16 does not run on Node 24; keep 17.x.
- Jest timeout is 30 s because DB tests truncate ~70 tables before each test.
- `pnpm demo:e2e` consumes demo vehicles; after many runs reseed (`docker compose down -v` or `SEED_RESET=true`).
- The customer portal is detached (D37): `/api/v1/public/*` returns 404 by design; flows D and K are skipped.
- `pnpm sim` needs the emulator running with the **debug** dealer app (its automation bridge answers on
  127.0.0.1:7777 through `adb forward`). It prepares fresh vehicles every run; each run uses ~26 plates and ~₹4,000
  of the WB01 wallet, so reseed after many runs.
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
- Python port: FastAPI's `jsonable_encoder` would turn datetimes into `+00:00` strings and cannot read ORM rows; build
  routers with `app.platform.http.routing.router()` so results go through `to_jsonable` first.
- Python port: a schema change before cut-over still goes through Prisma; then copy the migration SQL to
  `alembic/sql/`, add a revision that runs it, and re-run `scripts/prisma_to_sqlalchemy.py`.
- The tesseract model ships in `@tesseract.js-data/eng` (a runtime dependency); the worker starts on first use
  (~0.3 s) and reads a photo in ~0.1–1 s.

## Where things are tracked

- Open items and pending fixes: `docs/TRACKER.md` (start here when picking up work).
- Decisions: `docs/DECISIONS.md` (D1–D48) and the HLD.
- End-to-end test cases and run plan: `docs/SIMULATION.md`.
