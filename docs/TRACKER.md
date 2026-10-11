# Tracker — open items and pending fixes

Last reviewed: 11 Oct 2026. Update the row when an item moves; move finished items to **Done** at the bottom with the
commit. Decisions referenced (Dnn) are in [DECISIONS.md](DECISIONS.md).

**Status:** Open · In progress · Blocked (waiting on someone outside the build) · Done
**Priority:** P1 breaks or blocks a demo flow · P2 needed before real use · P3 nice to have

## Fixes

| ID | Item | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| F-01 | Complaint SMS no longer sent | P1 | Open | The `TicketCreated` / `TicketUpdated` SMS subscribers live in `core/customer-portal/customer-portal.service.ts`, which is detached (D37). A staff reply on **Complaints** now updates the ticket but the customer gets no SMS. Move the two subscribers to a core module that stays loaded (e.g. a small `core/complaints` module). |
| F-02 | No way to raise a complaint while the portal is off | P1 | Open | Tickets were only created from HSRP Support. Staff have no "new complaint" screen or endpoint. Add a staff-side create (phone or walk-in complaints) on the Complaints screen. Flow K is skipped in `demo:e2e` until then. |
| F-03 | Payment endpoints still attached | P2 | Open | `/api/v1/payments/webhook`, `/payments/return` and the mock gateway `/mock-gateway/payu/*` belong to the generic payments module and stay live although only the portal used them. Decide: keep (harmless, needed when the portal returns) or gate them too. |
| F-04 | Payment retry reuses the transaction id | P2 | Open | D36. Fine for the mock; real PayU needs a new `txnid` per attempt. Create a new payment row (or attempt row) per checkout before a real gateway is connected. |
| F-05 | Photo EXIF rotation fix not re-verified on device | P3 | Open | Fixed in `apps/android/.../ui/Camera.kt` and the APK rebuilt, but not reinstalled and checked on the emulator. Reinstall, take a photo, confirm the thumbnail and the uploaded image are upright. |
| F-06 | Masters screen calls a hook inside a loop | P3 | Open | `apps/web/src/pages/Masters.tsx` builds reference lookups with `useQuery` inside `map`. Works because the tab remounts per resource, but breaks the rules of hooks. Replace with `useQueries`. |
| F-07 | `demo:e2e` uses up demo vehicles | P3 | Open | Each run consumes vehicles from the `demo-*` and `oem-*-sample` pools; after several runs they run out and a reseed is needed. Let the script create its own fictional VAHAN records instead. |

## Ownership checks (right to order a plate)

Every order is checked with VAHAN (registration + last 5 of chassis and engine, state, existing plates). That proves the
vehicle exists and the person has its documents, **not** that they own it or sold it. Only OEM API orders are fully
vouched for (signed request + chassis in the OEM's catalogue). The VAHAN sample contract (D3) returns no owner name,
owner mobile or selling dealer, which limits what can be checked. Business question: B-04.

| ID | Item | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| O-01 | Customer OTP must go to the VAHAN-registered mobile | P2 | Blocked | Today the portal sends the OTP to whatever mobile the customer types, so it proves a phone, not ownership. Send the OTP to the mobile registered with VAHAN for that vehicle (VAHAN sends it, or returns a masked number we send to). Blocked on the VAHAN contract (D3). Becomes **P1 before the portal is re-enabled** (B-01). |
| O-02 | Dealer must be the selling dealer | P2 | Open | Any dealer with a vehicle's registration, chassis and engine numbers can order for it. Check the vehicle was sold through this dealer: the selling-dealer code on the VAHAN record, or OEM sales/invoice data for the chassis. Interim step: flag (or send to approval) orders where the dealer is not mapped to the vehicle's maker. |
| O-03 | OEM file orders are not vouched for | P2 | Open | Kranti CSV orders get no catalogue check (D4) and staff upload the file, so nothing proves it came from the OEM. Turn on the catalogue check for CSV OEMs, or require signed files / the OEM API instead of staff uploads. |
| O-04 | Replacement approval checklist | P3 | Open | Operations approve replacements by looking at the evidence file. Add a checklist to the approval (name on the evidence matches the owner; police report number and date for theft) so the manual check is consistent and recorded. |

## Fitment proof (are the photos real, is it the right vehicle?)

Today uploads are checked for type (as declared by the upload), size and presence only; the SHA-256 is stored but not
compared. "Right vehicle" rests on the plates' chain of custody (allocated → challan → inwarded by this dealer) and on
the dealer ticking "the plates carry these laser codes" — the app fills the codes in itself. Nothing checks photo
content, location or capture time, and staff only see photos if they open the order. Business question: B-05.

| ID | Item | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| P-01 | Read the laser code off the plate at fitment | P2 | Open | Replace the tick-box: the app reads the code with the camera (on-device text recognition) and sends what it read; the server compares it with the allocation. Mismatch → refuse or flag. |
| P-02 | Check what the photos show | P3 | Open | Read the registration number and laser code from the plate photos and the last 5 of the chassis from a required chassis photo (`fitment.photoRules`); flag mismatches for review instead of posting to VAHAN. Needs reliable plate reading. |
| P-03 | Record where and when photos were taken | P2 | Open | The app sends GPS and capture time (the API already accepts `latitude` / `longitude`). Flag fitments far from the dealer's site, or taken long before submission. Needs dealer site coordinates in the masters. |
| P-04 | Catch reused photos | P2 | Open | Compare each photo's SHA-256 with earlier fitments, plus a perceptual hash to catch lightly edited copies; flag duplicates. |
| P-05 | Trust the capturing device | P2 | Open | Remove the debug "Test photo" button from release builds and add Play Integrity (app attestation) so the server knows uploads come from the genuine app. Links to N-03 (release build). |
| P-06 | Fitment review queue | P2 | Open | Operations review flagged fitments plus a random sample. Flagged fitments are held back from VAHAN until approved (reuse the Approvals utility). |
| P-07 | Owner confirmation | P3 | Open | Put the fitted laser codes in the completion SMS so the owner can report a mismatch through Support. Template change only (`FITMENT_DONE`). |
| P-08 | Stricter file checks | P3 | Open | Detect the real file type from its contents (not the declared type); refuse fitment photos without camera metadata (EXIF). |
| P-09 | Confirm the physical plate at embossing and QC | P2 | Open | Issuance picks the next free code in the box, and the operator is trusted to emboss that physical plate; QC can switch codes by hand. Scan the code at embossing or QC so the allocated code and the physical plate are proven to match. |

## Not built yet

| ID | Item | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| N-01 | Record fitment on the web | P2 | Open | Fitment with photos is Android-only (D17). The API (`POST /api/v1/fitments`) already accepts any client; a web page is needed only if dealers should also record fitment from a desk. No offline queue on the web. |
| N-02 | Real adapters (VAHAN, PayU, SMS/e-mail, OEM) | P2 | Blocked | Each `real` adapter is an empty placeholder. Blocked on the real contracts and credentials (D3, D6). Never call real endpoints from the prototype. |
| N-03 | Android release build and signing | P2 | Blocked | Only the debug APK exists. Needs the user's signing key; release builds also need HTTPS for the API. |
| N-04 | Worker as its own process | P3 | Open | Outbox and scheduled jobs run inside the API (`WORKER_ENABLED=true`). Splitting needs only a second entry point that boots the same module with HTTP off. |
| N-05 | Final print layouts | P3 | Blocked | Job card, challan, sticker and receipt are simple PDFs (D16), not regulatory formats. Needs the official layouts. |
| N-06 | Unit tests for production and dispatch services | P3 | Open | Covered end to end by `demo:e2e` (flows E, F, H) but not by unit tests. |
| N-07 | Separate the repositories | P2 | Open | Today one monorepo holds the separately deployed apps (`apps/api`, `apps/web`, `apps/android`, shared `packages/contracts`). Split into `hsrp-dms-be` (API, Prisma migrations, seed, `demo:e2e`, Docker for API + DB) and `hsrp-dms-fe` (web app, its Dockerfile and nginx config); Android as a third repo or inside the FE repo. Keep each part's git history (`git filter-repo` / subtree split). Decide how `packages/contracts` is shared: copied into each repo, or published as a versioned package. Each repo gets its own README, `.env.example` and compose file; the dependency check and module-table check move with the BE repo. Matches the DocVault layout (`docvault-fe` / `docvault-be`). |

## To verify

| ID | Item | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| V-01 | Android challan inward by hand | P2 | Open | Inward was tested through the API (`demo:e2e` flow F) and the same offline queue was tested on the emulator with fitment, but the inward screen itself was not clicked through on a device. |
| V-02 | Real phone on the same Wi-Fi | P2 | Open | Only the emulator was tested. Follow README section 4 (LAN address, firewall for port 3000, debug APK). |
| V-03 | Vendor issues log against the build | P2 | Open | The [issues and gaps log](https://claude.ai/code/artifact/dff78ee2-6285-4e87-baec-3945c09dfc9c) was not reviewed during the build. Check each item against what was built and add rows here for anything missing. |

## Open decisions (waiting on the business)

| ID | Item | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| B-01 | Re-enable the customer portal? | P2 | Open | Disabled by request (D37). If it comes back: import `CustomerPortalModule` in `core.module.ts`, restore the `CUSTOMER` role permissions, restore the `/portal` route, un-skip flows D and K. Fix F-01 first either way. |
| B-02 | The nine open points behind D1–D9 | P2 | Open | Role per state, states served, VAHAN contract, OEMs and formats, portal scope, gateway and SMS provider, vendor product, volumes, several companies. The prototype uses the defaults in DECISIONS.md. |
| B-04 | How must the right to order be proven? | P2 | Open | Decide the rule per channel: owner (OTP to the VAHAN-registered mobile?), dealer (selling dealer only, or any mapped dealer?), OEM (catalogue / signed data for every OEM?). Also whether VAHAN can return owner or selling-dealer data. Drives O-01 to O-04. |
| B-05 | How strict is fitment proof? | P2 | Open | Per check (P-01 to P-09): block the fitment, or accept it and flag for review? Should flagged fitments wait before the VAHAN post? What sample rate for random review? Is location capture acceptable to dealers? |
| B-03 | Customer accounts | P3 | Open | Customers use OTP only (D12). Fleet owners may want a "My vehicles" login; the identity module already supports OTP sign-in. |

## Before any real use (hardening)

| ID | Item | Priority | Status | Notes |
| --- | --- | --- | --- | --- |
| H-01 | Turn off demo shortcuts | P2 | Open | `DEMO_MODE=false` (no fixed OTP); remove the simulator and mock gateway from non-demo builds. |
| H-02 | Secrets | P2 | Open | API client signing secrets are stored in clear (prototype); move to a secret store. Set strong `JWT_SECRET` and `FILE_LINK_SECRET`. |
| H-03 | CORS and HTTPS | P2 | Open | CORS currently reflects any origin; restrict it. Serve the API over HTTPS. |
| H-04 | Library upgrades | P3 | Open | Pinned to NestJS 10, Prisma 6, Zod 3, React 18, Vite 5 (D34). Plan the upgrade to current majors. |
| H-05 | Repository remote | P3 | Open | The repo is local only, nothing pushed. Create a remote when the team is ready. |

## Done

| ID | Item | Commit |
| --- | --- | --- |
| — | Customer portal detached (D37) | `b9b39fa` |
| — | Flaky DB tests: Jest timeout raised to 30 s | `b9b39fa` |
| — | Docker healthcheck used IPv6 `localhost`; switched to `127.0.0.1` | `672446c` |
