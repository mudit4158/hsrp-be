# HSRP Dealer Management System — prototype

A working prototype of a dealer management system for High Security Registration Plates (HSRP): order intake from
dealers, OEMs and customers, embossing-station production, dispatch, dealer inward, fitment with photos, and the
VAHAN post — with every external system mocked.

- **API** — NestJS + Prisma + PostgreSQL, REST under `/api/v1`, OpenAPI at `/api/docs`
- **Web** — React + Vite: staff app and dealer views (the public customer portal is disabled, see below)
- **Android** — Kotlin + Jetpack Compose dealer app with an offline queue
- **Mocks** — VAHAN, OEM systems, a PayU-shaped payment gateway, SMS and e-mail, driven from a simulator screen

All data is fictional. Nothing here contacts a real VAHAN, OEM, payment or SMS system.

> **Customer portal disabled (decision D37).** The portal's code is still in the repo (`apps/api/src/core/customer-portal`,
> `apps/web/src/portal`) but it is detached: no `/api/v1/public/*` routes, no `/portal` pages, and the `CUSTOMER` role
> grants nothing. Customer orders, online payment and complaints raised by customers (flows D and K) are therefore not
> available. To re-enable: import `CustomerPortalModule` in `apps/api/src/core/core.module.ts`, give the `CUSTOMER` role
> `portal.customer` and `payments.pay` again (seed fixtures or Users & roles), and restore the `/portal` route in
> `apps/web/src/App.tsx`.

Design background: [High-Level Design](https://claude.ai/code/artifact/d7fce61b-0fe9-4bae-a8b2-7286684b9de4) ·
decisions taken while building: [docs/DECISIONS.md](docs/DECISIONS.md) ·
open items and pending fixes: [docs/TRACKER.md](docs/TRACKER.md).

---

## 1. Run it (Docker, one command)

Prerequisites: Docker Desktop (Compose v2.24+). Nothing else.

```bash
cp .env.example .env
```

Edit `.env` and set `SEED_PASSWORD` (8+ characters). It becomes the password of every demo user. Then:

```bash
docker compose up --build
```

The first start builds the images, runs the migrations and seeds the demo data (about 10 seconds after the database is up).

| What | URL |
| --- | --- |
| Web app (staff, dealers) | http://localhost:8080 |
| API | http://localhost:3000/api/v1 |
| OpenAPI docs | http://localhost:3000/api/docs |
| PostgreSQL | localhost:5433 (user `hsrp`, password from `.env`) |

**Demo sign-ins** (password = `SEED_PASSWORD` from your `.env`):

| User | Role | Can do |
| --- | --- | --- |
| `admin` | Admin | Everything, including the simulator and integration monitor |
| `ops` | Operations | Orders, approvals, OEM files, wallets, complaints, masters, reports |
| `station.kol` | Station user, Kolkata (West Bengal) | Issuance, QC, stickers, challans, rejection approval |
| `station.bbs` | Station user, Bhubaneswar (Odisha) | Same, for Odisha |
| `dealer.wb01` | Dealer, Howrah Wheels (WB) | Web: place and track orders. Android: everything a dealer does |
| `dealer.od02` | Dealer, Kalinga Motors (OD) | Same |

OTPs (used only by the disabled customer portal) are real random codes shown on **Simulator → SMS & e-mail**; with
`DEMO_MODE=true` the fixed code `123456` is also accepted.

**Start over:** `docker compose down -v` then `docker compose up`, or set `SEED_RESET=true` in `.env` and restart the `api` service.

## 2. Check it

```bash
pnpm install
pnpm demo:e2e
```

`demo:e2e` runs flows A–L (below) through the API (D and K are reported as skipped while the portal is disabled, and
an extra check confirms the portal endpoints are gone) against `http://localhost:3000` (override with `API_BASE_URL`) and
prints one line per flow. It is re-runnable; each run uses fresh demo vehicles. After many runs the sample pools
run out — reseed.

```bash
pnpm test
```

Unit tests: order state machine, plate allocation rules, wallet ledger, outbox retry, validation and pricing rules,
and the dependency check itself. Database tests use a separate `hsrp_test` database (created automatically) on the
Compose PostgreSQL, so start `docker compose up -d db` first.

```bash
pnpm lint:deps
```

Architecture check, also part of `pnpm build`: fails if a utility imports core or adapter code, if core imports an
adapter, on circular imports, or if a module reads or writes another module's tables (see section 6).

## 3. Develop without Docker (optional)

Needs Node 20+ and pnpm 9 (`npm i -g pnpm@9`).

```bash
pnpm install
docker compose up -d db
pnpm db:migrate
pnpm seed
pnpm dev:api
pnpm dev:web
```

The API runs on :3000 with the worker inside it (`WORKER_ENABLED=true`); the web dev server on http://localhost:5175
proxies `/api`. The API reads the repo-root `.env`.

## 4. Android dealer app

Source in `apps/android`. Build the debug APK:

```bash
cd apps/android && ./gradlew assembleDebug
```

Output: `apps/android/app/build/outputs/apk/debug/app-debug.apk`. You need the Android SDK (Android Studio installs it)
and JDK 17; if `local.properties` is missing, create it with `sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk` (or open
the folder once in Android Studio).

**Emulator:** start an emulator, then `adb install -r app/build/outputs/apk/debug/app-debug.apk`. The app's default
server is `http://10.0.2.2:3000`, which is the host computer as seen from the emulator.

**Phone on the same Wi-Fi:** the API listens on `0.0.0.0`, so the phone can reach it at your computer's LAN address.

1. Find the address. Windows: `ipconfig` → "IPv4 Address" of the Wi-Fi adapter (e.g. `192.168.1.23`). macOS: `ipconfig getifaddr en0`. Linux: `hostname -I`.
2. Allow inbound TCP 3000 in the computer's firewall (Windows asks the first time Docker publishes the port; accept for private networks).
3. In the app, tap **Server:** on the sign-in screen (or Settings after sign-in), enter `http://192.168.1.23:3000`, and use **Test connection**.

Plain HTTP is allowed in the **debug** build only (`src/debug` network security config); a release build requires HTTPS.

What the app does: sign-in with device registration; home with counts, wallet and today's appointments; place
orders and follow them; inward a challan plate by plate (accept, or reject with a reason); search a vehicle,
confirm its laser codes, take front/rear (and optional chassis) photos with the camera, and submit. Inward and
fitment are saved to an on-device queue first and sent by WorkManager when there is a connection, each with a fixed
`Idempotency-Key`, so retries never record twice. The **Sync** tab shows the queue. Debug builds also offer a
"Test photo" button for emulators without a camera.

## 5. Click-through script (flows A–L)

Sign in as `admin` in one browser window and keep **Simulator** open: it shows every SMS and OTP. Vehicle details for
demos are on **Simulator → VAHAN test vehicles** (scenario `demo-new` for dealer orders, `demo-old` for the portal,
`demo-has-plates` for replacements).

| Flow | Where | Steps |
| --- | --- | --- |
| **A. Dealer order** | Android as `dealer.wb01` (or web) | New order → registration, chassis, engine of a `demo-new` WB vehicle → order goes RECEIVED → VALIDATED → CONFIRMED in a few seconds. Web **Wallets** shows the hold then the capture on the shared wallet `GRP-EAST-A`. |
| **B. OEM order by API** | Simulator | **Push a Zenmo API order** → an order appears (catalogue check + VAHAN). **Repeat last push (same key)** → "replayed: no duplicate created". OEM callbacks tab shows the status sent back. |
| **C. OEM order by file** | Simulator / OEM files & uploads | **Upload a sample Kranti CSV** → open the file under **OEM files & uploads**: good rows become orders; bad rows are listed; **Download error report**. |
| **D. Customer order** *(disabled, D37)* | ~~Customer portal~~ | Apply HSRP → state WB, a `demo-old` vehicle (last 5 of chassis and engine) → city, centre, date, slot → details → OTP (from the simulator) → Pay → mock gateway **Pay (simulate success)** → back on the portal: confirmed → **Download receipt**. |
| **E. Station production** | `station.kol` | **Issuance**: dealer WB01 → tick the order → click a suggested box (or type `BX-KOL1-…`) → Lock boxes → Allocate & create job card → PDF. **Quality check** → Pass. **Sticker printing** → Print (cars only; others skip it). **Delivery challans** → dealer → tick → Create challan (PDF opens). |
| **F. Dealer inward** | Android `dealer.wb01` → Inward | Open the challan → Accept (or Reject a plate with a reason) → Submit → Sync tab shows Done; web order is INWARDED. |
| **G. Fitment** | Android → Fitment | Search the registration → laser codes → tick the confirmation → take front and rear photos → Submit. Works in airplane mode: the item waits in the Sync tab and is sent when back online. The server posts to VAHAN; the order becomes COMPLETED and the owner gets an SMS. |
| **H. Rejection and re-issue** | `station.kol` / Android | QC → **Reject** a plate with a reason → **Rejection approval** → Decide → Disapprove (back to QC passed). For another order, reject a plate at Android inward → Rejection approval → **Approve (re-issue)** → the order is CONFIRMED with only that plate pending → issue, QC, print, and a **second challan** with just that plate. |
| **I. Replacement order** | Web `dealer.wb01` → Place order | Order type Replacement, a `demo-has-plates` vehicle, plate(s), reason, attach a photo → AWAITING_APPROVAL with the wallet amount held. As `ops`: **Approvals** → view the evidence → Approve with remarks → CONFIRMED. |
| **J. VAHAN down** | Simulator + Android | Set VAHAN to **down** → record a fitment → the order stays FITTED; **Integration monitor** shows the post retrying with back-off. Set VAHAN to **normal** → **Replay all VAHAN posts** → COMPLETED. (Seeded FITTED orders are already in the manual queue.) |
| **K. Complaint** *(disabled, D37)* | ~~Portal → HSRP Support~~ | Raise a complaint (OTP) → ticket number by SMS. Staff: **Complaints** → answer and set In progress. Portal → Complaint status (OTP to the number on the complaint) shows the reply. The "Past 15 days" tab shows ageing. |
| **L. Oversight** | `admin` / `ops` | **Dashboard** (orders by status, fitted today, VAHAN posts pending, stock, ageing) → any order → timeline, plates, challans, fitment photos, approvals, payments, audit, events. **Audit log**, **Reports** → run → Export CSV. |

## 6. How it is built

```
apps/api/src
  platform/   bootstrapping, env, Prisma, request context, auth guard, RFC 7807 errors, idempotency, audit interceptor, worker
  utility/    generic modules — no HSRP knowledge (identity, configuration, audit, integration-hub, notification, file-storage,
              payments, wallet, scheduling, documents, import-export, approvals, tickets, reporting)
  core/       HSRP modules (masters, pricing, inventory, order-intake, booking, production, dispatch, rejection, fitment,
              customer-portal, oversight) and ports/ (VehicleRegistry, OrderSource, OemVehicleCatalog)
  adapters/   one folder per external system with a mock (and an empty real placeholder), plus the simulator
apps/api/prisma/schema   one schema file per owning module (first line: "// owner: <folder>")
apps/web                 staff app, dealer views, customer portal
apps/android             dealer app
packages/contracts       shared enums, zod request schemas, event names
```

Rules that hold (handover section 4):

- **One-way dependencies**, enforced by `dependency-cruiser` (`apps/api/.dependency-cruiser.cjs`): utility → core/adapters and core → adapters fail the build. A unit test proves the check fails on a violation.
- **Generic references**: utilities identify what they act on by `subjectType` + `subjectId` strings; no foreign keys into core tables.
- **Events first, transactional outbox**: core modules publish domain events in the same transaction as the state change (`EventBus.publish(tx, …)`); each subscriber gets its own delivery row with retries, exponential back-off and a dead-letter queue.
- **Ports and adapters**: core depends on interfaces; adapters are chosen by `VAHAN_ADAPTER`, `PAYMENT_ADAPTER`, `MESSAGE_ADAPTER`, `OEM_ADAPTER`, `FILE_STORE_ADAPTER` (only `mock`/`db` are implemented).
- **Configuration over code**: prices (effective-dated), validation steps per OEM/state, state rule packs, cut-off date, photo rules, slot capacity, message templates (with sender and DLT ids), print layouts and number sequences are data.
- **Asynchronous at the edges**: every external call (VAHAN, OEM callbacks, payment verify/refund, SMS, e-mail) runs from the outbox, never inside a user request.
- **Each module owns its tables**: `scripts/check-module-tables.cjs` fails the build if code touches another module's Prisma model or table.

API conventions: JWT bearer auth; `Idempotency-Key` required on order creation, payments/top-ups, fitment and inward;
errors are RFC 7807 problem JSON; lists are paginated; every table has `tenant_id`, `created_at`, `updated_at`.

## 7. What is mocked

| System | Mock | Notes |
| --- | --- | --- |
| VAHAN | `adapters/vahan/mock-vahan.adapter.ts` | ~360 fictional vehicles; modes normal / slow / down / not-found; field names from a public sample (contract unconfirmed). `recordFitment` replies in free text that the core parses; one fixture answers with unreadable text. |
| OEM systems | `adapters/oem` | Inbound API with API key + HMAC-SHA256 signature + idempotency key; CSV through an import profile; status callbacks stored; chassis catalogue table for Zenmo. |
| Payment gateway | `adapters/payment` | PayU-shaped hosted checkout: SHA-512 request hash with a merchant salt, a mock page with Success / Failure / Cancel, reverse-hash webhook, server-to-server verify, refunds. |
| SMS and e-mail | `adapters/messaging` | Every message stored and shown on the simulator; SMS without a DLT template id is refused. |
| File storage | `adapters/file-store` | Bytes in PostgreSQL behind the `FileStore` port; signed short-lived download links. |

## 8. Not built (out of scope for the prototype)

Real VAHAN, OEM, payment or SMS connections; home fitment (switch exists, off); a customer mobile app; iOS; GST
invoicing; regulator report formats; production hardening beyond sensible defaults (hashed passwords, JWT expiry,
role checks, input validation, rate limits on public endpoints); performance tuning; other languages; cloud
deployment. Seeded historical fitments share one placeholder photo. Print layouts are simple, not final regulatory
formats.

## 9. Environment variables

All are listed with comments in [.env.example](.env.example). The important ones: `SEED_PASSWORD` (required),
`DEMO_MODE` / `DEMO_FIXED_OTP`, `WORKER_ENABLED`, `OUTBOX_RETRY_BASE_MS`, `PUBLIC_API_URL` / `PUBLIC_WEB_URL`
(used for gateway redirects), the `*_ADAPTER` switches, and the ports (`API_PORT`, `WEB_PORT`, `POSTGRES_PORT`).
