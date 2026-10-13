---
name: maintain-docs
description: Keeps an HSRP DMS repo (hsrp-be, hsrp-fe or hsrp-mobile-app) documented and consistent. Use after ANY change to code, schema, config, scripts, API, screens or setup, before every commit, when picking up or finishing a tracker item, when a design choice is made, and when the user asks to update docs, the tracker or the decision log. Updates README.md, AGENTS.md, docs/TRACKER.md, docs/DECISIONS.md and the HLD decision log, keeps the shared contracts in step across repos, and runs the checks.
---

# maintain-docs

The three HSRP DMS repos sit side by side under `C:\workspace\hsrp\`:

| Repo | Owns |
| --- | --- |
| `hsrp-be` | API, database, seed, `demo:e2e`, **contracts** (`packages/contracts`), **decision log** (`docs/DECISIONS.md`), system tracker |
| `hsrp-fe` | Web app, its tracker, a synced copy of the contracts (`src/contracts`) |
| `hsrp-mobile-app` | Dealer app, its tracker, Kotlin API models (`app/src/main/java/com/hsrp/dealer/data/Api.kt`) |

Documentation is part of the change. Do this routine **before committing**, in the repo you changed (and in the
sibling repos when the change crosses repos).

## 1. See what changed

```bash
git status --short
git diff --stat
git diff --cached --stat
```

Classify each change: behaviour, setup/commands/env, structure/conventions, API contract, schema, design choice,
fixed or new open work. Purely internal refactors with no visible effect may need no doc change; say so in the commit
message.

## 2. Update the documents that the change touches

| Change | Update |
| --- | --- |
| New or changed command, script, env var, port, prerequisite | `README.md` (how to run), `AGENTS.md` (Commands table), `.env.example` |
| New folder, module, convention, rule, gotcha | `AGENTS.md` (Layout / Conventions / Gotchas); bump its **Last updated** date |
| A demo flow changed | `README.md` click-through; backend `scripts/demo-e2e.ts` |
| Work finished | Move the tracker row to **Done** with the commit hash |
| Work found, deferred or blocked | Add a tracker row (next free ID in its section; never reuse an ID) |
| A choice not covered by an existing decision | New decision (step 3) |

Tracker rules (`docs/TRACKER.md`):
- Each item lives in **one** tracker: the repo where the work happens. Items spanning repos, business questions and
  hardening live in the **backend** tracker with a `Repos` column (BE, FE, AND).
- Columns: ID, Item, (Repos,) Priority, Status, Notes. Status is one of `Open`, `In progress`, `Blocked`, `Done`.
  Priority: P1 breaks or blocks a demo flow, P2 needed before real use, P3 nice to have.
- Notes say what to do and where (file paths), and what it is blocked on.
- Update **Last reviewed** at the top whenever you edit it.

## 3. Record decisions (backend owns the log)

1. Read `hsrp-be/docs/DECISIONS.md`; take the next number (`D42`, …).
2. Append a row: `| Dnn | Open point | Decision | Claude Code, <d Mon yyyy> |` (add "(user request)" when the user
   decided). Never edit or renumber existing rows.
3. Append the same row to the HLD table "Prototype defaults and decision log" in the Claude Doc
   https://claude.ai/code/artifact/d7fce61b-0fe9-4bae-a8b2-7286684b9de4 with the Claude Docs connector: read the doc
   first (view `sinceRev` from your last read), then insert a row at the end of that table only. If the connector is
   not available, tell the user which rows need copying.
4. If the decision changes behaviour described elsewhere, update README.md / AGENTS.md too.

## 4. Keep the repos in step

- **Contracts** changed in `hsrp-be/packages/contracts`:
  `cd ../hsrp-fe && pnpm contracts:sync && pnpm typecheck`, then commit there
  ("Sync contracts from hsrp-be <short hash>"). If the Android app calls the changed endpoint, update the Kotlin
  data classes in `Api.kt` and rebuild (`./gradlew assembleDebug`).
- **This skill or `scripts/docs-check.mjs`** changed: copy the file to the other two repos and commit there too.
- **API URL, ports or auth** changed: check the FE (`vite.config.ts`, `nginx.conf.template`, `.env.example`) and the
  Android defaults (`app/build.gradle.kts` `DEFAULT_API_URL`, Settings screen text).

## 5. Run the checks

| Repo | Run |
| --- | --- |
| hsrp-be | `pnpm docs:check`, `pnpm lint:deps`, `pnpm test` (start `docker compose up -d db` first); if behaviour changed and the API is running: `pnpm demo:e2e` |
| hsrp-fe | `pnpm docs:check` (includes the contracts drift check), `pnpm build` |
| hsrp-mobile-app | `node scripts/docs-check.mjs`, `./gradlew assembleDebug` |

Report failures honestly; do not bypass the pre-commit hook (`--no-verify`) unless the user asks.

## 6. Commit

Commit code and docs together. Message: imperative summary, then what changed in docs (e.g. "Docs: README run
steps, tracker F-01 done"). End with the attribution line the session requires. **Never push without the user's
explicit confirmation.**

## Done when

- `docs-check` passes in every repo you touched.
- README.md tells a new person how to run what you changed; AGENTS.md matches the code.
- Every finished, new or deferred item is in the right tracker; every new decision is in DECISIONS.md and the HLD.
