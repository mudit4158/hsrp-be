# Prototype defaults and decision log

Mirror of the table "Prototype defaults and decision log" in the
[HLD](https://claude.ai/code/artifact/d7fce61b-0fe9-4bae-a8b2-7286684b9de4). If the two disagree, the HLD wins.
D1–D18 were set before the build; D19 onwards were added while building, following handover section 13.

| # | Open point | Prototype default | Added by |
| --- | --- | --- | --- |
| D1 | Role in each state | Both order sources: OEM and dealer orders for new vehicles, customer orders for old vehicles. VAHAN adapter has validate and post-fitment; inventory upload is a logged stub. | Claude, 10 Oct 2026 |
| D2 | States served | West Bengal (base rules) and Odisha (eligibility check, SMS status, published prices). Mobile-number hold is a switch, off. | Claude, 10 Oct 2026 |
| D3 | VAHAN contract | Mock using the sample field names; simulator can make it slow, down or "not found". | Claude, 10 Oct 2026 |
| D4 | OEMs and formats | Two fictional OEMs: one by API with a chassis catalogue check, one by CSV with VAHAN only. | Claude, 10 Oct 2026 |
| D5 | Customer portal, slots, complaints, home fitment | Minimal portal: book, pay, status by OTP, complaints; slot booking included; home fitment behind a switch, off. | Claude, 10 Oct 2026 |
| D6 | Payment gateway and SMS provider | Mock PayU-shaped hosted checkout (signed request, redirect, webhook, verify); mock SMS/e-mail shown on the simulator. | Claude, 10 Oct 2026 |
| D7 | Vendor's product and stack | Unknown; built independently on the D10 stack. | Claude, 10 Oct 2026 |
| D8 | Volumes | Demo scale, one instance, about 200 seeded orders, no load targets. | Claude, 10 Oct 2026 |
| D9 | Several companies | One installation, one seeded company; tenant id on every table. | Claude, 10 Oct 2026 |
| D10 | Technology stack | TypeScript monorepo: NestJS, Prisma, PostgreSQL; React with Vite; Kotlin with Jetpack Compose. | Claude, 10 Oct 2026 |
| D11 | Deployment | Local only: Docker Compose on the user's machine; Android over the emulator or local network; API and worker in one process. | Claude, 10 Oct 2026 |
| D12 | Sign-in during the demo | Password for staff and dealers; OTPs generated normally and shown on the simulator; fixed code accepted only in demo mode; customers OTP only. | Claude, 10 Oct 2026 |
| D13 | File storage | Files in PostgreSQL behind the FileStore port. | Claude, 10 Oct 2026 |
| D14 | Proof of fitment | Front and rear photos required, chassis optional; both configurable. | Claude, 10 Oct 2026 |
| D15 | Android without network | Fitment and inward queue on the device and sync when the connection returns. | Claude, 10 Oct 2026 |
| D16 | Print formats | Simple PDFs for job card, challan, sticker and receipt with the required fields. | Claude, 10 Oct 2026 |
| D17 | Dealer screens: web or Android | Android is the main dealer tool; web gives dealers order placement and tracking only. | Claude, 10 Oct 2026 |
| D18 | Language and locale | English, rupees, IST. | Claude, 10 Oct 2026 |
| D19 | When the dealer/OEM wallet is held and captured | The price needs the vehicle class from VAHAN, so the hold is placed when the order is validated and captured at confirmation. A replacement order keeps the hold while it waits for approval (released if rejected). If funds and credit are short, the order stays VALIDATED with a note and is retried every 2 minutes or on demand. | Claude Code, 11 Oct 2026 |
| D20 | Who pays for an OEM order | OEM API and file orders are charged to the OEM's own wallet, which has a credit limit (₹5 lakh). Dealer and staff orders are charged to the dealer's wallet, shared by its wallet group. | Claude Code, 11 Oct 2026 |
| D21 | What a challan cancellation does to its orders | Cancelling an un-inwarded challan moves its orders from DISPATCHED back to STICKER_PRINTED so they can go on a new challan. This is one transition added to the section 7 table. | Claude Code, 11 Oct 2026 |
| D22 | VAHAN lookups requested by a user | All external calls run from the outbox, including the portal's "validate vehicle" check and the payment verify after the browser returns; the page polls for the result. | Claude Code, 11 Oct 2026 |
| D23 | Chassis and engine numbers on customer orders | The portal collects only the last five characters, so customer orders store those and send them to VAHAN. | Claude Code, 11 Oct 2026 |
| D24 | Several open orders for one vehicle | One open order per registration number. A second order is refused (409) until the first completes, is rejected or is cancelled; the portal's vehicle check says so. | Claude Code, 11 Oct 2026 |
| D25 | Evidence upload from the public portal | Allowed without sign-in for replacement evidence only: images or PDF, 5 MB, rate-limited, deleted after 30 days unless attached to an order. | Claude Code, 11 Oct 2026 |
| D26 | Where the gateway returns the browser | Checkout accepts the portal's own origin when it is PUBLIC_WEB_URL, localhost or a private-network address (so the dev port, Docker port and a LAN address all work); anything else falls back to PUBLIC_WEB_URL. | Claude Code, 11 Oct 2026 |
| D27 | Who decides plate rejections | Station users decide only their own station's cases; admins can decide any. Operations decide replacement orders and dealer onboarding. | Claude Code, 11 Oct 2026 |
| D28 | Which vehicles need the third registration sticker | Set per VAHAN vehicle category in the masters: cars, taxis and heavy vehicles yes; two- and three-wheelers and trailers no (the step is skipped automatically). | Claude Code, 11 Oct 2026 |
| D29 | Dealer onboarding | A dealer added on the masters screen starts PENDING and needs operations approval. It gets an organisation, the wallet of its wallet group and a fitment calendar (Mon–Sat 10:00–17:00, 4 per hour). | Claude Code, 11 Oct 2026 |
| D30 | Android device binding | An Android session is bound to the device id registered at sign-in; deactivating the device on the web ends it. Web sessions are not device-bound. | Claude Code, 11 Oct 2026 |
| D31 | End-of-day alert for VAHAN posts | Once a day after 22:00 IST (setting alerts.vahanEodHourIst), fitments not yet on VAHAN are e-mailed to alerts.opsEmail; it can also be run by hand from the integration monitor. | Claude Code, 11 Oct 2026 |
| D32 | Document numbers | Orders HS + state + YYMM + 5 digits; job cards JCyymm-nnnnn; challans DCyymm-nnnnn; complaints CMPyymm-nnnnn. Sequences are configuration. | Claude Code, 11 Oct 2026 |
| D33 | Retry policy for external calls | 8 attempts (10 for VAHAN validation and posts), back-off from 5 s doubling to a 5-minute cap. Exhausted or refused calls go to the dead-letter (manual) queue and can be replayed singly or per subscriber. | Claude Code, 11 Oct 2026 |
| D34 | Library versions | Pinned to a well-tested set (NestJS 10, Prisma 6.16, Zod 3, React 18, Vite 5) rather than the newest majors; dependency-cruiser 17.1 because 16.x does not run on Node 24. | Claude Code, 11 Oct 2026 |
| D35 | Dashboards and reports across modules | A read-only core "oversight" module builds the dashboard, order detail and reports by calling each module's service; it owns no tables, so rule 7 holds. A build check fails if a module touches another module's tables. | Claude Code, 11 Oct 2026 |
| D36 | Retrying a failed customer payment | The booking is kept and the customer pays again from HSRP Status with the same payment record. A real PayU integration would need a new transaction id per attempt. | Claude Code, 11 Oct 2026 |
| D37 | Customer portal in the prototype | Disabled on request. The code stays in the repo but is detached: the portal module is not loaded (every /api/v1/public route returns 404), the CUSTOMER role grants no permissions, and the web app has no /portal routes or links. Flows D and K are skipped in demo:e2e. Re-enable by importing CustomerPortalModule in core.module.ts, restoring the CUSTOMER role's permissions and the web routes. | Claude Code, 11 Oct 2026 (user request) |
