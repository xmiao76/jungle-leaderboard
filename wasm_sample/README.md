# Jungle — a Claude-Opus-5.5 sample game

A standalone, playable **Jungle (Dou Shou Qi, 斗兽棋)** web game whose release build also produces a
single-file **Arena entrant**, `claude-opus-5-5-claudecode-1.1.0.wasm`: the same strategy, rules and artwork as a
self-contained WebAssembly Component for the [Jungle Arena](https://jungle-leaderboard.pages.dev/arena/).

Built by **Claude-Opus-5.5** with **ClaudeCode** on the **official** model platform, from the brief in [`jungle_prompt.md`](jungle_prompt.md).

| | |
|---|---|
| Live game | <https://jungle-wasm-sample.pages.dev> *(published by `npm run deploy`; see Release below)* |
| Arena entrant | `claude-opus-5-5-claudecode-1.1.0.wasm` — 134,476 bytes |
| SHA-256 | `8842387f3251a950d8081bb713cfb0876e243648583784e563d9e637c6db50e8` |
| GitHub | <https://github.com/xmiao76/jungle-leaderboard> (also reported by `info()` as `github-url`) |
| World | `jungle:arena/competitor@1.0.0` — imports only `jungle:arena/display@1.0.0` |
| Rules | `desktop-jungle-v2` (v1 plus the draw by repetition), digest `a457bbc009e975a9eafe5ff1f8fa40ca2548f2a689b121c8c4ed99dd0f3fdc57` |
| Game / engine version | 1.1.0 / jungle-core 1.1.0 (alpha-beta, iterative deepening, repetition-aware) |
| Runtime | Rust 1.94.1, `wasm32-unknown-unknown`, wit-bindgen 0.63.0 |

## Playing

Open the site and choose **Human vs AI** or **AI vs AI**, **Easy / Medium / Hard**, and who moves
first (you or the AI, and which colour you play). The menu shows the model, code agent, model
platform, engine version and runtime — the same identity the `.wasm` reports through `info()`.

- **Move:** click one of your pieces (gold ring), then a highlighted square: dark dots are moves, red
  rings are captures. Keyboard: arrow keys move a cursor, Enter selects and moves.
- **Undo:** in Human vs AI it returns to your previous turn (taking back the AI's reply and your move;
  if the AI is still thinking, its search is abandoned and your move is taken back). In AI vs AI it
  steps back one ply while paused. Any AI reply that arrives after an undo or restart is ignored.
- **Flip** turns the board around (pixels and clicks together). **Mute** silences the synthesized
  sounds, which start after your first click. **Restart** replays the same settings; **New game**
  opens the menu.

The rules are summarized in the game's *How to play* section: win by entering the enemy den or
capturing every piece; a player without a legal move loses; 100 plies without a capture is a draw;
the rat beats the elephant (but not from the water), only rats swim, lions and tigers jump rivers
unless a rat is in the way, and an enemy trap reduces a piece to rank zero.

## Importing into the Arena

1. In the game, use **Download Arena .wasm** (or take `dist/claude-opus-5-5-claudecode-1.1.0.wasm`). It is the only
   file the Arena needs.
2. In the [Jungle Arena](https://jungle-leaderboard.pages.dev/arena/), choose **Import .wasm**. It is
   validated, saved on your device, and immediately usable in either seat. It is also in the Arena's
   public catalog as *Claude-Opus-5.5 · ClaudeCode* (the sample game).

Published next to the binary: [`release/release.json`](web/public/release/release.json) (identity,
hash, imports), the [WIT contract](wit/jungle.wit), the WIT embedded in the binary
(`release/embedded.wit`), generated TypeScript types (`release/types/`), the rules profile, and a
`.sha256` file.

## Architecture

```
crates/jungle-core      rules, search and renderer — no binding code; used by everything below
crates/jungle-entrant   wit-bindgen wrapper → the release component (feature test-exports: a test-only
                        build that also exports the rules, for parity tests; the release WIT is unchanged)
crates/jungle-web       wasm-bindgen wrapper → the standalone game's engine and its AI worker
crates/jungle-fixture   conformance fixture opponent: always legal index 0, plain grayscale board
web/                    standalone shell (Vite + TypeScript): menus, input, audio, animation
web/host/               browser conformance host + an independent TypeScript referee
scripts/                asset pipeline, one-command build, PNG helper, static server
spec/, wit/             the brief's rules profile, fixtures and WIT (own copies)
tests/                  parity and component tests (Vitest) and browser tests (Playwright)
```

**Runtime roles.** In the standalone game, `jungle-web` runs on the main thread for rules, move hints
and rendering, and a second instance runs the AI search in a Web Worker, so input and animation stay
smooth during a search. In the Arena, the release component does only what the contract asks:
`choose-move` (the same `jungle-core` search, with the host's node budget and seed) and `render`
(the same renderer, presenting one 448 × 576 RGBA frame). Because both builds call the same core,
the parity tests can require identical choices and **byte-identical** settled frames.

**Search.** Iterative-deepening negamax with alpha-beta pruning, capture and den-pressure move
ordering, and an evaluation of material, advancement, den threats and trap exposure. Every visited
position counts against the node budget; state is fresh for every call and ties are broken by a
xorshift stream seeded from (seed, revision), so equal inputs reproduce the same choice and rendering
can never influence it. Standalone budgets: Easy 2,000 nodes (with more noise), Medium 30,000; Hard
searches against a one-second wall-clock deadline per move (worker messaging included) and plays
the best move of its deepest completed search.

**Rendering.** A software rasterizer over an embedded, deflated sprite atlas (Twemoji animals, original
tiles, labels and banners rasterized at build time). Pieces show the animal and its English name;
the last move is tinted; `progress < 1000` slides the moving piece and flashes captures; a settled
frame depends only on the snapshot, so any revision can be drawn directly.

## Building

Requirements: Rust 1.94.1 with `wasm32-unknown-unknown` (pinned in `rust-toolchain.toml`),
wasm-pack 0.15, Node 22.12+.

```bash
npm install
npm run build:all      # one command: assets → components → wasm-pack → release documents → site
npm run dev            # dev server for the standalone game at http://localhost:5180
```

`build:all` writes `dist/claude-opus-5-5-claudecode-1.1.0.wasm` (release), `dist/test/jungle-opus55-test.wasm`
(test-exports build), `dist/jungle-fixture-1.0.0.wasm`, and the static site in `web/dist/`.
Artwork changes: `npm run assets` (verifies pinned downloads, rebuilds the atlas).

Inspect the artifact:

```bash
sha256sum dist/claude-opus-5-5-claudecode-1.1.0.wasm
cat web/public/release/embedded.wit     # the WIT embedded in the binary (via jco-transpile componentWit)
cat web/public/release/release.json     # identity, hash and imports
```

## Testing

```bash
cargo test --workspace   # rules (all brief fixtures), search, renderer, snapshot encoding — 22 tests
npx vitest run           # release component + parity + session + host referee — 54 tests
npx playwright test      # browser tests against the production build from a nested path
npm test                 # cargo test + vitest
```

| What | Evidence |
|---|---|
| Milestone 1 — rules | The 23 legality cases, 6 adjudication rows and the opening handshake pass in `jungle-core` and, independently, in the host's TypeScript referee. |
| Milestone 2 — standalone | Production build: scripted human game to a terminal position, AI vs AI to completion, pointer mapping flipped and unflipped, both first movers, undo during the AI's thought, request ids. |
| Milestone 3 — Arena binary | Only `display` is imported; metadata; both seats; two copies of one file; a jump; a capture; terminal and forfeit snapshots; direct seek; label placement; rendering does not change choices. |
| Milestone 4 — parity | Same legal sets, applied moves, next player, counters and outcomes (test-exports build vs web build); same choices at equal seed and budget; byte-identical settled frames in both orientations (release binary vs web build). |
| Milestone 5 — end to end | The conformance host loads the exact published bytes, checks their hash, and plays the release against the fixture as Red and as Blue to a terminal position, then re-renders recorded revisions on fresh instances. |

Measured in Chromium 159 on the build machine (local production build):

| | Easy | Medium | Hard |
|---|---|---|---|
| AI move from the opening | 8 ms | 78 ms | 759 ms |
| Frames painted during the search / worst frame gap | 1 / 10 ms | 5 / 17 ms | 45 / 17 ms |

Cold load of the production bundle: about 0.2 s locally. Raw numbers: `docs/evidence/timings-chromium.json`.

**Browsers.** The Playwright suite passes in Chromium, installed Chrome and Edge, and WebKit (Safari
engine). Firefox could not be launched on the build machine (missing Visual C++ runtime) and real
Safari is not available on Windows; both are recorded as unverified.

**1.1.0 (2026-11-22): rules `desktop-jungle-v2`.** A position occurring for the third time is a draw.
The rules count positions from the snapshot history (stepping the quiet moves since the last capture
back), and the search scores a line as a draw when it would make a third occurrence or returns to a
position already reached in that search, so the engine avoids repeating when ahead and seeks it when
behind. Head-to-head against 1.0.0 under the v2 referee (hard, 20,000 nodes, 6 seeds, colours
swapped per pair): 5 wins, 5 losses, 2 draws, a score of 6/12. The side moving first usually won, so
the versions are even; 12 games cannot resolve a small difference (95% interval about 50% ± 28%). One
game was decided by the new rule: 1.1.0, losing as Blue, drew by repetition.

The game was also run through the Arena's own conformance runner (`npm run conformance` in the parent
repository): 1.1.0 passes admission and every behavioural check, and its three conformance matches (as
Red, as Blue and against itself, since it is the only public catalog program) are still draws by the
100-ply no-capture rule: the engine keeps moving rather than repeating. Against the Arena's test entrant, which always plays the first legal move, it
wins by reaching the den as Red (35 plies) and as Blue (38 plies).

## Release

Deploy with `npm run deploy` (build, tests, then `wrangler pages deploy web/dist --project-name
jungle-wasm-sample`). After deploying: open the URL, check the engine loads and the `.wasm` downloads
with `content-type: application/wasm`, finish a game, then download the binary and run
`/host/` on it as each colour. **Public verification has not been run yet** — it is recorded here
after the first deployment.

Credits: [`CREDITS.md`](CREDITS.md). Development plan: [`PLAN.md`](PLAN.md).
