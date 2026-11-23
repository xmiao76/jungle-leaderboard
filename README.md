# Jungle Leaderboard

Live Elo standings for **Jungle** programs — Chinese *Dou Shou Qi* (斗兽棋), "the game of fighting
animals". Anyone can upload a Jungle program built to the Arena's WebAssembly contract; once it
passes the upload test it is published at 1000 Elo, and rated matches in the Arena move its rating
from there. This began as an agentic-coding benchmark in which each frontier AI model was given
roughly six hours to build a playable Jungle program from an empty repository; the programs still
carry the model, code agent and model platform that produced them, but the standings are now decided by play, not
by a one-off snapshot.

**Live site:** <https://jungle-leaderboard.pages.dev>

---

## Why Jungle

Most coding evaluations score a model on isolated functions or on patches to an existing codebase.
This one asks a different question: given a fixed wall-clock budget and a single, fully specified
target, can a model produce a complete, correct, playable artifact?

Jungle is a deliberate choice of target. Its core rule — a piece captures any enemy of equal or
lower rank — is trivial. Its exceptions are not, and they interact:

- The Rat captures the Elephant, while the Elephant cannot touch the Rat.
- Only the Rat may enter the two river regions, and it cannot capture while in the water.
- The Lion and the Tiger leap a river in a straight line, unless a rat of either colour sits
  anywhere along the path.
- A piece standing in one of the opponent's traps loses its rank entirely and can be captured by
  anything.

A naive implementation produces something that resembles Jungle and plays legally most of the time.
Defects concentrate in exactly the positions those exceptions govern. Competition play is what
forces those positions to occur.

## How ratings work

**Publishing.** A program joins the standings at **1000 Elo** the moment it is published: upload it,
and it must pass admission (size, header, hash, contract, transpile, smoke), the behaviour checks,
and a two-game test round against the reference program. Only then is it stored and listed for
everyone — a failing upload leaves nothing behind anywhere. One rating belongs to one exact build
(its SHA-256): a new version is a new entry and starts again at 1000.

**Rated matches.** Only the standard settings count: two different published programs at *hard*,
20,000 nodes, 5 seconds per move. A match is always two games with colours swapped, scored as one
Elo update with K = 32 per game against the expected score over both games — win both against an
equal and you gain 32. Anything else is a friendly match and is recorded nowhere. A rating is
**Provisional** until a program has played five rated matches.

**Trust.** Matches are played in visitors' browsers (the free server tier cannot run the programs)
and reported as moves. The server replays both games move by move and stores nothing unless every
check passes; a match containing a forfeit — unprovable from moves — is recorded as *unrated*, and
every other rated match counts, including between two programs from the same uploader (the catalog's
curator uploads most programs, so excluding those would leave almost nothing rated). A maintainer can re-run any recorded match for real
(`npm run matches:audit`), void a forgery, and fold the ratings again (`npm run ratings:recompute`).

### Reading the standings

The leaderboard at [`/`](https://jungle-leaderboard.pages.dev/) reads the ratings live from the
database (`GET /api/leaderboard`) — there is no standings data in this repository. Ratings are shown
rounded, and places follow standard competition ranking over the rounded rating: programs level at
the same number share a place, and the places below the tie are not awarded. *Matches* counts rated
two-game matches; *Games W–L–D* counts the individual games inside them. *Model*, *Code agent* and
the smaller *Model platform* line are the names each program reports for its own authorship — the
service or provider the model ran through (`official` for its maker's own, blank when undeclared).

Correctness remains a precondition rather than a tiebreaker: a program must pass the upload test
round to be published at all, and a game it forfeits mid-match (illegal move, trap, timeout) makes
the whole match unrated rather than a cheap loss or win.

---

## Jungle Arena

Upload independently built Jungle programs, compiled to WebAssembly Components, and watch two of
them play on two live boards, each drawn by its own program, under one Arena-owned referee.
Everything runs in the browser; no server computes a move. The site has separate pages, linked by
the same nav (Leaderboard · Upload · Arena):

| Page | Path | What it does |
|---|---|---|
| Leaderboard | [`/`](https://jungle-leaderboard.pages.dev/) | The live Elo standings of every published program, read from the database. |
| Upload | [`/arena/upload/`](https://jungle-leaderboard.pages.dev/arena/upload/) | Import a `.wasm`, watch each check and the test round run, and publish it for everyone at 1000 Elo. |
| Arena setup | [`/arena/`](https://jungle-leaderboard.pages.dev/arena/) | Pick a program and version for each seat and the match settings, then **Start**; saved replays. |
| Arena play | `/arena/play/?…` | Full screen, no scrolling: the two boards as large as the window allows, one slim control bar. Also plays back replays. |

The Arena was built by **Claude-Opus-5.5** with **ClaudeCode** from the brief in [`arena_prompt.md`](arena_prompt.md).

### Using it

1. On **Upload**, choose **Import .wasm**. Each stage is shown as it runs - admission, the behaviour
   checks, then the two test games against the reference program with a live ply count, then
   publishing - followed by the program's model, code agent, version, runtime and rules
   compatibility, and two frames it drew. **Play in left/right seat** opens the Arena with it
   selected (seat choices are remembered across pages).
   On the **Arena** setup page, pick a program and an exact version (each build is identified by its
   SHA-256) for each seat. A link of the form `/arena/?left=<sha256>&right=<sha256>` preselects both.
2. Choose which column plays Red, who moves first, difficulty, seed, the shared node budget, the think
   deadline and the animation speed, then **Start match**. A vs B, A vs an older A, and the same binary
   in both seats all work. **A match is always two games:**
   - Game 2 starts by itself after game 1, with the colours swapped and the same side moving first.
     So each version moves first once and plays each colour once.
   - After game 2 the bar shows the overall result, e.g. `Match: Left 1½ – ½ Right · Left (…) wins the
     match`. A win scores 1, and a forfeit counts as a win for the other seat. A draw scores ½ each.
   - A system error leaves the match incomplete.
3. The match opens on its own full-screen page: the two boards split the window left and right
   (stacked on portrait screens), each with a one-line label of seat, side, program, version and model.
   One bar holds the game (1 or 2 of 2), turn, move, state, last move, the game's result and then the
   match result. It also has these controls:
   - play/pause, step and speed;
   - **Restart**, which replays the two-game match from game 1;
   - **Swap**, which starts a new two-game match with game 1's colours exchanged;
   - mute, **History** (an overlay drawer with the full move list) and **Full screen**. Keys: Space play/pause, S step, H history, M mute. The page URL holds
   every setting, so it can be shared, and reloading restarts the same match (same seed).
4. Every committed ply is saved before the game moves on. Each game of a match is its own replay,
   labelled "Game 1 of 2" or "Game 2 of 2". Replays survive a reload, can be downloaded,
   and reopen on another device with the original programs (or a labeled reference board). **Open**
   plays a replay back on the same full-screen page, with a seek bar.

### The shared catalog

Uploading **publishes**: the file exists only in the page's memory while admission, the behaviour
checks and the two-game test round run; only if everything passes is it sent to the server, which
re-checks what it can, stores the bytes in R2 and the entry in D1 at 1000 Elo. If any step fails,
nothing is stored anywhere — no database row, no file, no local copy. A Pages Function serves the
list from D1 (`/api/catalog/manifest.json`) and each program's bytes from R2
(`/api/catalog/<sha256>.wasm`); every download is verified against its listed hash. Identical bytes
reuse the existing entry; a new hash is a new entry even if the title and version are unchanged.
Programs a browser imported before publishing existed still appear under **On this device** (this
browser's IndexedDB) and play friendly matches only. The design is recorded in
[`docs/PLAN-shared-catalog.md`](docs/PLAN-shared-catalog.md) and
[`docs/PLAN-elo-ratings.md`](docs/PLAN-elo-ratings.md).

Curated seed programs live in [`seed/catalog/`](seed/catalog/): a maintainer adds one with
`npm run catalog:add -- path/to/file.wasm` (the same checks a browser import runs, plus a smoke test
in a killable child process) and loads it with `npm run db:seed -- --remote`. `npm test` re-verifies
every seed file.

**Rated and friendly matches.** The setup and play pages badge every pairing: *Rated* at the
standard settings between two different published programs, *Friendly* otherwise. After a rated
match the result dialog shows each program's rating change (e.g. `Elo 1000 → 1016 (+16)`); a forfeit
is recorded as unrated and says so. Recorded matches - the two programs,
each game's result and moves, the wins/losses/draws and the ratings before and after - live in the
D1 `matches` table, which is what the leaderboard's standings fold from.

The Arena referees the `desktop-jungle-v2` rules (`sdk/rules/`): the v1 rulebook plus a **draw by
repetition** when a move produces the same position (all squares and the side to move) for the third
time. Programs built for v1 are refused at upload, and older catalog rows are no longer listed.

Current public entry: **Claude-Opus-5.5 · ClaudeCode** 1.1.0 (the sample game), built in
[`wasm_sample/`](wasm_sample/) (animal art: Twemoji, CC-BY 4.0); its hash and size are in
`seed/catalog/seed.json`, and it is the reference program conformance runs play against.

**Running the catalog locally.** `npm run build`, then `npm run dev:full` serves the site and its API
at http://127.0.0.1:8788/ with local D1/R2 under `.wrangler/state`. Every start applies any new
migrations and reloads the seed catalog, so the local database keeps up with code changes. To start
from an empty catalog, stop it and delete `.wrangler/state`. On Windows, Cloudflare's local runtime
needs the Visual C++ 2015+ runtime (`winget install Microsoft.VCRedist.2015+.x64`). See
[Running locally after a code change](#running-locally-after-a-code-change).

### How it works

| Module | Responsibility |
|---|---|
| `arena/src/referee/` | The trusted referee: board, legal moves sorted by `(src, dst)`, captures, history, quiet counter, adjudication, forfeits. Tested against every case in the brief. |
| `arena/src/loader/` | Admission: size and header checks, SHA-256, the **contract check** (the component's imports and exports, with fully expanded types, must equal a component built from `wit/jungle.wit`), jco transpilation, and the disposable smoke test. |
| `arena/src/match/` | The match controller: one fresh worker per seat plus an isolated referee worker, request correlation, deadlines, pause/step/restart, forfeits, display failures and resync. |
| `arena/src/workers/` | The loader, seat and referee workers, and the main-thread handles that enforce deadlines by terminating them. |
| `arena/src/storage/`, `catalog/`, `replay/` | IndexedDB (with an in-memory fallback that says so), both catalogs, replay recording, validation and playback. |
| `arena/src/components/`, `app/` | The Vue 3 interface: `App.vue` (setup, `index.html`), `PlayApp.vue` (full-screen play, `play/index.html`) and `UploadApp.vue` (upload, `upload/index.html`). |

The wire protocol, deadlines, failure handling and replay format are documented in
[`sdk/README.md`](sdk/README.md), with the WIT, rules profile and fixtures beside it.

**Limits** (equal for both seats, shown in the UI): 24 MiB per upload, 20 s to load, 5 s per move by
default (1–30 s selectable), 2 s per frame. A timeout, trap or out-of-range index forfeits; a drawing
failure only marks that board.

**Browsers.** Chrome, Edge and Safari-class WebKit are verified (see the test record). Firefox
support is implemented with the same code paths but could not be exercised on the build machine.

### Test record — local runs

Run on Windows 10 with Node 26.13.1 against the production build served from a nested subpath
(`/nested/static/path/`), with the catalog/rating APIs on fresh local D1/R2. Recorded on
2026-11-22, after the Elo work.

| Suite | Command | Result |
|---|---|---|
| Referee, loader, contract, controller, storage, catalog, replay, uploads, match reports + verifier, Elo, leaderboard logic, maintainer tools | `npm test` | 342 tests pass; Arena+server logic coverage 88.5 % statements / 92.7 % lines (threshold 80 %) |
| Page navigation, full-screen layout (no scroll at 1920×1080, 1366×768, 1280×720 and portrait), upload → publish, admission, matches (incl. rated Elo changes), the live leaderboard, recovery, replay-after-reload in real browsers | `npm run test:e2e` | 35/35 in Chromium 159 (the run recorded here; earlier full-matrix runs also passed in installed Chrome/Edge and WebKit, where the Chromium-only evidence capture is skipped) |
| Conformance runner | `npm run conformance -- <file>` | The sample **passes**; `late-index` **fails** (forfeits); `broken-extra-import` is **rejected** at the contract stage |
| Rating maintenance | `ratings:recompute`, `matches:audit` | On the e2e database: recompute reproduces the stored ratings exactly (0 corrections), every counted game re-runs **OK**, and voiding a match folds both programs back to 1000 |

Firefox: Playwright's Firefox build could not launch on the test machine (the Visual C++ 2015–2022
runtime, `msvcp140_1.dll`, is not installed) and desktop Firefox is not installed — so Firefox is
**unverified**, not failed. Real Safari is unavailable on Windows; WebKit stands in for it.

### Test record — public verification

Pending the next deployment (`npm run deploy`). After it: open the public URL, upload a program,
play it against the public sample, swap sides, reopen its replay, and run
`npm run conformance -- <file> --url https://jungle-leaderboard.pages.dev/arena/`.

---

## Development

Requires Node 22.12 or newer; `.nvmrc` pins 24 for reproducible builds.

```bash
npm install
npm run dev        # leaderboard dev server at http://localhost:4321
npm run dev:arena  # Arena dev server at http://localhost:4322
npm run build      # rules digest check, type-checks, then leaderboard + Arena into dist/
npm run preview    # serve dist/ at http://127.0.0.1:4400/ (static only: no catalog API)
npm run dev:full   # dist/ + catalog API + local D1/R2 at http://127.0.0.1:8788/ (Arena at /arena/)
npm run check      # astro check + vue-tsc + the Functions type check, on their own
npm test           # Vitest: leaderboard, referee, loader, controller, storage, catalog, replay, catalog API
npm run test:coverage
npm run test:e2e   # Playwright against dist/ from a nested subpath, catalog API on fresh local D1/R2 (build first)
npm run test:watch # re-run tests on change
```

### Running locally after a code change

The quickest full check of a change is the built site with its catalog API:

```bash
npm run build      # rebuild dist/ with the change
npm run dev:full   # site + catalog API + local D1/R2 at http://127.0.0.1:8788/
```

Open http://127.0.0.1:8788/arena/ for the Arena (the leaderboard is at http://127.0.0.1:8788/).
`dev:full` serves the built `dist/`, so after each further change stop it (Ctrl+C), run
`npm run build`, and start it again. Each start also applies new migrations and reloads the seed
catalog.

For Arena interface work, a faster loop needs no rebuild:

```bash
npm run dev:full   # terminal 1: provides /api (build once first)
npm run dev:arena  # terminal 2: Arena with hot reload at http://localhost:4322
```

The Arena dev server forwards `/api` to `dev:full`, so edits to `arena/src/` appear immediately.
For leaderboard markup alone, `npm run dev` (http://localhost:4321) is enough, but its standings
need the API: without `dev:full` the section correctly shows its error state. After changing
`functions/` or `server/`, restart `dev:full`; after changing `wrangler.toml`, also run
`npm run cf-typegen`.

**If port 8788 is busy** (for example, another project's dev server), `dev:full` stops at once with
`port 8788 is already in use by another program`. Stop that program, or use another port:

```bash
npm run dev:full -- --port 8790   # then open http://127.0.0.1:8790/arena/
```

To use another port with `dev:arena` too, set `ARENA_API_PORT` for both commands (PowerShell:
`$env:ARENA_API_PORT = 8790`; bash: `export ARENA_API_PORT=8790`). `dev:full` prints
`site and catalog API at …` once it is ready, usually within ten seconds.

### Arena test fixtures and the catalog

```bash
npm run build:fixtures                   # rebuild arena/test-fixtures/ from tests/test-entrant/ (needs Rust 1.94 + wasm32-unknown-unknown)
npm run catalog:add -- path/to/file.wasm # add a binary to seed/catalog/ after the admission checks (--reference: make it the reference opponent)
npm run catalog:verify                   # every seed file matches its hash in seed.json and the contract; exactly one reference
npm run db:migrate -- --local            # apply migrations/ to local D1 (--remote: production)
npm run db:seed -- --local               # load seed/catalog/ into local D1/R2 (--remote: production)
npm run ratings:recompute -- --local     # re-fold Elo ratings from counted matches (--dry-run to preview)
npm run matches:audit -- --local         # re-run recorded matches in Node; --void <id> withdraws one and recomputes
npm run program:remove -- --local --list # list published programs; remove/hide one by --sha or --title
npm run program:remove -- --local --title "Muse Jungle" --version 1.2.0 # example: remove that published program
npm run conformance -- path/to/file.wasm [--browser chromium|webkit|chrome|msedge|firefox] [--url <deployed arena>]
```

The browser tests need Playwright's browsers once: `npx playwright install chromium webkit firefox`.

Run a single test file or a single case:

```bash
npx vitest run src/lib/elo-ranking.test.ts
npx vitest run -t 'assigns competition places from the rounded rating'
```

### Project layout

```
src/
  data/site.ts          Site title, description, canonical URL, byline
  lib/elo-ranking.ts    Leaderboard wire format, parser, places, medals, links, copy
  lib/ties.ts           describeRanking() — generates the shared-place sentence
  lib/format.ts         Records, ordinals and number words
  lib/*.test.ts         Vitest coverage for the logic above
  components/           Presentational Astro components (header, rules, sections, footer)
  layouts/BaseLayout    <head>, metadata, skip link
  pages/index.astro     Standings templates + bundled script over GET /api/leaderboard
  styles/tokens.css     Design tokens shared with the Arena
  styles/global.css     Base styles, responsive table rules
arena/                  The Arena: Vue 3 + Vite app built to dist/arena/ (base './')
  src/                  referee, loader, match, workers, storage, catalog, replay, components
  test-fixtures/        Test-only components: a small well-behaved entrant and deliberately broken ones
functions/              Pages Functions: catalog, match reports, leaderboard (/api/…)
server/                 API logic and its tests (real local D1/R2): catalog, uploads, match
                        reports + game verifier, Elo, leaderboard
migrations/             D1 schema
seed/catalog/           Curated catalog programs + seed.json, loaded by `npm run db:seed`
wrangler.toml           Pages config and the D1/R2 bindings
wit/jungle.wit          The Arena contract (verbatim from the brief)
sdk/                    Rules profile, fixtures and protocol documentation
scripts/                Build, catalog, conformance and static-server tools
tests/e2e/              Playwright suites
tests/test-entrant/     Rust source of the test fixtures (never published in a catalog)
wasm_sample/            The standalone game and its Arena entrant (a self-contained project)
arena_prompt.md         The Arena brief
```

Tests cover the logic layer. The Astro markup and its bundled script are verified through the build
and the Playwright leaderboard spec, and the rendered `dist/index.html` is the artifact to inspect.

### Maintaining the ratings

Nothing about the standings is edited by hand — they are the fold of the recorded matches. Three
maintainer tools keep them honest (each takes `--local` or `--remote`, and `--dry-run`):

- `npm run matches:audit` downloads both programs of each recorded match and re-runs the games in
  Node; every move and the ending must match the report. `--void <id>` withdraws a match that does
  not verify (or was selectively reported) and recomputes in the same run.
- `npm run ratings:recompute` re-folds the `counted` matches in order and corrects any stored
  standing that differs, appending one `rating_changes` row per corrected program. On a healthy
  database it reports no changes.
- `npm run program:remove` takes a published program down: by default a hard delete (match
  records, rating history, catalog row and R2 binary, then a recompute when it had counted
  matches); `--hide`/`--unhide` is the reversible version. There is deliberately no UI for this —
  uploads are anonymous, so only a maintainer can unpublish. The reference opponent and (for hard
  delete) seed entries are refused, and `--dry-run` previews everything.

#### Example: removing a published program

```bash
# 1. Find the program (title, version, identity, Elo, and the --sha to use)
npm run program:remove -- --local --list
#   "Muse Jungle" v1.2.0 (Muse · …, 1c7c47873ad8…, listed, Elo 1000, 0 rated match(es))
#     --sha 1c7c47873ad8cdf74c26d861199f54cea30501f9c26c42b2ff0fabc45727afd8

# 2. Preview exactly what would go — nothing is written
npm run program:remove -- --local --title "Muse Jungle" --version 1.2.0 --dry-run
# program:remove: REMOVE "Muse Jungle" v1.2.0 (…, 1c7c47873ad8…, listed, Elo 1000, 0 rated match(es))
#   match records: 0 counted, 1 unrated, 0 voided; 0 rating change(s)
# program:remove: --dry-run, nothing written

# 3. Remove it for real (by --title/--version, or unambiguously by --sha)
npm run program:remove -- --local --sha 1c7c47873ad8cdf74c26d861199f54cea30501f9c26c42b2ff0fabc45727afd8
# program:remove: REMOVE "Muse Jungle" v1.2.0 …
# program:remove: catalog row, match records and rating history deleted
# program:remove: binary deleted from R2
# program:remove: done. Re-uploading the same file would publish it fresh at 1000 Elo.

# Prefer reversible? Hide instead — it vanishes from catalog, pickers and leaderboard,
# its .wasm URL 404s, and --unhide restores it. Ratings are untouched either way.
npm run program:remove -- --local --sha <sha256> --hide
npm run program:remove -- --local --sha <sha256> --unhide
```

Notes on the sample: the one match record was `unrated` (a forfeit), so no recompute ran; had
the program owned *counted* matches, the tool would re-fold the remaining ratings automatically
after deleting. Hard delete is irreversible — the only way back is re-uploading the file, which
publishes it fresh at 1000. Hiding a seed entry survives `db:seed`; hard-deleting one is refused
(remove it from `seed/catalog/` first). If your `npm` warns that it is swallowing flags after
`--` (some versions do), add one more: `npm run program:remove -- -- --local --list`, or call
`node --import tsx scripts/program-remove.ts --local --list` directly. Everything above works
against production unchanged by swapping `--local` for `--remote`.

## Deployment

Live at <https://jungle-leaderboard.pages.dev>, hosted on Cloudflare Pages as a **Direct Upload**
project — the same arrangement as the seven game builds it links to. Pushing to GitHub does not deploy;
publishing is an explicit command:

```bash
npm run deploy
```

That runs the test suite and a type-checked build before uploading, so a broken change cannot reach
production half-applied. The upload contains both the leaderboard and the Arena (`dist/arena/`, including
the public catalog binaries and jco's ~8 MB of transpiler WebAssembly, every file under Pages'
25 MiB limit). It needs a Cloudflare session — run `npx wrangler login` once if
`npx wrangler whoami` reports you are not logged in.

A Direct Upload project cannot later be switched to Git integration; Cloudflare fixes that choice
when the project is created. Automatic deploys on push would require either a new project connected
to this repository or a CI workflow invoking the same `wrangler pages deploy`.

If the deployment domain changes, update `site` in `astro.config.mjs`, `SITE.url` in
`src/data/site.ts`, and the sitemap URL in `public/robots.txt` — canonical tags, Open Graph URLs and
the generated sitemap all derive from those.

---

Benchmark designed and run by [xmiao76](https://github.com/xmiao76). Model and product names are the
trademarks of their respective owners.
