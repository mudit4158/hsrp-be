# Tracker — open items and pending fixes (system and backend)

**Last reviewed:** 12 Oct 2026

This tracker holds backend items, items that span repos, business questions and hardening. Items that touch only
one other repo live in that repo's tracker: [hsrp-fe/docs/TRACKER.md](../../hsrp-fe/docs/TRACKER.md) and
[hsrp-mobile-app/docs/TRACKER.md](../../hsrp-mobile-app/docs/TRACKER.md) (sibling folders under `C:\workspace\hsrp`).
Each item lives in exactly one tracker. Decisions (Dnn) are in [DECISIONS.md](DECISIONS.md).

Update rows when an item moves; finished items go to **Done** with the commit. The maintain-docs skill describes the
routine and `pnpm docs:check` validates the format.

**Status:** Open · In progress · Blocked (waiting on someone outside the build) · Done
**Priority:** P1 breaks or blocks a demo flow · P2 needed before real use · P3 nice to have
**Repos:** BE = hsrp-be · FE = hsrp-fe · AND = hsrp-mobile-app

## Fixes

| ID | Item | Repos | Priority | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| F-01 | Complaint SMS no longer sent | BE | P1 | Open | The `TicketCreated` / `TicketUpdated` SMS subscribers live in `src/core/customer-portal/customer-portal.service.ts`, which is detached (D37). A staff reply on **Complaints** updates the ticket but the customer gets no SMS. Move the two subscribers to a core module that stays loaded (e.g. a small `core/complaints` module). |
| F-02 | No way to raise a complaint while the portal is off | BE, FE | P1 | Open | Tickets were only created from HSRP Support. Add a staff-side create (phone or walk-in complaints): endpoint in BE, form on the FE Complaints screen. Flow K is skipped in `pnpm demo:e2e` until then. |
| F-03 | Payment endpoints still attached | BE | P2 | Open | `/api/v1/payments/webhook`, `/payments/return` and the mock gateway `/mock-gateway/payu/*` belong to the generic payments module and stay live although only the portal used them. Decide: keep (needed when the portal returns) or gate them too. |
| F-04 | Payment retry reuses the transaction id | BE | P2 | Open | D36. Fine for the mock; real PayU needs a new `txnid` per attempt. Create a new payment (or attempt) row per checkout before connecting a real gateway. |
| F-07 | `pnpm demo:e2e` uses up demo vehicles | BE | P3 | Open | Each run consumes vehicles from the `demo-*` and `oem-*-sample` pools; after several runs a reseed is needed. Let the script create its own fictional VAHAN records instead. |

## Ownership checks (right to order a plate)

Every order is checked with VAHAN (registration + last 5 of chassis and engine, state, existing plates). That proves the
vehicle exists and the person has its documents, **not** that they own it or sold it. Only OEM API orders are fully
vouched for (signed request + chassis in the OEM's catalogue). The VAHAN sample contract (D3) returns no owner name,
owner mobile or selling dealer. Business question: B-04.

| ID | Item | Repos | Priority | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| O-01 | Customer OTP must go to the VAHAN-registered mobile | BE, FE | P2 | Blocked | Today the portal sends the OTP to whatever mobile the customer types, so it proves a phone, not ownership. Send the OTP to the mobile registered with VAHAN for that vehicle (VAHAN sends it, or returns a masked number). Blocked on the VAHAN contract (D3). Becomes **P1 before the portal is re-enabled** (B-01). |
| O-02 | Dealer must be the selling dealer | BE | P2 | In progress | Done for Kranti new-vehicle orders: the `oem-vehicle-data` step (D42) requires the dealer the OEM supplied the vehicle to. Still open for other OEMs and for orders placed without an OEM (N-08). Before D42 any dealer with a vehicle's registration, chassis and engine numbers could order for it. Check the vehicle was sold through this dealer (selling-dealer code on the VAHAN record, or OEM sales/invoice data). Interim: flag or send to approval orders where the dealer is not mapped to the vehicle's maker. |
| O-03 | OEM file orders are not vouched for | BE | P2 | In progress | Kranti CSV orders are now checked against Kranti's vehicle data file (D42), but the files are still uploaded by staff. Originally: Kranti CSV orders got no catalogue check (D4). Turn on the catalogue check for CSV OEMs, or require signed files / the OEM API instead of staff uploads. |
| O-04 | Replacement approval checklist | BE, FE | P3 | Open | Add a checklist to the replacement approval (name on the evidence matches the owner; police report number and date for theft) so the manual check is consistent and recorded. |

## Fitment proof (are the photos real, is it the right vehicle?)

Uploads are checked for declared type, size and presence only; the SHA-256 is stored but not compared. "Right
vehicle" rests on the plates' chain of custody (allocated → challan → inwarded by this dealer) and on the dealer ticking
"the plates carry these laser codes" — the app fills the codes in itself. Nothing checks photo content, location or
capture time. Business questions: B-05, B-06.

| ID | Item | Repos | Priority | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| P-01 | Read the laser code off the plate at fitment | AND, BE | P2 | Open | Replace the tick-box: the app reads the code with the camera (on-device text recognition) and sends what it read; the server compares it with the allocation. Mismatch → refuse or flag. |
| P-02 | Check what the photos show | BE, AND | P3 | In progress | Registration number: done (D45): fitment photos are read by OCR and a mismatch refuses the fitment. Still open: read the laser code from the plate photos and the last 5 of the chassis from a required chassis photo (`fitment.photoRules`). |
| P-03 | Record where and when photos were taken | AND, BE | P2 | Open | The app sends GPS and capture time (the API already accepts `latitude` / `longitude`). Flag fitments far from the dealer's site or taken long before submission. Needs dealer site coordinates in the masters. |
| P-04 | Catch reused photos | BE | P2 | Open | Compare each photo's SHA-256 with earlier fitments, plus a perceptual hash for lightly edited copies; flag duplicates. |
| P-05 | Trust the capturing device | AND, BE | P2 | Open | Remove the debug "Test photo" button from release builds and add Play Integrity (app attestation) so the server knows uploads come from the genuine app. Links to AND N-03 (release build). |
| P-06 | Fitment review queue | BE, FE | P2 | Open | Operations review flagged fitments plus a random sample; flagged fitments wait before the VAHAN post (reuse the Approvals utility). |
| P-07 | Owner confirmation | BE | P3 | Open | Put the fitted laser codes in the completion SMS (`FITMENT_DONE` template) so the owner can report a mismatch. |
| P-08 | Stricter file checks | BE | P3 | Open | Detect the real file type from its contents; refuse fitment photos without camera metadata (EXIF). |
| P-09 | Confirm the physical plate at embossing and QC | FE, BE | P2 | In progress | Registration number: done (D45): QC needs a photo of each embossed plate that OCR reads as the order's number. Still open: the laser code itself — issuance picks the next free code in the box and trusts the operator to emboss that plate. Scan the code at embossing or QC (FE station screens; webcam or USB scanner) so allocation and physical plate are proven to match. |
| P-10 | QR codes on our own documents | BE, FE, AND | P3 | Open | QR with the order / challan / job card number on the job card, challan and sticker PDFs (needs a `qr` element in the PDF renderer, BE). Scan to open the record: Android ML Kit (offline), web USB scanner or webcam. |
| P-11 | QR labels on plate boxes | BE | P3 | Blocked | QR on each box (box number, codes) so stock receipt and issuance are a scan. Blocked on the plate manufacturer printing it, or decide to print our own labels at stock receipt. |
| P-12 | No free typing of laser codes | FE, BE | P2 | Open | QC "Switch code" is the only place a full code is typed. Scan first (text recognition, as in P-01 / P-09), typing as a fallback entered twice. |

## Not built yet

| ID | Item | Repos | Priority | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| N-02 | Real adapters (VAHAN, PayU, SMS/e-mail, OEM) | BE | P2 | Blocked | Each `real` adapter is an empty placeholder. Blocked on the real contracts and credentials (D3, D6). Never call real endpoints from the prototype. |
| N-04 | Worker as its own process | BE | P3 | Open | Outbox and scheduled jobs run inside the API (`WORKER_ENABLED=true`). Splitting needs a second entry point that boots the same module with HTTP off. |
| N-05 | Final print layouts | BE | P3 | Blocked | Job card, challan, sticker and receipt are simple PDFs (D16). Needs the official layouts. |
| N-10 | Prepaid dealer credit control (OEM × dealer) | BE, FE | P2 | Open | Designed, not built (user request): OEM allocates or withdraws credits per dealer, freezes a dealer, sets a per-order maximum, a monthly cap and allowed vehicle classes, and chooses the funding source (OEM credits only, the dealer's own only, or OEM first then own); dealers may add own credits and ask the OEM for more (approvals). Clickable prototype: [Dealer Credit Control](https://claude.ai/artifact/TgJ55GGG54MrP2qT8BskTW). Plan in the prototype's "How it would fit" section. |
| N-12 | Backend port to Python (FastAPI) | BE, FE | P1 | In progress | Same API and schema, NestJS kept until parity (D48). Plan, phases and gates: [docs/FASTAPI-PORT.md](FASTAPI-PORT.md). P0 scaffold, P1 platform and P2 utilities done (schema identical, every utility route at parity, 42 pytest tests); now P3 adapters and P4 core. |
| N-11 | Billing follow-ups | BE, FE | P2 | Open | Postpaid billing (D46) has no tax invoice (GST), payment collection or reminders (bills are marked paid by hand), dealer/OEM view of their own bills, credit limit for postpaid parties, or credit notes for re-issues and cancellations after billing. |
| N-09 | OCR accuracy on real photos | BE | P2 | Open | The tesseract adapter (D45) reads generated test plates reliably; real camera photos (angle, glare, dirt, IND hologram) need tuning (crop to the plate, deskew, contrast) or a dedicated ANPR engine behind the same `PlateReader` port. Measure on sample photos before real use; a strict exact-match rule will refuse misreads. |
| N-08 | OEM vehicle data for every OEM | BE | P2 | Open | The `oem-vehicle-data` step (D42) runs only for Kranti orders (setting `order.validationSteps`, scope oem KRANTI). New-vehicle orders without an OEM or for Zenmo are not checked. Decide per OEM (file vs. API catalogue) and whether a NEW order must name its OEM. |
| N-06 | Unit tests for production and dispatch services | BE | P3 | Open | Covered end to end by `pnpm demo:e2e` (flows E, F, H) but not by unit tests. |

## To verify

| ID | Item | Repos | Priority | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| V-03 | Vendor issues log against the build | BE, FE, AND | P2 | Open | The [issues and gaps log](https://claude.ai/code/artifact/dff78ee2-6285-4e87-baec-3945c09dfc9c) was not reviewed during the build. Check each item and add rows to the right tracker. |

## Repository housekeeping (after the split)

| ID | Item | Repos | Priority | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| R-01 | Old monorepo folder | — | P3 | Open | `C:\workspace\hsrp-dms` (the pre-split monorepo) stays as a read-only archive; it could not be renamed during the split because another process held the folder. Rename it (e.g. `hsrp-dms-monorepo`) or remove it once nothing uses it. |
| R-02 | Old Docker volumes | — | P3 | Open | Two database volumes are no longer used: `hsrp-dms_dbdata` (pre-split monorepo) and `hsrp-dms-be_dbdata` (before the rename to hsrp-be, D48). The backend now uses `hsrp-be_dbdata`. Remove them with `docker volume rm hsrp-dms_dbdata hsrp-dms-be_dbdata` when their demo data is not needed. |
| R-03 | Shared checker kept in step | BE, FE, AND | P3 | Open | `scripts/docs-check.mjs` and the maintain-docs skill are copied in all three repos. When one changes, copy it to the others (the skill says so). Consider a tiny shared package later. |

## Open decisions (waiting on the business)

| ID | Item | Repos | Priority | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| B-01 | Re-enable the customer portal? | BE, FE | P2 | Open | Disabled by request (D37). To restore: import `CustomerPortalModule` in `src/core/core.module.ts`, restore the `CUSTOMER` role permissions, restore the `/portal` route in FE `src/App.tsx`, un-skip flows D and K. Fix F-01 and O-01 first. |
| B-02 | The nine open points behind D1–D9 | — | P2 | Open | Role per state, states served, VAHAN contract, OEMs and formats, portal scope, gateway and SMS provider, vendor product, volumes, several companies. The prototype uses the defaults in DECISIONS.md. |
| B-03 | Customer accounts | BE, FE | P3 | Open | Customers use OTP only (D12). Fleet owners may want a "My vehicles" login; the identity module already supports OTP sign-in. |
| B-04 | How must the right to order be proven? | — | P2 | Open | Rule per channel: owner (OTP to the VAHAN-registered mobile?), dealer (selling dealer only, or any mapped dealer?), OEM (catalogue / signed data for every OEM?), and whether VAHAN can return owner or selling-dealer data. Drives O-01 to O-04. |
| B-05 | How strict is fitment proof? | — | P2 | Open | Per check (P-01 to P-09): block the fitment, or accept and flag for review? Should flagged fitments wait before the VAHAN post? Sample rate for random review? Is location capture acceptable to dealers? |
| B-06 | Machine-readable code on the plate | — | P2 | Open | Does the HSRP plate carry a machine-readable code besides the etched laser code, and may one be added? Plate design is regulated. If none, scanning uses text recognition of the laser code (P-01, P-09, P-12). A QR on a peel-off label or packaging does not prove which plate is on the vehicle. |

## Before any real use (hardening)

| ID | Item | Repos | Priority | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| H-01 | Turn off demo shortcuts | BE, FE | P2 | Open | `DEMO_MODE=false` (no fixed OTP); remove the simulator (BE endpoints, FE screen) and the mock gateway from non-demo builds. |
| H-02 | Secrets | BE | P2 | Open | API client signing secrets are stored in clear (prototype); move to a secret store. Set strong `JWT_SECRET` and `FILE_LINK_SECRET`. |
| H-03 | CORS and HTTPS | BE | P2 | Open | CORS reflects any origin (`src/main.ts`); restrict it. Serve the API over HTTPS. |
| H-04 | Library upgrades | BE, FE | P3 | Open | Pinned to NestJS 10, Prisma 6, Zod 3, React 18, Vite 5 (D34). Plan the upgrade to current majors. |
| H-05 | Repository remotes | BE, FE, AND | P3 | Open | All three repos are local only, nothing pushed. Create remotes when the team is ready (never push without explicit confirmation). |

## Done

| ID | Item | Commit |
| --- | --- | --- |
| — | Postpaid billing: payment mode and cycle per OEM, bill-to per OEM × dealer, charges, cycle close and Run billing now, bill PDF and e-mail, Billing page; demo:e2e flow N; simulator TC-13 (D46) | "Billing and OEM bulk upload" commit |
| — | Bulk upload of OEM data with standard templates (vehicle data, orders), OEM chosen at upload, template download; demo:e2e flow Q; simulator TC-14 (D47) | same commit |
| — | Plate photo OCR after embossing (QC gate) and at fitment (refusal on mismatch), PlateReader port with tesseract and mock adapters, "Plate photo checks (OCR)" report, simulator cases TC-11 and TC-12 (D45) | "Plate photo OCR" commit |
| — | OEM vehicle data file and the `oem-vehicle-data` validation step (D42); demo:e2e flow M | "OEM vehicle data, audit reports and on-screen simulator" commit |
| — | Audit reports: order history, order validation results, OEM history, laser code audit (D43) | same commit |
| — | On-screen simulator `pnpm sim` with 10 end-to-end cases (D44, docs/SIMULATION.md) | same commit |
| — | Issuance box suggestions left out needed plate sizes (only the first 8 boxes were shown); now up to 3 per needed size | FE commit of the same day |
| N-07 | Repositories separated into hsrp-be, hsrp-fe, hsrp-mobile-app (D38–D41) | see each repo's "Split from the monorepo" commit |
| — | Outbox dispatcher compared due times with the database clock (a few ms of Docker clock lag left replayed deliveries waiting); now uses the Node clock it writes with | backend split commit |
| — | Customer portal detached (D37) | monorepo `b9b39fa` |
| — | Flaky DB tests: Jest timeout raised to 30 s | monorepo `b9b39fa` |
| — | Docker healthcheck used IPv6 `localhost`; switched to `127.0.0.1` | monorepo `672446c` |
