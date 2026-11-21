# Development plan — standalone sample game

Extracted from the joint plan for the Jungle Arena and this sample ([full plan](../docs/PLAN.md)).
Decisions: a self-contained subproject sharing no code with the Arena; Twemoji (CC-BY 4.0) artwork;
one Rust core behind a wit-bindgen component and a wasm-bindgen web build.

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
