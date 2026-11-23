# Plan: shared catalog database + test-gated uploads

## Context

Today the Arena has two catalogs (`arena/src/catalog/catalog.ts`):

- **Public catalog**: binaries committed under `arena/public/catalog/`, listed in `manifest.json`, added by
  a maintainer with `npm run catalog:add`, published by `npm run deploy`.
- **On this device**: anything a visitor imports, kept only in that browser's IndexedDB
  (`arena/src/storage/db.ts`). `importFile()` in `arena/src/app/arena.ts` saves it as soon as the six
  admission stages pass (size → header → hash → contract → transpile → smoke).

Two changes are requested:

1. **A database replaces `manifest.json`.** Visitors upload games from the Arena's Upload page and they
   are shared with everyone; the database is the catalog.
2. **Every upload runs one round of validation and testing first.**
   - If any step fails: save nothing (no database row, no stored file, no local copy) and show the
     error to the user.
   - Only if every step passes: upload the game to the site, then store its information in the database.

## Decisions

**Account (confirmed 2026-11-21): Workers Free, R2 Paid.** On Workers Free every Pages Function request
gets 10 ms of CPU, Functions share a 100,000-requests-per-day allowance (static files do not count), D1
allows 500 MB per database, and Dynamic Workers and Containers are not available.

| # | Decision | Status | Choice | Why |
|---|---|---|---|---|
| D1 | Storage products | default | **D1** (Cloudflare's SQLite) for entrant info, **R2** for the `.wasm` bytes keyed by SHA-256 | A D1 value/row is capped at 2 MB; entrants may be 24 MiB. |
| D2 | Server code | default | **Pages Functions** in `functions/` on the existing `jungle-leaderboard` Pages project; only `/api/*` invokes them | `wrangler pages deploy` already publishes `dist/` and picks up `functions/`. Keeping static files off the Functions route keeps them out of the daily request allowance. |
| D3 | Where the test runs | **confirmed by the account** | **In the uploader's browser**, reusing the existing workers; the server re-checks everything it can without executing the binary | A Function cannot run an uploaded `.wasm` (Workers only instantiate pre-compiled modules), and the products that can run untrusted code need Workers Paid. |
| D4 | What the upload test is | **confirmed** | A **functional test against the spec**: does this file meet the requirements to be matched with the existing games? It runs headless (no boards drawn on screen, no animation). It ends with **one match round, exactly as in match play: two games against a reference opponent, each program moving first once** (`planSeries` in `arena/src/match/series.ts`). Winning is not required; the uploaded game must finish both games with a referee result and no forfeit or system error. | User's definition. Reusing `series.ts` means "one round" cannot drift from match play. |
| D5 | Reference opponent | default | A **maintainer-flagged** catalog entry (`is_reference = 1`), seeded with the sample game | Today it is "the first program in the public catalog"; with public uploads any stranger could become every uploader's opponent. |
| D6 | Registration order | **confirmed** | During the test the file exists **only in the page's memory**. Nothing goes to R2, D1 or IndexedDB until every check and both games pass. Only then is the file sent, re-checked by the server, stored in R2, and registered in D1. | User's requirement: no DB registration before the test passes. |
| D7 | "On this device" | default | Uploading means publishing: no new device-only entries; IndexedDB stays as a cache of downloaded bytes, transpiles and replays. Entries imported before the change stay listed until deleted. | One path is simpler to explain and test. |
| D8 | Abuse controls | default | **Turnstile** on upload, a per-uploader daily quota, a `status` column so a maintainer can hide an entry | Public, anonymous uploads need a bot check and a brake. The site is on `pages.dev`, so WAF rate rules are not available. |

## Measurements (2026-11-21, Node 26 on the dev machine, the Arena's own loader and referee)

**File sizes.** The real sample game, with its art atlas and labels, is 121,149 bytes (118 KiB); the
test entrant is 48 KB. The brief expects "a few hundred KiB". The 24 MiB cap is a ceiling, not a typical
size. Only an embedded neural network would push an entrant into megabytes, and the big language runtimes
(Python, JS engines) need WASI imports, which the contract check rejects. Expect 50 KB to 2 MB.

**Upload test duration** (contract, transpile, smoke, then the two-game round at 20,000 nodes, every
revision rendered for both panes):

| Step | Sample game | Test entrant |
|---|---|---|
| Contract check | 90 ms | 2 ms |
| jco transpile | 365 ms | 86 ms |
| Smoke test | 122 ms | 21 ms |

| Round (uploaded vs reference) | Game 1 | Game 2 | Round total |
|---|---|---|---|
| sample vs sample | 100 plies, no-capture draw | 100 plies, no-capture draw | **14.3 s** |
| sample vs test entrant | 35 plies, den win | 38 plies, den win | 3.3 s |
| test entrant vs sample | 38 plies, den win | 35 plies, den win | 3.3 s |

The sample game averages about 34 ms per move at 20,000 nodes (slowest 57 ms). Rendering both panes
costs about 18 ms per revision, roughly half of the round. With the sample game as the reference opponent,
the whole Node test takes about 15 s. In the browser, worker messaging and 1 MB frames add overhead, so
expect **about 20–30 s**. The file upload itself is under a second at these sizes. No budget reduction is
needed.

**In Chrome (Phase 0, Chromium 159, `conformance.html` on the built site):** admission 0.6 s, behaviour
checks 0.3 s, loading the reference opponent 0.8 s, then three games of 5.6–5.9 s each, 19.0 s in total.
The upload test (two games, no self-play) is therefore **about 13 s**, below the Node-based estimate.

**Hashing cost (server CPU).** SHA-256 takes about 1 ms for 1 MiB and 29 ms for 24 MiB. A typical
entrant would fit Workers Free's 10 ms even if hashed in JS; a file near the cap would not. Letting R2
verify the hash keeps every size safe.

## Architecture

```
Upload page (browser)                                   Cloudflare Pages
┌──────────────────────────────────────────────┐        ┌───────────────────────────────────┐
│ 1. admission: size→header→hash→contract→      │        │ GET  /api/catalog/manifest.json   │
│    transpile→smoke          (existing workers)│        │      → D1 rows, same JSON format  │
│ 2. behaviour checks: render-doesn't-change-   │        │ GET  /api/catalog/<sha256>.wasm   │
│    choice, two-instances-isolated, flip       │        │      → stream from R2             │
│ 3. one match round vs the reference opponent: │        │ POST /api/catalog                 │
│    2 games, each moves first once, headless   │        │      Turnstile → quota → size →   │
│ any failure → show stage + reason, STOP       │        │      header → metadata → dup →    │
│ all pass → Turnstile token → POST ───────────────────▶ │      R2 put (sha256 verified)     │
│ 201 → "Published" + Play in left/right seat   │ ◀───── │      → D1 insert                  │
└──────────────────────────────────────────────┘        └───────────────────────────────────┘
```

**Nothing is written anywhere before the server's last check passes.** The browser saves nothing locally
until the server accepts the upload; the server puts the file in R2 only after its own checks pass, and
inserts the D1 row only after R2 confirms the bytes. If the insert fails, the Function deletes the
object it just wrote. The catalog lists only D1 rows, so a stray object can never appear.

### What the server checks itself (it cannot run the binary)

| Check | How, within the Free plan's 10 ms CPU per request |
|---|---|
| Bot / CSRF | Turnstile token verified with Siteverify (network wait, not CPU) |
| Quota | `upload_quota` row keyed by a salted hash of the client IP + UTC date; no raw IPs stored |
| Size ≤ 24 MiB | `Content-Length`; body streamed, never buffered |
| Component header | First 8 bytes equal `00 61 73 6d 0d 00 01 00` |
| SHA-256 | Client sends the hash; R2 `put(..., { sha256 })` rejects bytes that do not match, so the Function never hashes 24 MiB in JS |
| Metadata | The shared `checkMetadata()` (rules ID and digest byte-exact, non-empty fields, ≤ 160 chars, control characters stripped) |
| Duplicate | `sha256` is the primary key: identical bytes return the existing entry (200), not a new row |

The behaviour results (contract, smoke, checks, games) come from the uploader's browser and are stored
as a report for display. A modified client could skip them; v1 limits the damage instead of preventing
it: every visitor's loader still re-validates size, header, hash, contract and transpile before a match,
seats run in workers with deadlines so a misbehaving entrant only forfeits, a newly added check compares
`info()` against the listed metadata, and a maintainer can hide an entry. Phase 6 makes the gate
authoritative.

### Data model (`migrations/0001_entrants.sql`)

```sql
CREATE TABLE entrants (
  sha256         TEXT PRIMARY KEY CHECK (length(sha256) = 64),
  size           INTEGER NOT NULL CHECK (size > 0 AND size <= 25165824),
  title          TEXT NOT NULL,
  game_version   TEXT NOT NULL,
  model          TEXT NOT NULL,
  code_agent     TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  runtime        TEXT NOT NULL,
  rules_id       TEXT NOT NULL,
  rules_digest   TEXT NOT NULL,
  provenance     TEXT,            -- JSON {language, source, toolchain}; maintainer entries only in v1
  credits        TEXT,
  report         TEXT NOT NULL,   -- JSON: stages, checks, both games, loader version, browser
  status         TEXT NOT NULL DEFAULT 'listed' CHECK (status IN ('listed', 'hidden')),
  is_reference   INTEGER NOT NULL DEFAULT 0,
  uploader       TEXT,            -- salted IP hash, for quotas and abuse review only
  created_at     TEXT NOT NULL
);
CREATE INDEX entrants_by_title ON entrants (status, title, created_at);

CREATE TABLE upload_quota (
  bucket TEXT PRIMARY KEY,         -- '<uploader hash>|<YYYY-MM-DD>'
  count  INTEGER NOT NULL
);
```

The list endpoint returns the **existing `manifest.json` format** (`PublicEntry` with
`file = "<sha256>.wasm"`) plus a `reference` flag, so `parseManifest`, `mergeCatalog`, `groupByTitle` and
the hash-verifying `fetchPublicBinary` keep working. Only `catalogBase()` in `arena/src/app/paths.ts`
changes, to the API path.

## Phases

### Phase 0 — Spike (gate for the rest) — **done 2026-11-21**
Results: a 24 MiB raw body streamed into local R2 with the `sha256` option was stored and read back
byte-identical as `application/wasm`; a wrong hash was rejected (R2 error 10037) and left no object at
a new key; the upload test takes about 13 s in Chrome (see **Measurements**). CPU time cannot be
measured locally (wrangler does not enforce it); check it in Workers logs after the first deploy.
Local tooling needed the Visual C++ 2015+ runtime on Windows, and `compatibility_date` must not exceed
the pinned workerd's 2026-08-18.
- Minimal `wrangler.toml` (`pages_build_output_dir = "dist"`, `[[d1_databases]]`, `[[r2_buckets]]`),
  one Function, `npx wrangler pages dev dist` with local D1 and R2.
- Prove the risky parts: stream a 24 MiB raw body into local R2 with the `sha256` option (mismatch
  rejected), and stay inside the Free CPU limit; read it back with `content-type: application/wasm`.
- Confirm the measured ~15 s Node test lands near the 20–30 s estimate in a real browser (Chrome) with
  the sample game as the reference; record the figure in **Measurements**.

### Phase 1 — Database and read path (TDD) — **done 2026-11-21, not yet deployed**
As built: one route, `functions/api/catalog/[file].ts`, serves both `manifest.json` and
`<sha256>.wasm` (logic in `server/catalog-read.ts`); server tests run against real local D1/R2 via
wrangler's `getPlatformProxy` instead of `@cloudflare/vitest-pool-workers` (no new dependency). Pulled
forward from Phase 4 so every suite stays green: the seed move to `seed/catalog/` (+ `seed.json` with
the reference flag), `catalog:add` writing there, `db:migrate`/`db:seed`/`dev:full`, the Vite `/api`
proxy, and Playwright/conformance starting `scripts/api-server.ts`. `npm run deploy` refuses to run
until the production database id replaces the placeholder in `wrangler.toml` (Phase 5).

Original plan:
- `migrations/0001_entrants.sql` as above; `.wrangler/` added to `.gitignore`.
- `functions/api/catalog/manifest.json.ts` (GET list of `listed` rows) and
  `functions/api/catalog/[file].ts` (GET binary from R2, immutable cache headers, 404 for hidden).
- Pure request logic in `functions/_lib/` (row ↔ `PublicEntry` mapping, header check, quota keys),
  unit-tested in the existing Vitest suite.
- Handler tests against real local D1/R2 with `@cloudflare/vitest-pool-workers` in a separate
  `vitest.workers.config.ts` project.
- Switch `catalogBase()` and the conformance `loadOpponent()` (now: the `reference` entry).

### Phase 2 — Upload API (TDD) — **done 2026-11-22, not yet deployed**
As built: `functions/api/catalog/index.ts` → `server/catalog-upload.ts`, in the plan's order, with the
Turnstile token in an `X-Turnstile-Token` header. The quota is 20 attempts per uploader per UTC day
(`migrations/0002_upload_quota.sql`; an attempt that passes Turnstile counts, published or not),
consumed atomically. The body is peeked for the 8-byte preamble, then pumped through workerd's
`FixedLengthStream` — R2 put accepts only known-length streams, which also means the Node-side
tests cannot stream into real R2 through `getPlatformProxy`: they use real D1 plus a fake R2 that
keeps the sha256-rejection behaviour (`server/fake-r2.test-support.ts`), and the real path was
verified over HTTP against `wrangler pages dev` (201 → duplicate 200 → hash-mismatch 400 → bytes
identical). The duplicate answer is given from the claimed hash alone, before the bytes are verified:
an honest client hashes its own bytes, and a lying one gains nothing. A hidden entry's bytes are
refused (400), never resurrected. Missing secrets fail closed (503); local values live in `.dev.vars`
(see `.dev.vars.example`). Before this phase, e2e (143 passed, 2 skipped, all five projects incl.
Firefox) and conformance (passed) were re-run green after the Phase 1 and two-game changes.

Original plan:
- `functions/api/catalog/index.ts` `onRequestPost`: raw `application/wasm` body; `X-Entrant-Sha256`,
  a base64url JSON `X-Entrant-Report` (metadata + round report) and the Turnstile token in headers.
  Order: Turnstile → quota → size → header → metadata → duplicate → R2 put → D1 insert.
- Responses: `201 {entry}`, `200 {entry, existing: true}`, `4xx {stage: 'server', reasons: [...]}`.
- Tests for every rejection path assert **no R2 object and no D1 row** afterwards, plus the R2-ok /
  D1-fail rollback and two concurrent uploads of the same bytes.
- Secrets: `TURNSTILE_SECRET`, `UPLOADER_SALT` (`wrangler pages secret put`); Turnstile's always-pass
  test keys locally and in CI.

### Phase 3 — Test-gated upload in the browser — **done 2026-11-22, not yet deployed**
As built (Part A of [`PLAN-elo-ratings.md`](PLAN-elo-ratings.md), progress in
[`HANDOFF-elo-ratings.md`](HANDOFF-elo-ratings.md)): `runUploadRound` in
`arena/src/conformance/round.ts` reuses the conformance checks and `playMatch` (gained an `onPly`
callback) for the two-game round at `medium`; `importFile` runs admission → round → Turnstile →
`POST /api/catalog` and stores nothing until the server accepts (then only the transpile is cached
locally); `ImportPanel.vue` shows all eleven stages with a live ply count. Device-only entries from
before the change stay playable as friendly matches. Phase 5 below (production setup and deploy)
still awaits the user's go-ahead.
- Extract `runUploadRound(bytes, deps, onProgress)` from `conformance/main.ts` into
  `arena/src/conformance/round.ts`; the conformance page and the Upload page both call it, so the two
  cannot drift. The two games come from `planSeries` (game 2 swaps colours, so each program moves
  first once) and run headless. Pass: both games end with a referee result (den, elimination,
  immobilization or no-capture draw), with no forfeit by the uploaded game and no system error; the
  score does not matter. `playMatch` gains a per-ply progress callback.
- `importFile()` stops writing IndexedDB on admission. New order: round → Turnstile → POST →
  only on `201/200` cache bytes and transpile locally.
- `ImportPanel.vue`: stages become admission (6) + behaviour checks (3) + Game 1 (uploaded game moves
  first) + Game 2 (reference moves first), each game with a live ply count; failures show the stage and every reason; server rejections show
  the server's reason under a "Publishing" stage. Copy changes from "saved on this device" to
  "published to the Arena".
- `prepareEntrant()` compares the seat's `info()` with the listed metadata and refuses a mismatch.
- `CatalogList.vue` / `AboutCatalogs.vue`: one shared catalog, a "Reference" badge, no "On this
  device" section for new uploads.

### Phase 4 — Retire `manifest.json`
- Move the committed sample binary to `seed/catalog/`; delete `arena/public/catalog/`.
- `npm run catalog:add -- file.wasm [--reference] --local|--remote` keeps its Node admission (contract
  + smoke child) and writes R2 + D1 through Wrangler instead of copying files.
- `npm run db:migrate:local`, `db:seed:local`, `dev:full` (`wrangler pages dev dist`), and a Vite proxy
  `/api → :8788` so `npm run dev:arena` still works.
- Replace `public-catalog.test.ts` with a seed-data test; point Playwright's `webServer` and
  `npm run conformance` at `wrangler pages dev` with a throwaway `--persist-to` directory that is
  migrated and seeded first.

### Phase 5 — End-to-end tests and deploy
- Playwright (local D1/R2):
  - `test-entrant-1.1.0` passes the round → visible to a second browser context → playable.
  - Every `broken-*` fixture fails at its admission stage; every `late-*` fixture fails during the
    games → catalog unchanged, R2 empty, IndexedDB has no package.
  - Direct POSTs that skip the UI (bad header, oversize, wrong hash, bad digest, no Turnstile) → 4xx,
    nothing stored.
- One-time production setup: `wrangler d1 create`, `wrangler r2 bucket create`, Turnstile widget,
  secrets, `catalog:add --remote --reference` for the sample game.
- `npm run deploy` gains `wrangler d1 migrations apply <db> --remote` before `wrangler pages deploy`.
- Verify live: upload the good fixture from one browser and see it in another; a broken fixture leaves
  no row (`wrangler d1 execute --remote`) and no object (`wrangler r2 object get`). Then hide the
  fixture entry.
- Update `CLAUDE.md` (architecture, deploy), `sdk/README.md`, `arena_prompt.md`, and the admission
  and "On this device" wording in `wasm_sample/jungle_prompt.md`.

### Phase 6 — Optional, needs Workers Paid: authoritative server-side test
Not possible on the current Workers Free account; listed so the upgrade path is known.
Run the same test on the server before anything is written, so a modified client cannot skip it:
a Cloudflare Container running Node with the existing `loader/node-host.ts`, `scripts/smoke-child.ts`
and a headless match, called by the upload Function; or Dynamic Workers loading the jco output as
`{wasm}` + JS modules. Needs its own spike (CPU time, cold start, cost).

## Risks

- **Workers Free CPU (10 ms per request).** The upload path never hashes or parses the body in JS; if
  the Phase 0 spike still exceeds it, upgrading Workers to Paid (30 s default CPU) is the fix.
- **Workers Free daily requests (100,000).** Only `/api/*` counts. The catalog list is one request per
  page load; binaries are served with immutable cache headers and the Arena already caches bytes and
  transpiles in IndexedDB, so a returning visitor does not download them again.
- **R2 Paid billing.** Storage and operations beyond R2's included allowance are billed; the upload
  quota caps growth. Check current R2 pricing before launch.
- **Upload test duration.** Measured at about 15 s in Node with today's games (see **Measurements**).
  A slower future entrant can use up to 5 s per move, so the UI shows per-game ply progress. The tab
  must stay open; closing it saves nothing, by design.
- **Impersonation.** Anyone can upload a file whose `info()` says another team's title. The Reference
  badge, the stored report and the hide command are the v1 answer; per-uploader identity would need
  accounts, which are out of scope.
- **Hiding is not recall.** Binaries are content-addressed and served `immutable` for a year, so hiding
  an entry removes it from the list and makes its URL a 404, but a browser that already downloaded it
  keeps that copy (the loader still re-validates it before every match).
- **Catalog size.** `manifest.json` returns every listed entry in one response (only the listed
  columns, never reports). Add paging before the catalog reaches thousands of entries.
- **Nested-subpath proof.** Today's e2e and conformance runs serve `dist/` under a random nested prefix to
  prove relative URLs; `wrangler pages dev` serves from `/`. Keep one static-only e2e (catalog shows its
  "unavailable" notice) so the relative-URL guarantee stays tested.

## Done when

1. A visitor uploads a passing game, watches every stage pass, and the game appears for every other
   visitor; the row exists in D1 and the bytes in R2, with matching SHA-256.
2. A failing game shows the failing stage and reasons, and leaves nothing in D1, R2 or IndexedDB.
3. The same flows pass locally (`wrangler pages dev`, local D1/R2) and on the live site.
4. `manifest.json` and `arena/public/catalog/` are gone; `npm test`, `npm run test:e2e` and
   `npm run conformance` pass.
