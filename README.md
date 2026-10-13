# hsrp-dms-be — HSRP Dealer Management System (backend)

Backend of the HSRP Dealer Management System prototype: order intake from dealers, OEMs and customers,
embossing-station production, dispatch, dealer inward, fitment with photos and the VAHAN post — with every external
system mocked. NestJS + Prisma + PostgreSQL, REST under `/api/v1`, OpenAPI at `/api/docs`.

All data is fictional. Nothing here contacts a real VAHAN, OEM, payment or SMS system.

| Repo | What |
| --- | --- |
| **hsrp-dms-be** (this) | API, database, worker, mocks, seed, acceptance script, shared contracts, decision log |
| [hsrp-dms-fe](../hsrp-dms-fe) | Web app (staff and dealer screens) |
| [hsrp-dms-android](../hsrp-dms-android) | Dealer Android app |

The three repos live side by side under `C:\workspace\hsrp\` (decision D38). Design background:
[High-Level Design](https://claude.ai/code/artifact/d7fce61b-0fe9-4bae-a8b2-7286684b9de4) ·
decisions: [docs/DECISIONS.md](docs/DECISIONS.md) · open items: [docs/TRACKER.md](docs/TRACKER.md) ·
working in the repo: [AGENTS.md](AGENTS.md).

> **Customer portal disabled (decision D37).** The portal's code is still here (`src/core/customer-portal`) and in the
> web repo, but it is detached: no `/api/v1/public/*` routes and the `CUSTOMER` role grants nothing. Customer orders,
> online payment and customer complaints (flows D and K) are not available. Re-enable steps: tracker item B-01.

## 1. Run the whole system

Prerequisites: Docker Desktop (Compose v2.24+). For the Android app also the Android SDK and JDK 17.

**Backend** (this repo):

```bash
cp .env.example .env
```

Set `SEED_PASSWORD` in `.env` (8+ characters; it becomes every demo user's password). Then:

```bash
docker compose up --build -d
```

This starts PostgreSQL and the API, applies migrations and seeds the demo data. API: http://localhost:3000/api/v1 ·
OpenAPI: http://localhost:3000/api/docs · PostgreSQL: localhost:5433.

**Web app**: in `../hsrp-dms-fe` run `docker compose up --build -d`, then open http://localhost:8080
(see that repo's README).

**Android app**: build and install from `../hsrp-dms-android` (see that repo's README). The emulator reaches this API at
`http://10.0.2.2:3000`.

**Demo sign-ins** (password = `SEED_PASSWORD` from `.env`):

| User | Role | Can do |
| --- | --- | --- |
| `admin` | Admin | Everything, including the simulator and integration monitor |
| `ops` | Operations | Orders, approvals, OEM files, wallets, complaints, masters, reports |
| `station.kol` | Station user, Kolkata (West Bengal) | Issuance, QC, stickers, challans, rejection approval |
| `station.bbs` | Station user, Bhubaneswar (Odisha) | Same, for Odisha |
| `dealer.wb01` | Dealer, Howrah Wheels (WB) | Web: place and track orders. Android: everything a dealer does |
| `dealer.od02` | Dealer, Kalinga Motors (OD) | Same |

OTPs (used only by the disabled portal) are real random codes shown on the web app's **Simulator → SMS & e-mail**; with
`DEMO_MODE=true` the fixed code `123456` is also accepted.

**Start over:** `docker compose down -v` then `docker compose up -d`, or set `SEED_RESET=true` in `.env` and restart `api`.

## 2. Check it

```bash
pnpm install
pnpm demo:e2e
```

`pnpm demo:e2e` runs flows A–L through the API against http://localhost:3000 (override with `API_BASE_URL`). Flows D and
K are reported as skipped while the portal is disabled; an extra check confirms the portal endpoints are gone. It is
re-runnable; after many runs the demo vehicle pools run out — reseed.

```bash
docker compose up -d db
pnpm test
```

Unit tests: order state machine, plate allocation, wallet ledger, outbox retry, validation and pricing rules, and the
dependency check itself. Database tests use a separate `hsrp_test` database on the Compose PostgreSQL.

```bash
pnpm lint:deps
pnpm docs:check
```

`pnpm lint:deps` enforces the architecture (dependency direction, module table ownership; also part of `pnpm build`).
`pnpm docs:check` checks the documentation (also run by the pre-commit hook; see section 6).

## 3. Develop without Docker for the API

Needs Node 20+ and pnpm 9 (`npm i -g pnpm@9`).

```bash
pnpm install
docker compose up -d db
pnpm prisma:generate
pnpm db:migrate
pnpm seed
pnpm dev
```

The API runs on :3000 with the worker inside it (`WORKER_ENABLED=true`) and reads `.env` from the repo root. Other
scripts: `pnpm build` (contracts + architecture checks + compile), `pnpm contracts:build`, `pnpm db:sql` (print the
schema as SQL when writing a migration), `pnpm seed:prod` (seed from the compiled build).

## 4. Click-through script (flows A–Q)

Sign in to the web app as `admin` and keep **Simulator** open (it shows every SMS). Vehicles for demos are on
**Simulator → VAHAN test vehicles** (`demo-new` for dealer orders, `demo-has-plates` for replacements).

| Flow | Where | Steps |
| --- | --- | --- |
| **A. Dealer order** | Android as `dealer.wb01` (or web) | New order → registration, chassis, engine of a `demo-new` WB vehicle → RECEIVED → VALIDATED → CONFIRMED in a few seconds. Web **Wallets** shows the hold then the capture on the shared wallet `GRP-EAST-A`. |
| **B. OEM order by API** | Simulator | **Push a Zenmo API order** (catalogue check + VAHAN). **Repeat last push (same key)** → "replayed: no duplicate created". OEM callbacks tab shows the status sent back. |
| **C. OEM order by file** | Simulator / OEM files & uploads | **Upload a sample Kranti CSV** → open it under **OEM files & uploads**: good rows become orders, bad rows are listed; **Download error report**. |
| **D. Customer order** *(disabled, D37)* | ~~Customer portal~~ | — |
| **E. Station production** | `station.kol` | **Issuance**: dealer WB01 → tick the order → pick a suggested box → Lock boxes → Allocate & create job card → PDF. **Quality check** → **Upload photos** of each embossed plate → **Read the photos** (OCR must read the order's registration number; until then Pass is disabled) → Pass. **Sticker printing** → Print (cars only). **Delivery challans** → Create challan (PDF). |
| **F. Dealer inward** | Android `dealer.wb01` → Inward | Open the challan → Accept (or Reject a plate with a reason) → Submit → Sync tab shows Done; the order is INWARDED. |
| **G. Fitment** | Android → Fitment | Search the registration → laser codes → tick the confirmation → front and rear photos (debug: **Test photo** draws the order's number; **Test photo (wrong number)** shows the OCR refusal) → Submit. The server reads both plate photos (OCR); a different number refuses the fitment. Works in airplane mode (queued, sent when online). The server posts to VAHAN; the order becomes COMPLETED and the owner gets an SMS. |
| **H. Rejection and re-issue** | `station.kol` / Android | QC → **Reject** a plate → **Rejection approval** → Disapprove (back to QC passed). Another order: reject a plate at Android inward → **Approve (re-issue)** → only that plate is re-issued → **second challan**. |
| **I. Replacement order** | Web `dealer.wb01` → Place order | Replacement, a `demo-has-plates` vehicle, reason, photo → AWAITING_APPROVAL with the amount held. As `ops`: **Approvals** → view evidence → Approve → CONFIRMED. |
| **J. VAHAN down** | Simulator + Android | VAHAN **down** → record a fitment → order stays FITTED, post retrying on **Integration monitor**. VAHAN **normal** → **Replay all VAHAN posts** → COMPLETED. |
| **K. Complaint** *(disabled, D37)* | ~~Portal → HSRP Support~~ | Staff can still answer existing complaints on **Complaints** (see tracker F-01, F-02). |
| **L. Oversight** | `admin` / `ops` | **Dashboard** → any order → timeline, plates, challans, fitment photos, approvals, payments, audit, events. **Audit log**, **Reports** (incl. Order history, Order validation results, OEM history, Laser code audit) → Export CSV. |
| **N. Postpaid billing** | `ops` → **Billing** | **Setup**: Zenmo is postpaid (monthly), billed to Zenmo; set a dealer's "Bill to" to the dealer. Order a Zenmo vehicle as that dealer: confirmed without a wallet hold (order → Payment tab). **Unbilled charges**: pending, then billable after dispatch. **Bills** → **Run billing now** → open the bill → PDF; the e-mail is on Simulator → SMS & e-mail. |
| **Q. OEM bulk upload** | `ops` → OEM files & uploads | **Bulk upload OEM data**: choose the OEM and Vehicle data or Orders → **Download template** → fill it → **Upload and load**. Rows are checked like integration data; refused rows are in the error report. |
| **M. OEM vehicle data** | Simulator / Place order | **New-vehicle demo batch** → Prepare → **Send Kranti file to the import** (6 kept, 2 refused). Order the sheet's vehicles with OEM Kranti: the valid one is confirmed; the one not in the file and the one with the wrong engine are rejected at the "OEM vehicle data" step (D42). |

### On-screen simulator (`pnpm sim`)

`pnpm sim` plays ten end-to-end test cases on screen, one by one, happy flows first. It drives Chrome for the web
roles and the Android emulator (debug dealer app) for inward and fitment, with a visible cursor, click ripples
and a caption per step. Each run prepares its own fictional vehicles, so it can be repeated. Test cases, run plan,
options (`--case`, `--from`, `--kind`, `--speed`, `--pace`, `--manual`, `--list`) and how to add a case:
[docs/SIMULATION.md](docs/SIMULATION.md). Type-check it with `pnpm sim:check`.

## 5. How it is built

```
src/platform/   bootstrapping, env, Prisma, request context, auth guard, RFC 7807 errors, idempotency, audit, worker
src/utility/    generic modules with no HSRP knowledge (identity, configuration, audit, integration-hub, notification,
                file-storage, payments, wallet, scheduling, documents, import-export, approvals, tickets, reporting)
src/core/       HSRP modules + ports (VehicleRegistry, OrderSource, OemVehicleCatalog)
src/adapters/   one folder per external system: mock (and an empty real placeholder), plus the simulator
prisma/schema/  one schema file per owning module ("// owner: <folder>"), migrations
packages/contracts/  shared enums, zod schemas, event names (the web repo keeps a synced copy, D39)
```

Rules (handover section 4), enforced where possible: one-way dependencies (dependency-cruiser), generic references
(`subjectType` + `subjectId`), events first through a transactional outbox with retries and a dead-letter queue, ports and
adapters chosen by `VAHAN_ADAPTER` / `PAYMENT_ADAPTER` / `MESSAGE_ADAPTER` / `OEM_ADAPTER` / `FILE_STORE_ADAPTER`,
configuration over code, external calls never inside a user request, each module owns its tables
(`scripts/check-module-tables.cjs`). API conventions: JWT bearer auth; `Idempotency-Key` on order creation, payments,
top-ups, fitment and inward; RFC 7807 errors; paginated lists; `tenant_id`, `created_at`, `updated_at` on every table.

## 6. Keeping the docs current

Each repo has [AGENTS.md](AGENTS.md) (guide for people and coding agents; `CLAUDE.md` imports it), the
**maintain-docs** skill in `.claude/skills/maintain-docs/`, `scripts/docs-check.mjs`, and a pre-commit hook in
`.githooks/` (enabled by `pnpm install`, or `git config core.hooksPath .githooks`). The hook blocks commits when a
required doc is missing, tracker IDs clash or statuses are invalid, decision numbers break, a package script is
undocumented, or the Prisma schema changed without a migration; it warns when code changes without doc changes
(decision D41).

## 7. What is mocked

| System | Mock | Notes |
| --- | --- | --- |
| VAHAN | `src/adapters/vahan` | ~360 fictional vehicles; modes normal / slow / down / not-found; field names from a public sample (contract unconfirmed). Fitment replies are free text; one fixture answers with unreadable text. |
| OEM systems | `src/adapters/oem` | Inbound API with API key + HMAC-SHA256 signature + idempotency key; CSV through an import profile; status callbacks stored; chassis catalogue for Zenmo. |
| Payment gateway | `src/adapters/payment` | PayU-shaped hosted checkout: SHA-512 hash with a merchant salt, mock page (Success / Failure / Cancel), reverse-hash webhook, verify, refunds. |
| SMS and e-mail | `src/adapters/messaging` | Every message stored and shown on the simulator; SMS without a DLT template id is refused. |
| File storage | `src/adapters/file-store` | Bytes in PostgreSQL behind `FileStore`; signed short-lived links. |
| Plate OCR | `src/adapters/ocr` | **Real** OCR by default: tesseract.js in the API process, English model bundled (no download). `OCR_ADAPTER=mock` reads the plate text test images embed instead. Used after embossing (QC gate) and at fitment (D45). |

## 8. Not built (out of scope for the prototype)

Real VAHAN, OEM, payment or SMS connections; home fitment; a customer mobile app; iOS; GST invoicing; regulator report
formats; production hardening beyond sensible defaults; performance tuning; other languages; cloud deployment. Open
items are in [docs/TRACKER.md](docs/TRACKER.md).

## 9. Environment variables

All are in [.env.example](.env.example) with comments. Key ones: `SEED_PASSWORD` (required), `DEMO_MODE` /
`DEMO_FIXED_OTP`, `WORKER_ENABLED`, `OUTBOX_RETRY_BASE_MS`, `PUBLIC_API_URL` / `PUBLIC_WEB_URL` (gateway redirects),
the `*_ADAPTER` switches (incl. `OCR_ADAPTER`: `tesseract` or `mock`), `API_PORT`, `POSTGRES_PORT`.
