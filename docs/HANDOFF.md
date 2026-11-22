# Handoff — jungle-leaderboard, branch `feat/arena`

Written 2026-11-22 for the next code agent. Facts here were checked on that date unless marked otherwise.

## Read these first

| File | Why |
|---|---|
| [`CLAUDE.md`](../CLAUDE.md) | Commands, architecture, styling and template gotchas, deploy rules. The single source of agent guidance ([`AGENTS.md`](../AGENTS.md) points to it). |
| [`docs/PLAN-shared-catalog.md`](PLAN-shared-catalog.md) | The feature in progress (shared catalog database + test-gated uploads): decisions, measurements, phase status. |
| [`arena_prompt.md`](../arena_prompt.md) | The Arena brief, updated for the multi-page site and full-screen play page. |
| [`wasm_sample/jungle_prompt.md`](../wasm_sample/jungle_prompt.md) | Self-contained brief for building a Jungle game + Arena entrant in a new repository. |
| [`sdk/README.md`](../sdk/README.md) | Entrant contract, admission order, worker protocol, replay format. |

## Where things stand

- **Git:** branch `feat/arena`, tracking `origin/feat/arena` and in sync with it. Three commits ahead of
  `main`: `74974db` Initial arena feature, `1a2b71b` jungle_prompt.md, `bebb9af` two-game matches.
  The shared-catalog work (Phases 0–2 below) is **uncommitted** in the working tree. Commit only when
  the user asks.
- **Nothing is deployed.** The live site (`https://jungle-leaderboard.pages.dev/`) still serves the old
  leaderboard without the Arena. `wasm_sample` has its own Pages project, `jungle-wasm-sample`, never
  created or deployed. Both deploys need the user's go-ahead.
- **Deploy is blocked by design** until the production D1 database exists: `wrangler.toml` holds an
  all-zero placeholder `database_id`, and `scripts/check-deploy-config.mjs` makes `npm run deploy`
  refuse. Creating account resources is outward-facing, so ask first (see CLAUDE.md → Deployment).
- **Several agents have worked on this branch at once.** The briefs and README changed between edits.
  Run `git status` and read the diff before editing anything.

## What is built

| Area | State |
|---|---|
| Leaderboard (`/`) | Unchanged Astro page. |
| Arena pages | Upload `/arena/upload/`, setup `/arena/`, full-screen play `/arena/play/?…`: no scroll, two maximized boards, one bar, history drawer, toasts, play URL holds the whole config, replays on the same page. |
| Matches | Each match is two games with colours swapped (`arena/src/match/series.ts`, commit `bebb9af`). |
| Catalog | **Read and upload paths are database-backed (uncommitted):** `functions/api/catalog/[file].ts` → `server/catalog-read.ts` serves `/api/catalog/manifest.json` from D1 and `/api/catalog/<sha256>.wasm` from R2; `functions/api/catalog/index.ts` → `server/catalog-upload.ts` is `POST /api/catalog` (Turnstile → quota → size → header → metadata → duplicate → R2 put → D1 insert, with rollback). Curated entries live in `seed/catalog/` (`seed.json` + binaries; only the sample game, flagged as the reference opponent). `arena/public/catalog/` is gone. The Upload page does not call the upload API yet — that is Phase 3. |
| Entrants | Public catalog holds only real games: today just “Jungle — Claude-Opus-5.5 sample” v1.0.0 (sha256 `d21e6469…`, rebuilt 2026-11-22 for the `github-url` metadata field). The demo entrants were removed at the user's request. `tests/test-entrant/` (Rust) builds the test-only fixtures in `arena/test-fixtures/` (`npm run build:fixtures`); they are never published. |
| Sample game | `wasm_sample/`: standalone web game + Arena component, self-contained project. |

## Verified on 2026-11-22

- `npm run build` succeeds (Astro + Arena + `tsc -p functions/tsconfig.json`).
- `npx vitest run`: **24 files, 255 tests pass** (incl. 20 upload tests), including the server
  tests against in-memory local D1 (upload tests use a fake R2: workerd's streamed `put` needs a
  known-length stream Node cannot provide through `getPlatformProxy`).
- **Contract change implemented same day:** `github-url` is now a required metadata field in the WIT
  (loader + upload API reject anything but `https://github.com/<owner>/<repo>`; D1 gained
  `github_url` in `migrations/0003`), and the sample's standalone Hard thinks at most one second
  (deadline-aware search, e2e measured exactly 1000 ms). All entrant binaries (fixtures, sample,
  seed) were rebuilt; `wasm_sample` suites pass (cargo, 55 vitest, 35 e2e) and conformance on the
  new seed passed. Any pre-change binary now fails the contract check by design — accepted, since
  nothing is deployed and the catalog holds only the rebuilt sample.
- **Playwright e2e re-run after the database and two-game changes: 143 passed, 2 skipped, 0 failed**
  across all five projects (29 each in Chromium, Chrome, Edge; 28 + 1 skipped in WebKit and Firefox —
  Firefox launches now). **Conformance on the seed sample: passed.** No regressions.
- **Upload path over real HTTP** (`scripts/api-server.ts`, throwaway state, `.dev.vars` from
  `.dev.vars.example`): POST new entrant → 201, duplicate → 200 `existing`, wrong-hash → 400,
  `GET <sha>.wasm` byte-identical. State folder, smoke script and `.dev.vars` deleted afterwards.
- **Local database read path**, started with
  `node --import tsx scripts/api-server.ts --port 8799 --state .wrangler/handoff-check --fresh`:
  - migration `0001_entrants.sql` applied and the seed loaded;
  - `GET /api/catalog/manifest.json` lists the sample from D1;
  - `GET /api/catalog/2aac1b22528b392452d2f81460bcd2b42fca261624cc1b1db619339afe5363c1.wasm`
    returns 200, `application/wasm`, 121,149 bytes, SHA-256 matching the seed;
  - `/arena/` returns 200 and an unknown `/api/` path returns 404.
  That state folder was deleted afterwards.

Playwright e2e and `npm run conformance` were also re-run after the `github-url` contract change
(same day): e2e 115 passed + 1 skipped across Chromium/WebKit/Chrome/Edge, conformance passed on
the rebuilt seed sample. Both suites are green on the current tree.

## How to test locally

```bash
npm run build                 # dev:full serves dist/, so build first
npm run dev:full              # site + catalog API at http://127.0.0.1:8788/ (Arena at /arena/)
                              # local D1/R2 in .wrangler/state, migrated and seeded on every start
npm run dev:arena             # Vite dev server; proxies /api to :8788, so run dev:full too
npm test                      # unit + server tests (in-memory D1/R2, nothing persisted)
npm run test:e2e              # Playwright; starts its own API on :4410 with a fresh .wrangler/e2e-state
npm run conformance -- path/to/entrant.wasm
```

- Inspect the local database:
  `npx wrangler d1 execute jungle-arena --local --persist-to .wrangler/state --command "SELECT sha256,title,status,is_reference FROM entrants"`.
- Reset it: delete `.wrangler/state`, or run `npm run db:migrate -- --local` then `npm run db:seed -- --local`.
- The browser's own database (IndexedDB `jungle-arena`: `packages`, `transpiled`, `replays`) caches
  downloaded bytes, transpiles and replays. Inspect it in DevTools → Application → IndexedDB.
- Playwright sets `reuseExistingServer` outside CI, so a stale server left on port 4410 by another
  session is reused. Kill it before trusting a run.
- Firefox launches and passes (2026-11-22 run: 28 passed, 1 skipped); it could not launch
  (`msvcp140_1.dll` missing) before the Visual C++ 2015+ runtime workerd needed was installed.
  `npm run test:e2e -- --project=…` did not filter projects in that run (all five ran); use
  `npx playwright test --project=…` directly when a subset matters.

## Next work, in order

1. **Phase 3: test-gated upload in the browser.** Extract `runUploadRound` into
   `arena/src/conformance/round.ts`, shared by the Upload page and the conformance page. The round is
   admission, behaviour checks, and two headless games against the reference via `planSeries`. Nothing
   is stored in IndexedDB, R2 or D1 until every step passes and the server accepts the upload.
   Update `ImportPanel.vue` stages and copy, plus `CatalogList.vue` / `AboutCatalogs.vue`.
   The client POST contract is `server/catalog-upload.ts`'s header comment (`UPLOAD_HEADERS`);
   the Turnstile sitekey/widget is new in this phase (use the always-pass test sitekey locally,
   with `.dev.vars` copied from `.dev.vars.example` so the local API accepts uploads).
2. **Phase 5: end-to-end tests,** then the docs listed in the plan: `CLAUDE.md`, `sdk/README.md`,
   `arena_prompt.md`, and the admission wording in `wasm_sample/jungle_prompt.md`.
3. **Production setup and deploy (ask the user first):** `wrangler d1 create jungle-arena`,
   `wrangler r2 bucket create jungle-arena-entrants`, put the id in `wrangler.toml`, Turnstile widget and
   secrets (`TURNSTILE_SECRET`, `UPLOADER_SALT`), `npm run db:migrate -- --remote`,
   `npm run db:seed -- --remote`, then `npm run deploy`. Verify live as the plan's Phase 5 describes.
4. **`wasm_sample` against its updated brief (not audited).** `jungle_prompt.md` gained requirements
   after the sample was built:
   - quality goals with screenshot review;
   - a 1-second Hard move deadline in the standalone game (brief changed from 2 s; **implemented
     2026-11-22** — deadline-aware search in `jungle-core`, deadline set by the web session);
   - a committed `release/index.html` that works from `file://` (there is no `wasm_sample/release/` today);
   - `rules/desktop-jungle-v1.json` with a build-time digest check (the sample keeps rules under `spec/rules/`);
   - admission-checklist tests and a strength report.

   Check each one, then deploy with `cd wasm_sample && npm run deploy` once the user approves.

## User decisions to respect

- Commit only when asked. Deploys and creating Cloudflare resources need explicit approval each time.
- A git push publishes nothing: the Pages project is Direct Upload. Deploy with `npm run deploy`.
- The public catalog lists only real games. Test entrants stay in `arena/test-fixtures/`.
- Account: Workers Free, R2 Paid (confirmed 2026-11-21). No server-side execution of uploads.
- The upload test is one two-game round against the reference opponent, with each program moving first
  once. Winning is not required; both games must end in a referee result with no forfeit.
- Vendor names in `src/data/models.ts` were inferred, not supplied by the user. Don't present them as confirmed.

## Gotchas not (yet) in CLAUDE.md

- `README.md`, `CLAUDE.md` and other files are checked out with CRLF. Preserve line endings when patching:
  normalise to LF, edit, then restore CRLF.
- In Git Bash, inline `node -e` and heredocs mangled backslashes and backticks. Write patch scripts to a
  file and run them with `node`.
- Without IndexedDB, uploads live in per-page memory, so they do not survive the step from the Upload
  page to the setup page. The e2e "IndexedDB unavailable" test therefore uses catalog entries only.
- Ports: preview 4400, Playwright API 4410, `dev:full` 8788 (inspector on port + 1000).
