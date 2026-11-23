# Plan: match results, Elo ratings and a live leaderboard

> Approved by the user on 2026-11-22. **Progress:** see [`HANDOFF-elo-ratings.md`](HANDOFF-elo-ratings.md).
> Phases 1–6 are done (uncommitted); only Phase 7 (deploy, separate go-ahead) remains.

## Context

The Arena plays two-game matches between uploaded WebAssembly Jungle programs, entirely in the
visitor's browser, and forgets the outcome once the page closes. The public catalog already lives in
Cloudflare D1 + R2 (`migrations/`, `server/`, `functions/`). The leaderboard at `/` is a static Astro
page built from hand-entered benchmark data (`src/data/models.ts`).

Requested:
1. A DB table recording every match: which two programs played, wins, losses, draws.
2. Elo: a newly uploaded program starts at 1000 once it passes validation and testing; every
   two-game match updates both programs' ratings.
3. The leaderboard reads each program's rating from the DB and ranks by it.

Decisions (user, 2026-11-22):
- **Replace the leaderboard completely**: benchmark data and its sections go; `/` shows the live
  Elo ranking only.
- **One rating per uploaded version** (per SHA-256), starting at 1000.
- **Rated = standard settings only**: two different published programs, `hard`, 20,000 nodes,
  5 s per move. Only rated matches are recorded.
- **Trust = browser-reported + server checks** (Workers Free cannot run the programs).

Constraints: Workers Free (10 ms CPU per Function request), R2 Paid; production D1/R2 not created
yet (`wrangler.toml` placeholder + deploy guard).

## What exists (explored)

- **Uploads never reach the DB.** `importFile` (`arena/src/app/arena.ts:213-236`) admits
  (`importBinary`) and saves to IndexedDB only. `POST /api/catalog` (`server/catalog-upload.ts`) is
  built and tested but never called; no upload round exists (checks + games live only on the
  conformance page, `arena/src/conformance/main.ts`, `checks.ts`). Phase 3 of
  `docs/PLAN-shared-catalog.md` was never built; it becomes Part A here.
- Match end: `gameEnded` (`arena/src/app/arena.ts:497`) summarizes after game 2, in memory only;
  per-game `ReplayV1` (`arena/src/replay/schema.ts`) holds seats, settings + seed, every ply, result.
  The two games depend only on the program pair, seed and first side (`planSeries`).
- `parsePlayQuery` (`arena/src/app/paths.ts:91`) accepts any settings from the URL.
- Leaderboard: static, no client JS, no adapter; reusable `medalForPlace` (`src/lib/ranking.ts`),
  `src/lib/ties.ts`, `src/lib/format.ts`. An SSR adapter would replace `functions/` with
  `_worker.js`, so the page fetches JSON from a Function.
- D1 `batch()` is one transaction (rolls back on any failing statement; local miniflare too).

## Design

### Elo (`server/elo.ts`, pure)
Start 1000 (column default). K = 32 per game, one update per match:
`E = 1/(1+10^((R_opp−R_self)/400))`, `points = wins + draws/2` (0…2), `Δ = K·(points − 2E)`,
opponent `−Δ`. REAL stored, rounded for display. `replayRatings(matches)` folds counted matches by
integer id for recompute. Unit-tested.

### What gets rated
`arena/src/match/rated.ts` (no Vue imports; `RATED = { difficulty:'hard', nodeBudget:20_000,
thinkDeadlineMs:5_000 }`, equal to today's defaults): rated iff settings == RATED, both programs
published (current rules), different SHA-256, **not uploaded by the same uploader**, both games
ended on the board (a match containing a **forfeit is recorded as `unrated`**: forfeits cannot be
verified from moves, and a forged "opponent timed out" must not move ratings). A system error →
nothing reported. Programs with fewer than 5 rated matches show a **Provisional** badge.

### Schema (`migrations/0004_ratings.sql`)
- `entrants` + `rating REAL DEFAULT 1000`, `rating_seq INTEGER DEFAULT 0` (only ever increases),
  `rated_matches`, `game_wins`, `game_losses`, `game_draws` (DEFAULT 0).
- `matches`: `id INTEGER PRIMARY KEY`, `left_sha`/`right_sha` (seats as played), `sha_lo`/`sha_hi`
  (sorted pair), game-1 `left_side`, `first_side`, seed, difficulty, node_budget, think_ms, per game
  result (left|right|draw) + reason + plies, `left_wins`/`right_wins`/`draws`, ratings before/after,
  `moves` (JSON, for audits), `reporter` (salted IP hash), `status` (`counted`|`unrated`|`voided`),
  `created_at`. Partial `UNIQUE (sha_lo, sha_hi, seed, first_side) WHERE status <> 'voided'`.
- `rating_changes(sha256, seq, match_id, before, after, PRIMARY KEY (sha256, seq))`; a write uses
  `rating_seq + 1`, so any concurrent or stale writer collides and its whole batch rolls back. On
  failure re-read: match key present → `200` (same moves) / `409` (different moves, flagged);
  else retry ≤ 3.
- `report_quota(bucket, count)`, the `upload_quota` pattern.

### Report API (`server/match-report.ts`, `functions/api/matches/index.ts`)
`POST /api/matches` with `{ left, right, leftSide, firstSide, seed, settings, games: [{ moves,
result }] ×2 }` + `X-Turnstile-Token`. Order: Turnstile → `report_quota` (60/day) → shape, ≤ 1,600
plies per game → settings == RATED → entrants (listed, current rules, different, not same uploader)
→ **verify** → idempotency → rate → `db.batch` [match, 2× `rating_changes`, 2× entrants].
**Lean verifier** (`server/verify-game.ts`), built first: mutable board, `legalMovesFor` reuse,
legality each ply, a position map keyed by board + side to move (starting position included,
reset on capture), full profile-order adjudication (den, elimination, immobilization, repetition,
no-capture) on the final ply; a forfeit must name the side to move. Proven by a differential test
against `applyMove` over thousands of random games (status/winner/reason at every ply).

### Client
- `arena/src/app/turnstile.ts`: invisible widget in a fixed overlay (play page never scrolls);
  token fetched at report time, reset before a retry. Site key via build-time env (test key locally).
- `gameEnded` → if rated-eligible, report; `MatchResultDialog.vue` shows "Rated match: 1000 → 1016
  (+16)" per program, or "Friendly match" / "Unrated (forfeit)" / "Could not be recorded". Setup and
  play pages show a Rated/Friendly badge (Friendly if the catalog failed to load).

### Part A — publish on upload (catalog plan §Phase 3)
`runUploadRound` in `arena/src/conformance/round.ts` (shared with the conformance page; two
`planSeries` games vs the reference, headless; pass = both games end on the board, **including a
repetition draw**, no forfeit by the upload). `importFile` = round → Turnstile → `POST /api/catalog`
→ cache locally only on 201/200; `ImportPanel.vue` stages + Publishing; copy "published to the
Arena". The new row starts at 1000.

### Leaderboard (`/`, replaced)
- `GET /api/leaderboard` (`server/leaderboard.ts`): listed, current-rules entrants with title,
  version, model, code agent, GitHub, rating, rated matches, game W/L/D, sha, provisional flag;
  sorted by rating, rated matches, created_at.
- `src/lib/elo-ranking.ts` (pure, tested): rounded rating → competition places, medals
  (`medalForPlace`), ranking prose (`ties.ts`, "programs"); all runtime strings unit-tested.
- `src/pages/index.astro`: nav, intro, podium + table, "How ratings work". Rows and podium cards are
  Astro `<template>`s (one per medal variant, existing badge/podium markup and `data-label`s) cloned
  by a bundled script using `textContent` and `style.setProperty` (`--i` capped, `--rule`);
  `data-state` loading/ready/empty/error. Every published program is listed (new ones at 1000,
  Provisional). Columns: Rank, Program + version, Model, Code agent, Rating, Matches, Games W–L–D,
  GitHub, "Play in the Arena" (`arena/?left=<sha>`, relative).
- Delete `src/data/models.ts`, benchmark-only components/prose/tests and the JSON-LD ItemList;
  update `SiteHeader`, README, CLAUDE.md (Architecture rewritten).

### Test infrastructure
- `scripts/api-server.ts` passes `--binding TURNSTILE_SECRET=<always-pass> --binding UPLOADER_SALT`
  (CI has no `.dev.vars`) and, with `--fixtures`, seeds the test entrants (incl. `late-*`) as
  published rows for e2e. The server skips siteverify only for the always-pass test secret.
- `scripts/serve-static.mjs` also serves root `/_astro/` from `dist` (the leaderboard's bundled
  script and CSS 404 under the nested prefix today).
- e2e stubs the Turnstile script with `page.route`; shared helpers play **friendly** matches by
  default (e.g. 5,000 nodes); rated behaviour has dedicated specs; `pages.spec` counts updated.

### Maintainer tools
`npm run ratings:recompute -- --local|--remote` (fold counted matches, append one
`rating_changes` row per changed program); `npm run matches:audit -- … [--void <id>]` (re-run in
Node via `arena/src/loader/node-host.ts` with the same seed/budget/difficulty; report mismatches).

## Phases (TDD; each ends green)
1. **Verifier + Elo core**: lean verifier with the differential test, `elo.ts`, `rated.ts`; Node
   timing of 2×200 and 1,500-ply games.
2. **Part A** publish on upload + test infrastructure (bindings, fixtures seeding, `/_astro/`,
   Turnstile stub, friendly helpers); e2e: round pass/fail, nothing stored on failure.
3. **Schema + report API** (local D1: rejections store nothing, idempotency 200/409, concurrent
   reports retry, same-uploader and forfeit matches unrated).
4. **Client reporting** + Rated badge + rating change in the result dialog (e2e rated match).
5. **Leaderboard** API + page replacement (e2e: seeded programs at 1000 Provisional; after a rated
   match the ranking, ratings and W–L–D update; text check).
6. **Maintainer tools** + docs (README, CLAUDE.md, catalog plan status).
7. **Deploy** (separate go-ahead): production D1/R2, Turnstile widget, secrets, migrate, seed,
   deploy, live check incl. Workers CPU logs.

## Verification
`npm test`, `npm run check`, `npm run build`; `npx playwright test --project=chromium` (upload →
published at 1000 → rated match → equal and opposite rating changes → `/` ranks them; friendly
match records nothing; forged reports rejected); `npm run conformance`; `ratings:recompute`
reproduces stored ratings exactly.

## Risks
- **Forgery / selective reporting**: a visitor can submit invented but legal games or report only
  wins. Bounded by Turnstile, 60 reports/day, published programs only, same-uploader exclusion,
  forfeits unrated, audit + recompute. Server-issued signed seeds are a later hardening.
- **Worker CPU**: lean verifier + 1,600-ply cap; confirm in Workers logs after deploy.
- **Uploads become public** (Part A); device-only programs still play friendly matches.
