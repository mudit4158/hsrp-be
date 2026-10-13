# End-to-end test cases and run plan (simulator)

**Last updated:** 12 Oct 2026

Fourteen end-to-end test cases for the new-vehicle flows. The happy flows come first, then the error flows. **Each
case runs alone, from order to final state, before the next one starts.** The scripted simulator (`pnpm sim`,
in `sim/`) runs them on screen:

- **Browser:** your installed Chrome, one window per role, stacked so switching role is instant.
- **Phone:** the Android emulator, for dealer inward and fitment.
- **What you see:** a visible cursor, a ripple on each click and a caption for each step.

Prerequisites:
- the backend and web app are running (`docker compose up -d` in hsrp-dms-be and hsrp-dms-fe);
- the Android emulator is running with the **debug** dealer app installed (`./gradlew assembleDebug`, then
  `adb install -r`);
- Google Chrome is installed (`SIM_BROWSER=msedge` uses Edge instead).

Each run writes `sim/output/<run>/report.md`, plus web and phone screenshots of any failed step (git-ignored).

## Run plan

| Stage | ID | Kind | Title |
| --- | --- | --- | --- |
| 0 | D-00 | setup | Prepare test data (every run) |
| 1 | TC-01 | happy | OEM vehicle data file |
| 2 | TC-02 | happy | New car: order to completion |
| 3 | TC-03 | happy | New two-wheeler: order to completion (sticker skipped) |
| 4 | TC-04 | happy | Reports and audit trail of the completed orders |
| 5 | TC-13 | happy | Postpaid OEM: dispatched plates billed to the dealer |
| 6 | TC-14 | happy | Bulk upload of OEM data from the admin portal |
| 7 | TC-05 | error | Chassis not in the OEM data → rejected |
| 8 | TC-06 | error | Chassis and engine do not match → rejected |
| 9 | TC-07 | error | Cancelled after confirmation → wallet refunded |
| 10 | TC-08 | error | QC rejects a plate → re-issued → completed |
| 11 | TC-09 | error | Dealer rejects a plate at inward → new challan → completed |
| 12 | TC-10 | error | VAHAN down at fitment → retry and replay → completed |
| 13 | TC-11 | error | Embossed plate shows another number → OCR fails → re-issued → completed |
| 14 | TC-12 | error | Fitment photo shows another number → fitment refused → retaken → completed |

| Command | What it does |
| --- | --- |
| `pnpm sim` | All cases in the order above |
| `pnpm sim --case TC-02,TC-08` | Only these cases (data preparation still runs first) |
| `pnpm sim --from TC-05` | From TC-05 to the end |
| `pnpm sim --kind happy` | Only the happy flows (`--kind error` for the error flows) |
| `pnpm sim --speed fast --pace 1.5` | Pace preset (`slow`, `normal`, `fast`) and a multiplier for every pause, cursor move and keystroke (1.5 = 50% slower) |
| `pnpm sim --manual` | Waits for a click on the case card's "Start" button before each case |
| `pnpm sim --keep-open` | Leaves the windows open at the end |
| `pnpm sim --list` | Prints the run plan (every case and step) from the code |
| `pnpm sim:check` | Type-checks the simulator |

### Users and screens

| Actor | Where | User |
| --- | --- | --- |
| Admin / operations | Chrome window "Operations / admin" | `admin` |
| Embossing station | Chrome window "Embossing station" | `station.kol` |
| Dealer (web) | Chrome window "Dealer WB01" | `dealer.wb01` |
| Dealer (app) | Android emulator, debug dealer app | `dealer.wb01` |

All passwords are `SEED_PASSWORD` from `hsrp-dms-be/.env`; the simulator reads it and never prints it.

## D-00 Prepare test data (runs at the start of every run)

Every run creates its own data, so the simulation can be repeated any number of times.

1. For every vehicle the selected cases declare, the simulator registers a new fictional Kranti Autos vehicle in
   mock VAHAN (state WB, dealer WB01, registered in the last 20 days, BS-VI). It does this through
   `POST /simulator/new-vehicle-demo` with one spec per vehicle.
2. Kranti's vehicle data file is built for the same vehicles. It leaves out those marked "not in OEM file" and
   adds two rows the import must refuse.
3. The Simulator page shows the data sheet: case, registration, chassis, engine to type, model, and whether the
   vehicle is in the file.
4. If TC-01 is not selected, the file is uploaded in the background so later cases still find their vehicles.

| Case | Vehicle | Category | In OEM file | Note |
| --- | --- | --- | --- | --- |
| TC-02 | car | LMV | yes | |
| TC-03 | bike | 2WN | yes | |
| TC-05 | bike | 2WN | **no** | left out on purpose |
| TC-06 | car | LMV | yes | order uses a different engine number |
| TC-07 | car | LMV | yes | |
| TC-08 | car | LMV | yes | |
| TC-09 | bike | 2WN | yes | |
| TC-10 | bike | 2WN | yes | |
| TC-11 | bike | 2WN | yes | front plate first photographed with another number |
| TC-12 | bike | 2WN | yes | first fitment photo shows another number |
| TC-13 | car | LMV | — | **Zenmo** vehicle (postpaid OEM), in Zenmo's mock catalogue |
| TC-14 | car, bike | LMV, 2WN | — | **Zenmo** vehicles, loaded by the bulk upload in the case |

Stock and money per run: about 32 plates from the Kolkata boxes and about ₹5,000 of the WB01 wallet. Reseed
(`docker compose down -v`, then `up`) when the boxes or the wallet run low.

## Plate photo OCR (in every case that reaches production)

Two OCR checks guard the registration number on the physical plates (decision D45):

- **After embossing (station, QC screen):** **Upload photos** → a photo of each embossed plate → **Read the
  photos**. OCR must read the order's registration number on every plate; until it does, **Pass** stays disabled.
- **At fitment (dealer app):** the front and rear plate photos are read by the server before the fitment is
  recorded; a photo that does not read the order's number refuses the fitment (the app lists it as failed with
  the reason).

A reading passes only when it contains the ordered number exactly (spaces and punctuation ignored). The
simulator draws HSRP-style plate photos for the station; on the phone the debug **Test photo** draws the order's
number (**Test photo (wrong number)** draws another one). Every reading is on the order's Plates tab and in the
**Plate photo checks (OCR)** report.

## Happy flows

### TC-01 OEM vehicle data file
- **Goal:** Kranti's vehicle data file is imported; good rows are kept, bad rows go to the error report.
- **Steps:**
  1. Admin opens Simulator and clicks **Send Kranti file to the import**.
  2. Admin opens OEM files & uploads and opens the new file.
  3. Admin closes it, opens **OEM vehicle data on file** and searches TC-02's chassis.
- **Expected:**
  - One accepted row per vehicle in the file.
  - 2 refused rows: "Chassis No is required", and "Dealer WB02 is not a Kranti Autos (fictional) dealer".
  - TC-02's chassis is listed with engine, model, dealer WB01 and invoice.

### TC-02 New car: order to completion
- **Goal:** the full lifecycle of a car with a third registration sticker.
- **Steps:**
  1. Dealer (web) places the order: New vehicle, OEM Kranti, registration, chassis, engine, owner.
  2. The order is **Confirmed**. The Validation tab shows OEM vehicle data, VAHAN, state rules and pricing all
     PASS.
  3. Station: Issuance (dealer WB01, the order, box suggestions, Lock boxes, Allocate & create job card), then
     the job card PDF.
  4. Station: Quality check → **Upload photos** of the front and rear plates → **Read the photos**: OCR reads the
     registration number on both and they match. **Pass** is now enabled → **Pass**.
  5. Station: Sticker printing → **Print**; the sticker PDF opens.
  6. Station: Delivery challans (dealer WB01, the order, Create challan); the challan PDF opens. The order is
     **Dispatched**.
  7. Dealer app: Inward → Refresh → the challan → Accept all → Submit inward → Sync. The order is **Inwarded**.
  8. Dealer app: Fitment → search the registration → Record fitment. Tick the laser-code confirmation, take the
     front and rear photos (Test photo), then Submit fitment. The server's OCR reads both photos as the order's
     number, and the order is **Fitted**.
  9. VAHAN accepts the post. The dealer's order page shows **Completed**, with the fitment photos on the
     Fitment & VAHAN tab.
- **Expected:**
  - Status path: Received → Validated → Confirmed → Issued → QC passed → Sticker printed → Dispatched →
    Inwarded → Fitted → Completed.
  - The wallet hold is captured, and the owner gets the "fitted" SMS.

### TC-03 New two-wheeler: order to completion
- **Goal:** the same lifecycle for a two-wheeler; no sticker is needed, so that step is skipped automatically.
- **Steps:** as TC-02, without step 5. After QC passes, the order goes straight to "Sticker printed (not
  required)".
- **Expected:** Completed; the plate sizes are 285×45 front and 200×100 rear.

### TC-04 Reports and audit trail
- **Goal:** everything that happened in TC-02 and TC-03 can be traced.
- **Steps:** admin opens Reports and runs each of these:
  1. **Order history** for TC-02's order: every status change with time, trigger and user.
  2. **Order validation results** for TC-02's order.
  3. **Laser code audit** for TC-02's order: each plate's job card, QC, challan, inward, fitment and VAHAN.
  4. **OEM history**, filtered to OEM KRANTI: the vehicle file, the orders checked against it and their
     results.
  5. **Fitments and VAHAN posts**.
- **Expected:** rows for both orders; both laser codes of each order are traced through to Fitted and Posted.

### TC-13 Postpaid OEM: dispatched plates billed to the dealer
- **Goal:** a postpaid OEM's order needs no wallet; once its plates are dispatched it is billed in the cycle to the
  party set for the OEM × dealer pair (decision D46).
- **Steps:**
  1. Admin: **Billing → Setup**: Zenmo is postpaid (monthly); set "Bill to" for WB01 to the dealer.
  2. Dealer (web) orders the Zenmo car (OEM Zenmo). It is **Confirmed** without a wallet hold; the Payment tab says
     "Postpaid: billed to WB01 …".
  3. Admin: **Billing → Unbilled charges**: the order's charge is pending.
  4. Station: issuance, plate photos (OCR), QC pass, sticker, challan. The order is **Dispatched**.
  5. Admin: the charge is now billable. **Bills → Run billing now** (Zenmo): a bill to WB01 with the order; open it
     and its PDF.
  6. Admin: **Simulator → SMS & e-mail**: the bill e-mail to the dealer.
  7. The WB01 bill-to setting is put back as it was.
- **Expected:** no wallet movement for the order; one bill to WB01 with the order and its amount, sent by e-mail.

### TC-14 Bulk upload of OEM data from the admin portal
- **Goal:** any OEM, including the API-integrated Zenmo, can also send data as a bulk file in the standard template
  (decision D47).
- **Steps:**
  1. Admin: **OEM files & uploads → Bulk upload OEM data**: OEM Zenmo, Data "Vehicle data"; the template download is
     next to the upload button.
  2. Attach the filled template (the case's two vehicles for WB01, plus a row for WB03, which does not sell Zenmo)
     → **Upload and load**.
  3. The file opens: 2 rows loaded, 1 refused ("Dealer WB03 is not a Zenmo Motors (fictional) dealer").
  4. **OEM vehicle data on file**: search the first chassis; it is listed for Zenmo and WB01.
- **Expected:** 2 vehicles on file for Zenmo, 1 row in the error report.

## Error flows

### TC-05 Chassis not in the OEM data
- **Steps:**
  1. Dealer (web) places the order for the vehicle left out of the file.
  2. The Validation tab is shown.
- **Expected:**
  - **Rejected** at the "OEM vehicle data" step: "Chassis … is not in Kranti Autos (fictional)'s vehicle data".
  - No money is held, and the owner gets the rejection SMS.

### TC-06 Chassis and engine do not match
- **Steps:**
  1. Dealer (web) places the order with the engine number from the sheet's "Engine to type" column.
  2. The Validation tab is shown.
- **Expected:**
  - **Rejected**: "Engine … does not match Kranti Autos (fictional)'s record for chassis … (engine ending
    …)".
  - No money is held.

### TC-07 Cancelled after confirmation
- **Steps:**
  1. Dealer (web) places the order; it is **Confirmed**.
  2. **Cancel order** with a reason.
  3. Dealer opens My wallet.
- **Expected:** **Cancelled**; the wallet shows a HOLD and then a REFUND of the same amount.

### TC-08 QC rejects a plate
- **Steps:**
  1. Order placed, then Issuance as in TC-02.
  2. QC: plate photos pass OCR; then **Reject**, tick FRONT, reason "Hologram misaligned". The order goes to **Rejection review**.
  3. Rejection approval → **Decide** → remarks → **Approve (re-issue)**. The order is **Confirmed** again, with
     FRONT pending.
  4. Issuance re-issues the front plate on a new job card; its photo is checked by OCR.
  5. QC passes, the sticker is printed, a challan is created, and the dealer app does inward and fitment.
  6. Laser code audit for the order.
- **Expected:**
  - **Completed**.
  - The audit shows the first front plate with QC REJECT, closed and scrapped, and the new front plate fitted.

### TC-09 Dealer rejects a plate at inward
- **Steps:**
  1. Order placed, issued, passed by QC and dispatched.
  2. Dealer app: Inward → **Accept** the front plate, **Reject** the rear with reason "Bent in transit" →
     Submit. The order goes to **Rejection review**.
  3. Station approves (re-issue) and re-issues the rear plate; its photo is checked by OCR.
  4. QC passes; **a new challan** carries only the rear plate.
  5. Dealer app inwards it, then fitment.
  6. The Plate rejections report.
- **Expected:**
  - **Completed**, with two challans for the order.
  - The rejection report shows the dealer-inward rejection as APPROVED.

### TC-10 VAHAN down at fitment
- **Steps:**
  1. Order placed, issued, passed by QC, dispatched and inwarded.
  2. Admin: Simulator → VAHAN mock **down**.
  3. Dealer app records fitment. The order stays **Fitted**, and Integration monitor shows the VAHAN post
     failing ("VAHAN not reachable").
  4. Admin: VAHAN mock **normal**, then Integration monitor → **Replay all VAHAN posts**.
- **Expected:**
  - **Completed** after the replay.
  - The simulator always switches VAHAN back to normal, even if the case fails.

### TC-11 Embossed plate shows another number
- **Goal:** the photo check after embossing catches a plate embossed with the wrong number before it leaves the
  station.
- **Steps:**
  1. Order placed (two-wheeler) and issued.
  2. Station: **Upload photos**; the front plate photo shows another number. OCR reads it, the result is "does
     not match", and **Pass** stays disabled.
  3. QC → **Reject** the front plate, reason "Wrong registration number embossed (photo OCR)".
  4. Rejection approval → **Approve (re-issue)**; Issuance re-issues the front plate.
  5. **Upload photos** again: both plates read the right number; QC **Pass**.
  6. Challan, dealer inward and fitment as usual; the order completes.
  7. **Plate photo checks (OCR)** report for the order.
- **Expected:**
  - The wrong plate is never dispatched; the order completes with the re-issued plate.
  - The report shows the failed reading (what was read, and that the order is for another number) and the
    passing ones.

### TC-12 Fitment photo shows another number
- **Goal:** OCR at fitment refuses a fitment whose plate photo shows another number (wrong vehicle or wrong
  plate).
- **Steps:**
  1. Order placed (two-wheeler), issued, plate photos pass, QC passed, dispatched and inwarded.
  2. Dealer app: Record fitment with **Test photo (wrong number)** for the front plate → Submit fitment.
  3. The server reads the front photo, refuses the fitment ("Fitment refused: front plate photo: Photo reads …,
     the order is for …"); the Sync list shows it as failed with that reason. The order stays **Inwarded**.
  4. Dealer app: Record fitment again with the right photos; the order is **Fitted**, then **Completed**.
  5. **Plate photo checks (OCR)** report for the order.
- **Expected:**
  - No fitment is recorded from the wrong photo; the refused attempt is kept for audit ("Fitment (dealer) —
    refused").
  - The order completes after the right photos.

## Adding a test case

1. Create `sim/cases/tc-NN-<name>.ts` that exports a `TestCase` (`sim/core/types.ts`):
   - `id`, `title`, `kind` (happy or error), `goal`, `expected`;
   - the `vehicles` it needs (the data preparation stage creates them);
   - `steps` built from the shared steps in `sim/scenes/`.
2. Add it to `sim/cases/index.ts` in run order: happy before error.
3. Add a section to this file, then run it alone with `pnpm sim --case TC-NN`.

## Notes for a smooth run

- **Lag:** the run is scripted, so there's no pause between actions.
  - Role changes switch between stacked windows instead of signing out and in.
  - Menu clicks are in-app navigation, not page reloads.
  - The order page refreshes itself every 2 s while the server is still moving the order on.
- **Fast phone reads:** the debug dealer app has an automation bridge (`app/src/debug/.../AutomationBridge.kt`).
  It answers screen reads in milliseconds instead of the ~3 s of `uiautomator dump`. It exists only in debug
  builds.
- **Keyboard on the emulator:** the simulator switches off Gboard's stylus tutorial
  (`stylus_handwriting_enabled 0`), which otherwise pops up over the app and swallows typed text. Phone typing is
  checked through the bridge and retyped slowly if characters were lost.
- **Layout:** keep the emulator window on the right; the browser windows leave `SIM_PHONE_PANEL` (default
  470 px) free for it.
