# Jungle Leaderboard

A leaderboard for an agentic-coding benchmark. Each frontier AI model is given roughly six hours of
agentic coding time to build a playable **Jungle** — Chinese *Dou Shou Qi* (斗兽棋), "the game of
fighting animals" — program from an empty repository. The finished programs are then played against
one another.

**Live site:** <https://jungle-leaderboard.pages.dev>

---

## What the benchmark measures

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

## Methodology

**Build phase.** Every model received the same task — implement a complete, playable Jungle program
— and approximately six hours of agentic coding time in which to finish it. Each model worked inside
the coding harness and effort setting recorded against it in the results table, so a row describes a
model-plus-harness configuration rather than a model in isolation.

**Competition phase.** The finished programs were played against one another. A model is credited
with a win when the program it wrote wins its match: what competes is the artifact the model
produced, not the model playing live.

**Failure criterion.** A program in which a defect is observed during competition — an illegal move
accepted, a rule applied incorrectly, a crash, or a state the game cannot recover from — is recorded
as a failure for the model that wrote it. Correctness is a precondition rather than a tiebreaker: a
program that plays strongly but violates a rule does not outrank one that plays correctly.

## Results

Standings as of **August 23, 2026**.

| # | Model | Access | Coding harness | Effort | Play | Source |
|---|-------|--------|----------------|--------|------|--------|
| 1 | Claude-Opus-5 | Closed | ClaudeCode | Max | [Play](https://claude-jungle.pages.dev/) | [Source](https://github.com/xmiao76/claude_cc_jungle_web) |
| 2 | DeepSeek-V4-Pro-0813 | Open | ClaudeCode + Vision MCP | official Max | [Play](https://deepseek-jungle.pages.dev/) | [Source](https://github.com/xmiao76/deepseek_jungle_web) |
| 3 | Grok-4.6 | Closed | GrokBuild | xhigh | [Play](https://grok-jungle.pages.dev/) | [Source](https://github.com/xmiao76/grok_jungle_web) |
| 4 | GLM-5.3 | Open | ClaudeCode | Max | [Play](https://glm-jungle.pages.dev/) | [Source](https://github.com/xmiao76/glm_jungle_web) |
| 4 | GPT-5.6-Sol | Closed | Codex | Max | [Play](https://gpt-jungle.pages.dev/) | [Source](https://github.com/xmiao76/gpt_jungle_web) |
| 6 | Kimi-K3 | Open | ClaudeCode | Max | [Play](https://kimi-jungle.pages.dev/) | [Source](https://github.com/xmiao76/kimi_jungle_web) |
| 6 | Qwen-3.8-Max | Open | ClaudeCode | xhigh | [Play](https://qwen-jungle.pages.dev/) | [Source](https://github.com/xmiao76/qwen_jungle_web) |

*Access* indicates whether the model's weights are publicly available.

### Reading the results

Places follow standard competition ranking. GLM-5.3 and GPT-5.6-Sol finished level and share fourth
place; Kimi-K3 and Qwen-3.8-Max share sixth. Each pair consumes the place below it, so neither fifth
nor seventh is awarded. Models within a tie are level with one another and are not ordered — the
alphabetical sequence shown inside a tie carries no meaning.

Per-match records are not part of this snapshot; the table publishes final placements only. Every
entry links to both the deployed build and its full source, so any result here can be replayed and
inspected directly.

A row should be read as one configuration of a model, not as a verdict on the model at every
setting. The harness driving the model and the reasoning tier it ran at both materially affect the
outcome.

---

## Jungle Arena

Upload independently built Jungle programs, compiled to WebAssembly Components, and watch two of
them play on two live boards, each drawn by its own program, under one Arena-owned referee.
Everything runs in the browser; no server computes a move. The site has separate pages, linked by
the same nav (Leaderboard · Upload · Arena):

| Page | Path | What it does |
|---|---|---|
| Leaderboard | [`/`](https://jungle-leaderboard.pages.dev/) | The benchmark standings (this README's Results). |
| Upload | [`/arena/upload/`](https://jungle-leaderboard.pages.dev/arena/upload/) | Import a `.wasm`, watch each check run, see your uploads and the public catalog, remove uploads. |
| Arena setup | [`/arena/`](https://jungle-leaderboard.pages.dev/arena/) | Pick a program and version for each seat and the match settings, then **Start**; saved replays. |
| Arena play | `/arena/play/?…` | Full screen, no scrolling: the two boards as large as the window allows, one slim control bar. Also plays back replays. |

The Arena was built by **Claude-Opus-5.5** with **ClaudeCode** from the brief in [`arena_prompt.md`](arena_prompt.md).

### Using it

1. On **Upload**, choose **Import .wasm**. Each check is shown as it runs, then the program's model,
   code agent, version, runtime and rules compatibility, and two frames it drew. **Play in left/right
   seat** opens the Arena with it selected (seat choices are remembered across pages).
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

### Two catalogs

- **On this device** — files you import. They are validated, then saved in this browser's IndexedDB
  by content hash and immediately usable. Identical bytes reuse the entry; a new hash is a new entry
  even if the title and version are unchanged. Nothing is uploaded anywhere.
- **Public catalog** — the Arena's database. A Pages Function serves the list from Cloudflare D1
  (`/api/catalog/manifest.json`) and each program's bytes from R2 (`/api/catalog/<sha256>.wasm`);
  every download is verified against its listed hash. Curated programs live in
  [`seed/catalog/`](seed/catalog/): a maintainer adds one with `npm run catalog:add -- path/to/file.wasm`
  (the same checks a browser import runs, plus a smoke test in a killable child process) and loads it
  with `npm run db:seed -- --remote`. `npm test` re-verifies every seed file.

Publishing visitors' uploads to the shared catalog, after a full functional test, is planned in
[`docs/PLAN-shared-catalog.md`](docs/PLAN-shared-catalog.md).

Current public entry: the **Jungle — Claude-Opus-5.5 sample** 1.0.0, built in
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
(`/nested/static/path/`). Recorded on 2026-11-21.

| Suite | Command | Result |
|---|---|---|
| Referee, loader, contract, controller, storage, catalog, replay, leaderboard logic | `npm test` | 186 tests pass; Arena logic coverage 86 % statements / 91 % lines (threshold 80 %) |
| Page navigation, full-screen layout (no scroll at 1920×1080, 1366×768, 1280×720 and portrait), upload, admission, matches, recovery, replay-after-reload in real browsers | `npm run test:e2e` | 115 of 116 runs pass, none fail: 29/29 in Chromium 159, installed Chrome and Edge; 28/28 in WebKit (Safari engine), where the Chromium-only evidence capture is skipped |
| Conformance runner | `npm run conformance -- <file>` | The sample and the test entrant **pass**; `late-index` **fails** (forfeits); `broken-extra-import` is **rejected** at the contract stage |

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
For the leaderboard page alone, `npm run dev` (http://localhost:4321) is enough. After changing
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
npm run conformance -- path/to/file.wasm [--browser chromium|webkit|chrome|msedge|firefox] [--url <deployed arena>]
```

The browser tests need Playwright's browsers once: `npx playwright install chromium webkit firefox`.

Run a single test file or a single case:

```bash
npx vitest run src/lib/ranking.test.ts
npx vitest run -t 'rejects a gap in the place sequence'
```

### Project layout

```
src/
  data/models.ts        Leaderboard data — the single source of truth
  data/site.ts          Site title, description, canonical URL, byline
  lib/ranking.ts        buildLeaderboard() and validateEntries(), both pure
  lib/summary.ts        Open/closed counts and Record-column visibility
  lib/ties.ts           describeRanking() — generates the shared-place sentence
  lib/format.ts         Dates, records, ordinals and number words
  lib/*.test.ts         Vitest coverage for the logic above
  components/           Presentational Astro components
  layouts/BaseLayout    <head>, metadata, JSON-LD, skip link
  pages/index.astro     Composes the page; validates data at build time
  styles/tokens.css     Design tokens shared with the Arena
  styles/global.css     Base styles, responsive table rules
arena/                  The Arena: Vue 3 + Vite app built to dist/arena/ (base './')
  src/                  referee, loader, match, workers, storage, catalog, replay, components
  test-fixtures/        Test-only components: a small well-behaved entrant and deliberately broken ones
functions/              Pages Functions: the catalog API (/api/catalog/…)
server/                 Catalog API logic and its tests (real local D1/R2)
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

Tests cover the logic layer. The components are verified through the build: `npm run build` fails on
malformed data, and the rendered `dist/index.html` is the artifact to inspect.

### Updating the leaderboard

Edit `src/data/models.ts` — nothing else holds leaderboard data. `validateEntries()` runs during the
build and fails it if an entry has a duplicate id, blank required text, a non-HTTPS URL, a source URL
outside github.com, or a place sequence that is not valid competition ranking (a gap, or a tie that
does not skip the following place).

To publish head-to-head records later, add a `record: { wins, losses, draws }` field to any entry.
The table renders a Record column automatically once at least one entry has one, so no template
change is needed.

## Deployment

Live at <https://jungle-leaderboard.pages.dev>, hosted on Cloudflare Pages as a **Direct Upload**
project — the same arrangement as the seven game builds it links to. Pushing to GitHub does not deploy;
publishing is an explicit command:

```bash
npm run deploy
```

That runs the test suite and a type-checked build before uploading, so a malformed data edit cannot
reach production. The upload contains both the leaderboard and the Arena (`dist/arena/`, including
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
