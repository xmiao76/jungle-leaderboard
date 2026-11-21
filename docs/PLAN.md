# Plan: Jungle Arena page + standalone WASM sample game

## Context

`jungle-leaderboard` is today a single static Astro page (Tailwind v4, "tournament almanac" design,
Cloudflare Pages Direct Upload via `npm run deploy`). Two briefs extend it:

1. **`Jungle_Arena_Requirements.md`** — an Arena where a visitor imports two independently built
   Jungle WebAssembly *components* (WIT world `jungle:arena/competitor@1.0.0`), picks versions, and
   watches them play on two live, guest-rendered boards, with an Arena-owned referee, deadlines,
   replays, an on-device catalog (IndexedDB) and a version-controlled public catalog.
2. **`wasm_sample/Jungle_Game_WASM_Requirements.md`** — a standalone playable Jungle web game (human vs
   AI, AI vs AI) whose release build also emits `jungle-<id>-<version>.wasm`, a self-contained
   component importable into the Arena.

Outcome: one deploy publishes leaderboard + Arena; a second, independent deploy publishes the sample
game; the sample's downloaded binary plays in the Arena against the Arena's demo entrants.

### Decisions
- **wasm_sample/** is a self-contained subproject tracked in this repo, sharing **no code** with the
  Arena (own `package.json`, Cargo workspace, lockfiles, WIT/rules copies), deployed by its own
  `npm run deploy` to a separate Pages project **`jungle-wasm-sample`**. *(user choice)*
- Sample art: **Twemoji animal SVGs (CC-BY 4.0)** vendored with `CREDITS.md`, rasterized at build time
  into an atlas embedded in the binary; attribution also carried into the Arena catalog entry and
  Arena README once the sample is published there. *(user choice)*
- **Browser loader = jco**, pinned exactly: `@bytecodealliance/jco@1.42.0` (CLI + Node prebuilds),
  whose browser export wraps `@bytecodealliance/jco-transpile@0.24.0/component` → `generate(bytes,
  {instantiation:{tag:'async'}, noNodejsCompat:true, …})`. Its wasm is located via
  `new URL(…, import.meta.url)` (Vite-bundleable; 5.7 MB + 2.4 MB, under Pages' 25 MiB/file).
  `jco-transpile/wasm-tools` provides `componentWit`/`componentNew`/`componentEmbed`/`metadataShow` in
  pure JS — **no native wasm-tools install** anywhere.
- **Arena frontend = Vue 3 + Vite app in `arena/`, `base: './'`, built into `dist/arena/`** (the brief
  names Vue; `base:'./'` gives relative assets/workers/wasm natively, which Astro's absolute
  `/_astro/` URLs would not). Astro keeps rendering the leaderboard at `/`.
- **Demo entrants in two languages, no new native toolchains:** `demo-first` in **Rust**
  (wit-bindgen 0.63, `wasm32-unknown-unknown`, already installed) and `demo-last` in
  **AssemblyScript** (npm; hand-written canonical ABI; binaryen renames exports to
  `jungle:arena/game@1.0.0#…`; `componentEmbed` + `componentNew`). Zero imports beyond `display`.
  Fallback if AS is blocked: C via wasi-sdk.
- **Sample game = one Rust core, two thin wrappers**: wit-bindgen component (entrant) and wasm-bindgen
  build (standalone shell; wasm-pack 0.15 installed). Same renderer ⇒ the Arena pane *is* the
  standalone board.
- Attribution: model **Claude-Opus-5.5**, code agent **ClaudeCode** (leaderboard naming style).
- Briefs require `prompt.md`: rename `Jungle_Arena_Requirements.md` → `prompt.md` and
  `wasm_sample/Jungle_Game_WASM_Requirements.md` → `wasm_sample/prompt.md`. Both briefs also ask for a
  committed plan: this file is copied to `docs/PLAN.md` and a sample-specific `wasm_sample/PLAN.md`.

---

## Part A — Arena (this repo)

### Layout (new)
```
wit/jungle.wit                      verbatim WIT (SDK)
sdk/rules/desktop-jungle-v1.json    exact profile bytes (LF, one final LF, no BOM; .gitattributes eol=lf)
sdk/fixtures/{moves,adjudication,opening}.json
sdk/README.md                       wire protocol, envelope, deadlines, replay schema, generated types
arena/                              Vue+Vite app → dist/arena/  (index.html, conformance.html)
  src/referee/        board, terrain, movegen, apply, adjudicate, snapshot (pure TS)
  src/protocol/       message unions + envelope {matchId, seat, requestId, rev}
  src/workers/        loader.worker.ts, seat.worker.ts, referee.worker.ts
  src/loader/         limits, header check, WIT subset parser + structural compare, transpile, smoke
  src/match/          controller (state machine), deadlines, frame staging, pause/step
  src/storage/        db.ts (idb): packages, transpile-cache, replays; sha256
  src/catalog/        public manifest fetch+verify, on-device list, version grouping
  src/replay/         schema v1, append, export/import+validate, seek, reference-board fallback
  src/audio/          WebAudio synthesized move/capture/end; gesture unlock; mute
  src/components/     EntrantColumn, ImportDialog, MatchSettings, BoardPane, SharedControls,
                      MoveHistory, ReplayBrowser, Notice
  public/catalog/manifest.json + *.wasm   (version-controlled public catalog)
entrants/demo-first-rust/           index 0; v1.0.0 and v1.1.0 (different watermark) for "A vs older A";
                                    cargo features build the broken test entrants (below)
entrants/demo-last-as/              last index; own palette + "LAST · AS" watermark
entrants/broken/                    test-only components, never in the public catalog
scripts/verify-rules-digest.mjs     build-time digest check (fails build)
scripts/build-entrants.mjs          cargo/asc → componentNew → entrants/dist + hashes + evidence
scripts/catalog-add.mjs, catalog-verify.mjs, conformance.mjs
tests/e2e/                          Playwright specs (+ evidence PNGs per pane)
.github/workflows/ci.yml            npm test + build + cargo test (arena entrants); wasm_sample job
```
Shared tokens move from `src/styles/global.css` into `src/styles/tokens.css`, imported by the Astro
CSS and the Arena. Red/Blue side chips get two muted tokens (`--c-side-red`, `--c-side-blue`),
contrast-measured in both themes, used only for side identity — documented in CLAUDE.md as the single
sanctioned exception to the four-hue palette. Leaderboard header gains a Leaderboard | Arena nav;
`BaseLayout` skip-link target becomes a prop; sitemap gets `customPages: [<site>/arena/]`.

### Phase A1 — Referee + SDK (TDD) → Milestone 1
- Vitest suites first from `sdk/fixtures`: 23 move cases, 6 adjudication rows (board, counter,
  result), opening handshake (24 moves per side; Red index 0 = 42→35, 23 = 62→61; Blue index 0 = 0→1;
  rev-1 state), forfeit semantics (rev+1, no history item, board/turn/counters kept), terminal
  `to-play` = opponent.
- Referee: terrain from the profile JSON, legal moves sorted by `(src,dst)`, jumps (lion 2|3, tiger 2,
  any-rat blocking, both rivers, both directions), swim/boundary capture, trap ranks from pre-move
  squares, quiet counter, terminal order den → elimination → immobilization → no-capture.
- `verify-rules-digest.mjs` asserts SHA-256 `a0936f1e…3d63`; wired into `npm run build` + a test.

### Phase A2 — Tracer bullet: first real import → Milestone 2 (spike gate)
1. `demo-first-rust`: `wit_bindgen::generate!`, cdylib, `opt-level="s"`; `build-entrants.mjs` →
   `cargo build --target wasm32-unknown-unknown` → `componentNew`. Renderer: 448×576 RGBA software
   raster, terrain, piece discs, 5×7 bitmap-font labels, last-move outline, flip (`62-i`), progress slide.
2. **Broken test entrants** (cargo features / tiny WIT variants): traps in `choose-move`, loops forever,
   returns out-of-range index, presents wrong size / zero / two frames per render, wrong rules digest,
   imports an extra interface (stands in for WASI), wrong world name; plus a raw core module and a
   truncated file.
3. Loader worker, staged with per-stage deadlines and visible progress: size cap (≤ 24 MiB) →
   component header (core module ⇒ actionable "wrap with component new") → SHA-256 → `componentWit` →
   structural WIT compare (imports exactly `jungle:arena/display@1.0.0`; exports exactly
   `jungle:arena/game@1.0.0` with identical enums/records/signatures) → `generate()` → smoke test in
   a **disposable** worker: `info()` (text only, length-capped; rules id+digest must match) → `init` →
   `choose-move` on the opening → `render(rev0,false,1000)` and flipped (exactly one `present` each,
   448×576, 1,032,192 bytes) → terminate.
4. Seat worker: imports cached transpiled JS via Blob URL `import()`, instantiates with host-owned
   `display.present` (copies guest bytes into a fresh `ArrayBuffer`, validates, posts `FRAME` with
   transfer). **Every** render must produce exactly one `present` — enforced in matches, not only smoke.
5. Transpile cache in IndexedDB keyed `sha256 + LOADER_VERSION` (`jco-transpile@0.24.0+loader-1`);
   stored bytes re-hashed whenever an entry is reopened.
6. **Gate:** before UI work, prove import → move → frame on Chromium, Firefox and WebKit from a nested
   static subpath, and that every broken entrant is rejected (or forfeits) with a clear reason.

### Phase A3 — Second entrant, match engine, two boards → Milestone 3
- `demo-last-as`: `--runtime stub`, custom `abort` → `unreachable`, no `env` imports. Hand-written
  lift/lower: `snapshot` = 13 flat values, `choose-move` = 16 (at MAX_FLAT_PARAMS — a test checks the
  hand-written signatures against `componentWit`), `render` = 15, `present` = 4, `init` = 3, `info`
  via return area; layouts `option<piece>` 3 B / align 1, `ply-move` 2 B / align 1. Exports
  `cabi_realloc` + `memory`. A **bump allocator reset at every exported call** plus one static frame
  buffer (stub runtime never frees). Strings converted to UTF-8 (AS is UTF-16 internally).
- Referee worker wraps the pure referee (NEW_GAME, LEGAL, COMMIT, FORFEIT).
- Match controller (pure TS; injectable worker factories + clock for unit tests):
  - Fresh seat worker per seat per match (same hash in both seats ⇒ two instances). **Start** is
    enabled only after both seats and the referee report READY; rev 0 is rendered on both panes then.
  - Turn at rev N: THINK(snapshot N, legal N, budget) to the active seat only → accept the first
    matching PROPOSAL → index check → referee COMMIT → **persist ply** → rev N+1 → RENDER the same
    snapshot to both panes (intermediate progress frames per speed; last good frame kept) → **both
    settled frames arrive, then are presented together in one `requestAnimationFrame`** → only then
    THINK for rev N+1. This ordering means a seat worker never has a render queued behind its own
    search; render timers start on dispatch to an idle worker. A flip requested on a thinking seat is
    applied when its proposal returns.
  - Ignore stale/duplicate/wrong-seat/canceled replies (matchId + seat + requestId + rev).
  - Equal, disclosed deadlines: load 20 s, think default 5 s (configurable), render 2 s. Think timeout
    ⇒ terminate worker, forfeit `timeout` (wall-clock recorded); trap ⇒ `trap`; bad index ⇒
    `invalid-move`. A dead seat's terminal/resync frame comes from a **fresh instance with the same
    settings**; if that fails, the last frame stays with a labeled overlay. Render failure ⇒ pane
    error badge + **Resync** from the authoritative snapshot. Referee/host failure ⇒ system error
    (outside the board result). Reset/close terminates all workers.
  - **Pause boundary (documented):** pause stops the loop after the current ply is committed and both
    frames have settled. If THINK is in flight, its valid proposal is held uncommitted until resume or
    single-step. **Single-step** commits exactly one ply, then waits for both settled frames (or a
    bounded render error). Restart cancels everything and issues a new matchId.
- UI: two entrant columns over the combined catalog (grouped by title; choose exact hash/version;
  A vs B, A vs older A, same binary twice); import dialog with stages + model, code agent, game
  version, runtime, rules compatibility, hash. Settings: which column is Red, first mover, difficulty,
  seed (randomize), shared node budget, think deadline; swap-and-rematch. Boards: 448×576 canvas
  CSS-scaled, header above each (seat, side chip, title, version, model), independent flip. Shared
  controls: play/pause, step, speed, restart, mute, turn, move number, state, result + reason, one
  move history. Side by side ≥ 60 rem (checked readable at ~960 px split-screen), stacked below.
  Canvases carry live `aria-label`s; a polite live region announces moves; reduced motion ⇒ settled
  frames only.
- Audio: AudioContext created on first gesture, exactly one sound per committed move, mute persisted
  (localStorage in try/catch).

### Phase A4 — Storage, replays, catalogs, recovery → Milestone 4
- Replay v1 JSON: format/version, arena + loader versions, rules id/digest, both seats (hash, size,
  metadata, side, column), settings (first side, seed, budget, deadlines, difficulty), initial snapshot,
  per-ply `{rev, seat, index, move, captured, noCapturePlies, thinkMs}`, result (status, winner,
  reason, end rev, wall-clock timeout record, system error). Appended to IndexedDB **before** the next
  ply. Download/upload as a file; **imported replays are validated** (schema, rules digest, re-applying
  plies through the referee reproduces the record). The player seeks any revision and renders with the
  original binaries when present, else an **Arena reference board** labeled as a fallback.
- Catalogs: "On this device" (IndexedDB by hash; identical bytes reuse the entry) and "Public catalog"
  (`catalog/manifest.json`, file hash verified before use; seeded with demo-first v1.0.0 + v1.1.0 and
  demo-last so a fresh browser has two playable demos). Manifest entries carry provenance, toolchain
  and credits. `npm run catalog:add -- <file>` runs the same validator + smoke test in Node, copies the
  binary, updates the manifest; `catalog:verify` runs in `npm test`. UI + README explain both paths and
  why a shared writable catalog is out of scope.
- Notices: incompatible file, init failure, timeout, IndexedDB unavailable (in-memory fallback with a
  "download your replay" prompt).
- Recovery tests: controller unit tests (fake workers/clock) **and** browser e2e with the broken
  entrants — double/stale replies, pause during think, single-step, restart, invalid move, trapping and
  hanging entrants, render error → resync, late reply after finish/restart, missing replay artifact,
  catalog reload, replay equality. E2E asserts no main-thread long tasks > 200 ms during a match.
- Policy: every gameplay/synchronization bug found gets a retained regression test.

### Phase A5 — Conformance runner, e2e, docs, deploy → Milestones 3 & 5
- `npm run conformance -- <file.wasm> [--browser chromium|firefox|webkit|msedge|chrome]`: serves
  `dist/` under a random subpath with correct MIME types, drives `arena/conformance.html` through the
  public upload path; checks admission, metadata, legal choice, frame format, flip, render-does-not-
  change-choice (choose → render ×N → choose, same index), two-instance isolation, full matches vs
  demo-first in both colors; prints JSON, non-zero exit on failure.
- Playwright e2e: upload both demos, full match in both color assignments to a referee-confirmed
  terminal, same hash in both seats, A vs older A, flip either board mid-match, both panes at the same
  rev, each seat receives only its own THINKs, pause/step, reload → reopen replay. Saves one PNG per
  pane and asserts the two renderers' frames differ (render evidence). Browsers: installed Chrome and
  Edge; Playwright Firefox (stand-in, desktop Firefox not installed) and WebKit (Safari proxy; real
  Safari unavailable on Windows — recorded as a gap).
- Interop evidence (`entrants/EVIDENCE.md`): toolchains (rustc 1.94.1 + wit-bindgen 0.63.0;
  asc 0.28.x + binaryen + jco 1.42.0), artifact SHA-256s, PNGs.
- `npm run build` = digest check → `astro check` → `vue-tsc` → `astro build` → `vite build` (arena).
  After `npm run deploy`: verify `application/wasm`, worker + jco wasm loading, a full match on the
  public URL. README + CLAUDE.md: module boundaries, wire protocol, catalog scope, browsers, limits,
  sample provenance and credits, exact commands, and **separate "local runs" and "public verification"
  test records**.

---

## Part B — Standalone sample game (`wasm_sample/`)

### Layout
```
wasm_sample/
  prompt.md, PLAN.md, README.md, CREDITS.md
  rust-toolchain.toml (1.94.1 + wasm32-unknown-unknown), Cargo.toml (workspace), Cargo.lock
  wit/jungle.wit, spec/rules + fixtures (own copies)
  assets/animals/*.svg (Twemoji CC-BY 4.0), assets/fonts/IBMPlexSans-Bold.ttf (OFL)
  crates/jungle-core/     rules, search, renderer; build.rs rasterizes SVG + labels (resvg as a
                          build-dependency only) into an RGBA atlas embedded via include_bytes!
  crates/jungle-entrant/  wit-bindgen → dist/jungle-opus55-1.0.0.wasm; feature `test-exports` adds a
                          test-only interface (legal list, apply, counters) — release WIT unchanged
  crates/jungle-fixture/  fixture opponent: always index 0, visibly different board
  crates/jungle-web/      wasm-bindgen API: legal moves, apply/undo, search, render + overlay
  web/                    Vite + TS standalone shell (base './'), ai.worker.ts
  host/                   browser conformance host (exact release binary via jco browser API)
  scripts/build-all.mjs   one command: cargo → componentNew → wasm-pack → vite build → hashes/docs
  tests/                  vitest parity tests, Playwright e2e
```

### Phases
- **B1 Rules & baseline (TDD):** `cargo test` drives the 23 move cases, 6 adjudication rows, opening
  handshake; records rules digest, game revision, toolchain. CI job runs it.
- **B2 Engine:** negamax α-β, iterative deepening, capture/den-pressure ordering, evaluation (material
  by rank, advancement, den threats, trap exposure). Node counter counts every visited position incl.
  root/leaves/revisits; hard stop at budget with a legal fallback; **fresh search state (incl. any
  transposition table) per `choose-move`**, tie-breaks from seeded xorshift (seed + rev), no wall clock
  in the component — so equal seed + budget reproduce the choice after seeks. Standalone difficulty
  maps to budgets (Easy ~2k + noise, Medium ~25k, Hard ~250k + worker time cutoff).
- **B3 Renderer:** 448×576; distinct land/river/trap/den tiles; side-colored discs with the Twemoji
  animal and English name label (readable on both colors, moves with the piece); last-move marks;
  flip; `progress` slide + capture fade; 1000 = settled and reconstructable from the snapshot alone;
  terminal banner. Rendering never touches search state/RNG. The standalone overlay (selection, legal
  dots, capture rings) exists only in the web wrapper.
- **B4 Entrant, fixture, host:** imports verified to be only `display` (`jco wit`); two instances
  isolated. Component tests: both seats, two copies of one file, a jump, a capture, a terminal snapshot,
  direct replay seek, flip, label/art placement via pixel probes, choose → render ×N → choose returns
  the same index. The **conformance host** uses its own TypeScript referee (independent of the Rust
  core, tested against the same fixtures), plays release vs fixture as each color, then replays the
  official snapshots through both instances with seeks and flips; `npm run host` locally and a deployed
  `/host/` page so a reviewer can reproduce immediately.
- **B5 Standalone shell:** loading screen with real progress; menu: Human vs AI / AI vs AI,
  Easy/Medium/Hard, first mover (human or AI), identity panel (title, version, model, code agent,
  engine version, runtime, rules id/digest) read from the **release binary's own `info()`**; How to
  play (both win conditions, no-legal-move loss, no-capture draw, ranks, rat/elephant, swimming, jumps
  + rat blocking, traps, own den, indicators, undo, flip, mute); two-click input with highlights,
  legal-destination and capture indicators; turn/result messages; history; smooth animations; undo
  (HvA: back to the human's previous turn; AvA: one ply while paused), flip (pixel and pointer mapping
  together), mute, restart/new game resetting history, counters, AI caches and pending requests; AI in
  a worker with request IDs (stale replies dropped); synthesized original audio unlocked by a gesture;
  keyboard-operable controls with ARIA labels; **Download Arena .wasm** with SHA-256 and import steps.
- **B6 Parity, e2e, release:** rule parity (legal sets, applied moves, next player, counters,
  outcomes) between the web build and the `test-exports` component build; strategy parity (same choice
  at equal seed/budget) and byte-identical settled frames in both orientations between the web build and
  the **release** binary. Unit tests: flipped/unflipped pointer mapping, both first movers, undo during
  thought, request IDs. Playwright, from a nested subpath: production bundle → ready → deterministic
  scripted human game (seed hook) to a verified terminal position; full AI-vs-AI game; frame rate stays
  smooth during a Hard search; cold load and AI latency per difficulty recorded. Publish next to the
  `.wasm`: `.sha256`, WIT, `jco types` output, rules digest, model/agent attribution. Deploy to
  `jungle-wasm-sample`, download the binary from the live URL, run the host as each color.

## Part C — Integration
Import the sample's downloaded `.wasm` into the deployed Arena through the upload path, play it against
both demo entrants in both colors, then `npm run catalog:add` it (with its Twemoji credit) and redeploy.

---

## Execution notes
- Order: A1 → A2 (spike gate) → A3 → A4 → A5 → B1…B6 → C. If browser transpile fails in an engine at
  the gate, I report it before building UI.
- Each phase: tests first, green `npm test` / `cargo test`, then a **code-reviewer** agent pass;
  CRITICAL/HIGH fixed before moving on. Coverage target 80 % on `arena/src` logic.
- Dependencies (pinned in lockfiles): jco 1.42.0 (exact), vue, @vitejs/plugin-vue 6, vite ^8.2
  (Astro's 8.2.1), vue-tsc, idb, assemblyscript, binaryen, @playwright/test,
  @vitest/coverage-v8@4.1.10 (must match vitest 4.1.10, not latest 5.x), fake-indexeddb; Rust crates
  wit-bindgen 0.63, wasm-bindgen (matching wasm-pack 0.15), resvg (build-dep).
- Both deploys are outward-facing (the second creates a new Pages project); I'll confirm before each.
  Nothing is committed unless you ask.

## Verification (end to end)
1. `npm test` — referee fixtures, digest, controller/recovery, loader validation, storage, replay,
   catalog verify; coverage ≥ 80 %.
2. `npm run build:entrants && npm run conformance -- entrants/dist/demo-last-as.wasm` per browser.
3. `npm run test:e2e` — uploads, full matches both colors, same hash twice, A vs older A, flip,
   pause/step, broken-entrant forfeits, reload + replay reopen, served from a nested subpath.
4. `cd wasm_sample && npm run build:all && cargo test && npm test && npm run test:e2e`.
5. `npm run conformance -- wasm_sample/dist/jungle-opus55-1.0.0.wasm` — sample vs demos in the Arena.
6. After deploys: open both public URLs, check `.wasm` MIME, worker/jco loading, complete a game,
   switch sides, reopen the replay, download the sample binary and run the host as each color; record
   browser coverage, hashes and URLs in both READMEs.
