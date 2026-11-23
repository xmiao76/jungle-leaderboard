# Handoff: match results, Elo ratings and a live leaderboard

Written 2026-11-22 for the next code agent, on branch `feat/arena`. Everything below is
**uncommitted** in the working tree on top of `adcd74f` (repetition draw, rules v2). Commit only when
the user asks, and never deploy without their explicit go-ahead.

## Read these first

| File | Why |
|---|---|
| [`docs/PLAN-elo-ratings.md`](PLAN-elo-ratings.md) | The approved plan for this work: decisions, design, phases. This handoff tracks progress against it. |
| [`CLAUDE.md`](../CLAUDE.md) | Commands, architecture, gotchas, deploy rules. |
| [`docs/PLAN-shared-catalog.md`](PLAN-shared-catalog.md) | The earlier catalog work this builds on (D1 + R2, the upload API). Its Phase 3 is done here as Part A. |
| [`docs/HANDOFF.md`](HANDOFF.md) | The previous handoff (catalog database). Background only. |

## What the user asked for, and what they decided

**Requested:**
1. A table recording every match: which two programs played, and the wins, losses and draws.
2. Elo ratings: an upload starts at 1000 once it passes validation and testing; every two-game match updates both programs.
3. The leaderboard at `/` reads ratings from the database and ranks by them.

**Decisions (user, 2026-11-22):**
- **Leaderboard:** replace it completely. The November benchmark data and its sections go.
- **What is rated:** one rating per uploaded version (per SHA-256).
- **Which matches count:** only the standard settings (`hard`, 20,000 nodes, 5 s per move), between two different published programs. Only rated matches are recorded.
- **Trust:** results are reported by the browser and checked on the server. On Workers Free the server can't run the programs.

**Account:** Workers Free (10 ms CPU per Function request), R2 Paid. The production D1 database and R2 bucket don't exist yet, and `npm run deploy` refuses to run until they do.

## Status by phase

| Phase | State | Evidence |
|---|---|---|
| 1. Verifier + Elo core | **Done** | Unit tests pass. Verifier cost: 6.4 µs per ply warm; two ~185-ply games in 3.7 ms. |
| 2. Part A: publish on upload, plus test setup | **Done** | Chromium e2e 30/30 passed at the end of this phase. |
| 3. Schema + report API | **Done** | 86 server tests pass, including concurrent reports. |
| 4. Client reporting, Rated badge, rating change in the dialog | **Done** | Chromium e2e 31/31, including the rated-match test. |
| 5. Leaderboard API + replacing the page | **Done** | `GET /api/leaderboard`, `src/lib/elo-ranking.ts`, live page; `tests/e2e/leaderboard.spec.ts` 4/4. |
| 6. Maintainer tools (`ratings:recompute`, `matches:audit`) | **Done** | Verified on local e2e state: recompute reproduces stored ratings; audit re-runs OK; void + recompute resets to 1000. |
| 7. Deploy (production D1/R2, Turnstile widget, secrets) | Not started | Needs the user's go-ahead. |
| Docs (README, CLAUDE.md, catalog plan status) | **Done** | README, CLAUDE.md, both plans, `arena_prompt.md`, `wasm_sample/jungle_prompt.md`. |

### Phase 1: verifier and Elo core (done)
- `server/verify-game.ts`: a lean game verifier. It replays one game from the opening on a mutable board.
  - Checks legality on every ply.
  - Rejects a game that ended before its last ply; on the final ply it runs the full adjudication in the profile's order.
  - Counts repetitions with a position map that resets on capture.
  - Accepts a forfeit only by the side to move, in a game still in progress.
  - `adjudicateEachPly` is the reference definition used by the tests.
  - A differential test compares it against the real referee (`applyMove`) over 400 random games (`server/verify-game.test.ts`).
- `server/elo.ts`: K = 32 per game, one update per match, `Δ = K·(points − 2E)`. `replayRatings` is for recomputes.
- `arena/src/match/rated.ts`: `RATED_SETTINGS`, `PROVISIONAL_MATCHES = 5`, `isRatedSettings` and `ratedEligibility`. It has no Vue imports because the server bundles it. `DEFAULT_DIFFICULTY` in `arena/src/app/arena.ts` now comes from `RATED_SETTINGS`.

### Phase 2: publish on upload (done)
- **Upload round** (`arena/src/conformance/round.ts`, `runUploadRound`): behaviour checks, then two games against the reference program.
  - It reuses the conformance helpers in `checks.ts`; `playMatch` gained an `onPly` callback.
  - It uses `CONFORMANCE_SETTINGS` (`medium`), not the rated settings.
- **Upload flow:** `importFile` (`arena/src/app/arena.ts`) now runs admission → the upload round → Turnstile → `POST /api/catalog` (`arena/src/catalog/publish.ts`).
  - Nothing is stored anywhere until the server accepts the upload; after that, only the transpiled code is cached locally.
  - New types: `UploadStage`, `UPLOAD_STAGES` and `UploadOutcome`.
- **Upload page:** `ImportPanel.vue` shows all eleven stages, with a live ply count during the games, and publishing copy. `AboutCatalogs.vue`, `ArenaHeader.vue` and `CatalogList.vue` were updated too: "On this device" now holds only uploads from before publishing existed, and they play friendly matches only.
- `arena/src/catalog/upload-protocol.ts`: the header names and report encoding, shared by the browser and `server/catalog-upload.ts`.
- `arena/src/app/turnstile.ts`: an invisible widget that fetches one token per request. The site key comes from `VITE_TURNSTILE_SITE_KEY` and defaults to Cloudflare's always-pass test key.
- `server/abuse.ts`: Turnstile verification, the reporter hash, quota buckets and `consumeQuota` for both quota tables.
  - **With the always-pass test secret `1x0000000000000000000000000000000AA`, siteverify is skipped** (same outcome, no network).
  - `UPLOAD_DAILY_LIMIT` and `REPORT_DAILY_LIMIT` are optional overrides.
- **Test setup:**
  - `scripts/api-server.ts` always passes local bindings (`--binding TURNSTILE_SECRET=<test secret>`, `UPLOADER_SALT`, and daily limits of 1000).
  - `--fixtures` publishes the e2e programs from `scripts/e2e-fixtures.ts`: `test-entrant-1.1.0` and the four `late-*` programs, through `upsertSql` in `server/seed-sql.ts`.
  - `scripts/serve-static.mjs` also serves the site-root `/_astro/` under a test prefix.
  - `tests/e2e/fixtures.ts` stubs Cloudflare's Turnstile script. **Every spec must import `test` and `expect` from `./fixtures`.**
  - `late-*` programs can't pass the upload round, so `recovery.spec.ts` opens them by hash (`arena/?left=<sha>`).
  - The first test in `pages.spec.ts` was rewritten: a failing upload stores nothing, and a re-upload is reported as already published.

### Phase 3: schema and report API (done)
- **`migrations/0004_ratings.sql`:**
  - `entrants` gains `rating` (default 1000), `rating_seq`, `rated_matches` and `game_wins`/`game_losses`/`game_draws`.
  - The `matches` table holds one row per reported match: each game's result, reason and plies; the W/L/D counts; ratings before and after; the moves by colour (JSON); the reporter hash; and a `status` of `counted`, `unrated` or `voided`.
  - It has a partial unique index on `(sha_lo, sha_hi, seed, first_side) WHERE status <> 'voided'`.
  - `rating_changes(sha256, seq)` is the primary key that makes concurrent writers collide, so a stale batch rolls back.
  - `report_quota` holds the daily report counts.
- **`POST /api/matches`** (`functions/api/matches/index.ts` → `server/match-report.ts`, with parsing, scoring and the key in `server/match-report-body.ts`).
  - Order of checks: Turnstile → quota (60/day) → size (64 KB) → shape → rated settings → both programs listed under the current rules and different → verify both games → one report per match (`200` if identical, `409` if different) → one `db.batch` with up to 3 retries.
  - A forfeit, or two programs from the same (non-null) uploader, gives `unrated`.

### Phase 4: client reporting (done; e2e green 2026-11-22)
- `arena/src/match/report.ts`: `buildMatchReport` and `postMatchReport`, with unit tests. The outcomes are `counted` (with ratings), `already`, `unrated` and `failed`.
- `arena/src/app/arena.ts`:
  - `SeriesView` gains `moves` (per game) and `rating` (`RatingView`: `friendly` | `reporting` | a report outcome).
  - `gameEnded` keeps each game's moves, then calls `reportMatch` after game 2.
  - `matchEligibility()` is exported for the badges.
  - `matchesUrl()` is in `paths.ts`.
- **UI:**
  - `MatchResultDialog.vue` shows a rating status line (`data-testid="match-rating"`, `data-state`) and each card's `Elo 1000 → 1016 (+16)` (`match-rating-left` / `-right`). The formatter is `formatRatingChange` in `ui/labels.ts`.
  - There's a Rated/Friendly badge on the setup page (`rated-badge`, in `MatchSettings.vue`) and the play bar (`play-rated`, in `PlayBar.vue`).
- **e2e changes (run green as part of the 31/31 Chromium verification):**
  - `setUpTestVsSample` now plays **friendly** matches via `playFriendly` (it selects 5,000 nodes through the label "Shared search budget (nodes)").
  - New helpers: `shaOf` and `SAMPLE_SHA` (`tests/e2e/arena.ts`).
  - `match.spec.ts` asserts that the main match is `friendly`, and adds the test "a rated match between two published programs changes both Elo ratings".

## Next steps, in order

1. ~~**Verify Phase 4**~~ — done: Chromium e2e 31/31 (evidence PNGs restored afterwards).
2. ~~**Phase 5: the leaderboard**~~ — done: `server/leaderboard.ts` + `functions/api/leaderboard/`,
   `src/lib/elo-ranking.ts` (rounded rating → competition places; `ties.ts` now says "programs"),
   `src/pages/index.astro` rewritten on `<template>`s + `textContent` with
   loading/ready/empty/error states, benchmark data/components/tests and the JSON-LD ItemList
   deleted, `tests/e2e/leaderboard.spec.ts` added (API-relative assertions; pins its own seed).
   One adjustment to the plan: the podium is the first three *programs*, since at 1000 everyone
   ties for first.
3. ~~**Phase 6: maintainer tools**~~ — done: `scripts/ratings-recompute.ts` (appends
   `rating_changes`, never renumbers; UPDATE precedes INSERT because D1 rejects explicit
   transactions) and `scripts/matches-audit.ts` (re-runs via `node-host.ts`; `--void` audits,
   voids, then recomputes). Both verified against local e2e state.
4. ~~**Docs**~~ — done: README, CLAUDE.md, `PLAN-shared-catalog.md` Phase 3 marked done,
   `wasm_sample/jungle_prompt.md` and `arena_prompt.md` updated.
5. **Commit** when the user asks; the user's global git settings disable attribution. **Deploy** (Phase 7) only with the user's approval: create D1/R2, a Turnstile widget (site key as `VITE_TURNSTILE_SITE_KEY` at build time), secrets via `wrangler pages secret put`, migrate, seed, deploy, then check CPU in the Workers logs.

## Addendum (2026-11-22, later): Model Platform metadata

Metadata gained an optional `model-platform` field (the provider the model ran through;
authors write `official` when unanswered). `migrations/0005_model_platform.sql`; WIT and both
prompts updated (identity-ask instructions + `jungle-<model>-<code-agent>[-<platform>]-<version>.wasm`
filename convention). The contract check dual-accepts the pre-field 9-field metadata
(`LEGACY_METADATA_SIGNATURES` in `arena/src/loader/contract.ts`; regression binary
`arena/test-fixtures/legacy-metadata.wasm`), and `checkMetadata` normalizes absent → `''`,
displayed as nothing. Fixtures rebuilt (new hashes), sample rebuilt and re-seeded as reference
(`86ce6cde…`, `modelPlatform: "official"`). Naming was then simplified in `jungle_prompt.md`
and applied to the sample: title is now `<model> · <code-agent>` (platform appended only when
non-empty and not `official`; no `Jungle` prefix), the release file is
`claude-opus-5-5-claudecode-1.1.0.wasm`, title `Claude-Opus-5.5 · ClaudeCode`, re-seeded as
reference (`0656b02d…`). A `program:remove` maintainer script also landed (list/remove/hide).
The same-uploader unrated rule was then removed (curator uploads most programs — see the
amendment in `PLAN-elo-ratings.md`); forfeit is now the only `unrated` reason.

## How to run things

| What | Command |
|---|---|
| Unit tests (Arena + server against real local D1/R2) | `npm test` |
| Type checks | `npx vue-tsc --noEmit -p arena/tsconfig.json`, `npx tsc -p functions/tsconfig.json` (or `npm run check`) |
| Build | `npm run build` |
| e2e (starts the API with a fresh, seeded database and fixtures) | `npx playwright test --project=chromium` (~4–5 min) |
| Local site + API | `npm run build`, then `npm run dev:full` (port 8788; `-- --port 8790` if busy) |

## Gotchas met in this session

- **Shell quoting:** don't put backticks inside double-quoted `node -e "…"` in bash. Bash runs them as command substitution; this happened twice. Write a script file, or use a quoted heredoc (`<<'EOF'`).
- **Port 8788:** another local project (`node tools/serve.mjs 8788`) may hold it. `dev:full` now fails fast and says so.
- **workerd needs the Visual C++ 2015+ runtime** (installed on this machine). `compatibility_date` can't exceed 2026-08-18 with the pinned wrangler.
- **Vitest timeout:** the differential verifier test takes about 8 s and has a 60 s budget.
- **Reference opponent:** the upload round plays the seed catalog's reference program (the sample, v1.1.0), so the round takes about 5–15 s in a browser.
- **Ratings in e2e:** the database is shared by every spec in a run, so the rated test changes the e2e ratings for later specs. Assert relative changes, not fixed numbers.
