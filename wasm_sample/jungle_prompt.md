# Jungle Game — standalone web edition and Arena entrant requirements

This file is the complete brief for a new, empty repository. It builds a Jungle (Dou Shou Qi) game that people play in a browser, plus a single WebAssembly file of the same game that the **Jungle Arena** accepts as an upload. Everything needed is below: the rules and their test data, the WebAssembly contract, how the Arena runs an entrant, and the exact checks it applies to an uploaded file. No other document, repository or package is required. Keep this file in the new repository as `jungle_prompt.md`.

**The Jungle Arena** is a separate static site. Visitors upload entrants like this one and watch two of them play on side-by-side boards: each entrant chooses its own moves and draws its own board, while the Arena's referee owns the official position. Public instance: `https://jungle-leaderboard.pages.dev/arena/`, with uploads at `/arena/upload/`. This brief does not depend on the Arena's source code. An entrant that implements the contract and passes the admission checklist below is accepted.

## Goal and deliverables

Build one independently playable Jungle (Dou Shou Qi) game with its own AI, board presentation, and identity. Choose any language or combination of languages, framework, game engine, runtime, build tools, and test tools that can deliver both outputs. Start in a clean repository and use this brief as the complete implementation input. Each team owns its implementation, strategy and assets. Produce both artifacts from the project's release build.

| Output | What the user does | What runs |
|---|---|---|
| Standalone web game | Open a static URL, choose a difficulty and first mover, and play against the AI. | The team's chosen web stack runs the rules and AI locally and keeps input responsive during a move search. The web shell provides menus, input, audio and presentation. |
| Arena entrant, `jungle-<id>-<version>.wasm` | Download this one file, upload it on the Jungle Arena's Upload page, and play it in either seat against any other entrant, including an older version of itself. | A self-contained WebAssembly Component Model build implements the versioned WIT below and contains the entry's strategy, renderer and match art. The Arena provides the match position and a display target, and nothing else. |

The independently developed versions may have different strategies and visual designs. Keep the origin of each build visible and make the Arena panel recognizably the same game's board as its standalone board. Menus and human-input controls live in the standalone web shell. Return working builds, a development plan, automated tests, build commands, and a verified release.

## Jungle v1 rulebook and test data

This section defines the match variant for both standalone and Arena play. Start in a new repository. The WIT, board, rule identity and expected results in this document are sufficient to implement and test either side of the interface. Create or license and package the artwork and sounds your deliverable uses.

### Board, pieces and moves

- Use seven columns and nine rows. In the unflipped view, square 0 is the top left, 6 the top right, 56 the bottom left and 62 the bottom right. Flip by mapping square `i` to display cell `62-i`. Coordinates in messages and move history always use the unflipped numbering.
- The profile below lists every water, den and trap square. All other squares are ordinary land. The two opening arrays each list eight squares in the order of `animalsLowToHigh`. For example, Red's rat starts at 48 and elephant at 42. Default to Red first. Selecting Blue first changes only who moves first.
- On a turn, move exactly one friendly piece one orthogonal square, or make an eligible river jump. A row boundary cannot wrap. A destination must be empty or contain a capturable opponent. Own pieces and the moving side's den are forbidden destinations. Entering the opposing den wins immediately.
- Only rats can occupy water. A rat may step between water and an empty land square in either direction. An occupied destination across a water/land boundary cannot be captured. A swimming rat can capture another rat in adjacent water.
- A lion or tiger starting on land and facing adjacent water may jump straight to the first land square beyond the continuous water run, applying normal landing/capture rules. A rat of either color on any intermediate square blocks the jump. **Lion: two or three intervening water squares. Tiger: exactly two.** On this portrait board a short jump is `21 → 24` (horizontal) and a long jump is `15 → 43` (vertical). Apply the same length rule in reverse and on both rivers.
- On land, animals capture equal or lower ranks. Rank increases from rat (1) to elephant (8) in the profile order. An untrapped rat can take an elephant; an elephant cannot take an untrapped rat. A piece on an **opponent-owned** trap has effective rank zero. Compare the attacker's source and defender's destination before moving. Any attacker can capture a trapped defender; a trapped attacker cannot capture an untrapped defender while leaving its trap. A surviving piece regains its ordinary rank upon exiting. Friendly traps do not reduce rank.
- After a legal move, remove a captured piece, update board and history, advance the revision, and set the quiet counter to zero on capture or increment it by one otherwise. Check, in order: **enemy den reached**, **opponent has zero pieces**, **opponent has zero legal moves**, **100 consecutive plies without capture**. The first three are wins for the mover; the last is a draw. A ply is one side's move. There is no independent repetition result. Initial board counters are zero. For a live position continue with the opponent. A match ends as soon as a terminal result is committed.
- Use the wire reason strings `den`, `elimination`, `immobilization`, or `no-capture` for these results and an empty string while playing. A forfeit awards the game to the opposing seat and uses `timeout`, `trap`, or `invalid-move`. A host/referee failure is a system error outside the board result. For every committed legal move set `to-play` to the opponent, including in the terminal snapshot. A forfeit retains the last board, turn, counters and history and increments the revision once.

### Canonical rules profile

Use `desktop-jungle-v1` as the literal wire ID and `a0936f1eee833dd11107ed581dc7c5c2f72f0612d9fc7055c93a1d2fbb0c3d63` as `rules-digest`. Both are ready to use. To reproduce the digest, hash the following JSON block only, including one final LF, as UTF-8 with LF line endings and no BOM. Preserve its whitespace. SHA-256 of the entrant's binary is a separate value.

```json
{
  "id": "desktop-jungle-v1",
  "size": [7, 9],
  "index": "row*7+col; origin top-left",
  "defaultFirst": "red",
  "animalsLowToHigh": ["rat", "cat", "dog", "wolf", "leopard", "tiger", "lion", "elephant"],
  "openingByAscendingRank": {"red": [48,50,54,44,46,56,62,42], "blue": [14,12,8,18,16,6,0,20]},
  "water": [22,23,25,26,29,30,32,33,36,37,39,40],
  "den": {"red": 59, "blue": 3},
  "traps": {"red": [52,58,60], "blue": [2,4,10]},
  "step": "orthogonal-one; own den and friendly targets forbidden",
  "jumpWaterLengths": {"lion": [2,3], "tiger": [2]},
  "jumpBlocking": "any rat on traversed water",
  "swim": "rat only; captures cannot cross the water boundary in either direction",
  "trapCapture": "pre-move ranks; enemy trap sets rank to zero; trapped defender capturable by any rank; trapped attacker cannot capture an untrapped defender",
  "normalCapture": "rat beats elephant; elephant cannot take rat; otherwise attacker rank >= defender rank",
  "noCapturePlies": 100,
  "repetition": "no separate adjudication",
  "terminalOrder": ["den", "elimination", "immobilization", "no-capture"]
}
```

### Portable conformance cases

Each row below is `[name, board, candidateMove, expectedLegal]`. The board object maps decimal square numbers to `side:animal`. Unlisted squares are empty, terrain is always the canonical terrain, Red is to move, and the candidate is `[src,dst]`. Feed the position directly to the legal-move generator. Synthetic test positions can be constructed without a replay from the opening.

```json
[
  ["lion-short",        {"21":"red:lion","0":"blue:rat"},                    [21,24], true],
  ["lion-long",         {"15":"red:lion","0":"blue:rat"},                    [15,43], true],
  ["tiger-short",       {"21":"red:tiger","0":"blue:rat"},                   [21,24], true],
  ["tiger-long",        {"15":"red:tiger","0":"blue:rat"},                   [15,43], false],
  ["jump-own-rat",      {"15":"red:lion","29":"red:rat","0":"blue:cat"},      [15,43], false],
  ["jump-enemy-rat",    {"21":"red:tiger","23":"blue:rat"},                  [21,24], false],
  ["jump-capture",      {"21":"red:tiger","24":"blue:dog"},                  [21,24], true],
  ["jump-stronger",     {"21":"red:tiger","24":"blue:elephant"},             [21,24], false],
  ["rat-swims",         {"21":"red:rat","0":"blue:cat"},                     [21,22], true],
  ["cat-cannot-swim",   {"21":"red:cat","0":"blue:rat"},                     [21,22], false],
  ["water-to-land",     {"22":"red:rat","21":"blue:elephant"},               [22,21], false],
  ["land-to-water",     {"21":"red:rat","22":"blue:rat"},                    [21,22], false],
  ["water-capture",     {"22":"red:rat","23":"blue:rat"},                    [22,23], true],
  ["rat-elephant",      {"42":"red:rat","43":"blue:elephant"},               [42,43], true],
  ["elephant-rat",      {"42":"red:elephant","43":"blue:rat"},               [42,43], false],
  ["equal-rank",        {"42":"red:dog","43":"blue:dog"},                    [42,43], true],
  ["trapped-elephant",  {"51":"red:cat","52":"blue:elephant"},               [51,52], true],
  ["trapped-rat",       {"51":"red:elephant","52":"blue:rat"},               [51,52], true],
  ["trapped-attacker",  {"10":"red:tiger","11":"blue:cat"},                  [10,11], false],
  ["leave-trap-empty",  {"10":"red:tiger","0":"blue:cat"},                   [10,11], true],
  ["own-den",           {"58":"red:cat","0":"blue:rat"},                     [58,59], false],
  ["enemy-den",         {"2":"red:cat","0":"blue:rat"},                      [2,3],   true],
  ["friendly-occupied", {"42":"red:cat","43":"red:elephant","0":"blue:rat"}, [42,43], false]
]
```

For adjudication tests, apply the indicated legal Red move to the sparse position, starting with the given quiet counter. Verify the board, the counter and the result. A normal commit adds exactly one history item and advances the revision once. In the table, cells such as `R.cat@2` denote a red cat on square 2.

| Position | Move | Quiet count before → after | Expected status / winner / reason |
|---|---|---|---|
| R.cat@2, B.rat@0 | 2 → 3 | 99 → 100 | won / red / den |
| R.rat@42, B.elephant@43 | 42 → 43 | 99 → 0 | won / red / elimination |
| R.dog@2, R.cat@7, B.rat@0 | 2 → 1 | 99 → 100 | won / red / immobilization |
| R.cat@42, B.dog@6 | 42 → 43 | 98 → 99 | playing / none / empty string |
| R.cat@42, B.dog@6 | 42 → 43 | 99 → 100 | drawn / none / no-capture |
| R.wolf@42, B.cat@43, B.dog@6 | 42 → 43 | 99 → 0 | playing / none / empty string |

**Opening handshake.** Each side has 24 legal moves from the untouched opening when selected to start. With Red first and the contractual sort order, index 0 is `42 → 35`; index 23 is `62 → 61`. With Blue first, index 0 is `0 → 1`. For the default Red opening, send index 0 once. At revision 1, square 42 is empty, 35 contains the red elephant, the quiet counter is 1, history is `[[42,35]]` in pair notation, and Blue is next. Both panes receive that same revision. Replaying it with either pane flipped preserves the wire values.

## Standalone game experience

- Provide **Human vs AI** and **AI vs AI**, Easy/Medium/Hard, and an explicit first-mover choice including human first or AI first. New game and restart properly reset history, counters, caches and pending requests. Both modes must complete full games.
- Show a loading screen with meaningful progress while the game loads its engine and assets. Enable controls immediately when ready. Use two-click select-then-move input, selection highlights, legal destination and capture indicators, turn and result messages, a move history and smooth move/capture animations.
- Draw recognizable animals and distinct land, river, trap and den tiles. Label every piece with its short English animal name, readable on both colors and moving with it. Create original visuals and sounds or package assets licensed for redistribution. Include any required credits. Bundle the match art in the uploaded component. The finished desktop UI should be suitable for a public demo; touch and smaller screens are a phase-two enhancement.
- Support undo, board flip and mute. Undo restores a valid earlier state, including history, counters and turn; define its behavior in each mode. Suppress stale AI replies after undo/restart. Flip changes square-to-pixel and pointer-to-square mappings together, while preserving game state, sides and first mover. Unlock move/capture/win audio after a user gesture.
- The main menu shows **model, code agent, engine version, and runtime**. Include a “How to play” section with both win conditions, loss on no legal moves, no-capture draw, rank order, rat/elephant exception, swimming, jumps and rat blocking, traps, own den, select/move/capture indicators, undo, flip and mute.
- Include a clearly labeled **Download Arena .wasm** action and brief upload instructions: open the Arena's Upload page, choose the file, wait for every admission stage to pass, then pick **Play in left seat** or **Play in right seat**. Show the same title, version, model, code agent and rules identity that the file reports via `info()`, and the file's SHA-256.

## Architecture and build targets

1. **Game logic and strategy.** The standalone game owns its local state and move validation. Share its rule and strategy implementation with the entrant wherever practical. Teams may load the release component in their standalone site or produce separate builds from common game code. Verify equivalent rule outcomes and strategy decisions under the same inputs and budgets. Keep long-running computation off the UI thread.
2. **Standalone frontend.** Choose the UI framework and rendering technology that fit the game. Preserve the public demo, visible animal names, accessible controls, board flip, and desktop responsiveness. Serve assets correctly from nested static paths. Offline play after first load is optional.
3. **Component build.** Pin the team's chosen tools. Generate bindings from the WIT or use a conforming adapter. If a compiler produces a core Wasm module, add a build step that creates the finished component. Bundle any required runtime, libraries, model data and match art inside the release file. An Arena that knows only the shared contract must be able to load the file and call it. Read **Toolchain constraints** before choosing a language: the final component may import nothing but `display`.
4. **Arena adapter.** Evaluate the official snapshot and select an index from the exact legal list for that turn. Render either side's committed moves from that same snapshot. Keep standalone UI facilities such as human input and undo in the standalone shell. The Arena owns its worker message envelope, browser glue and per-seat display.

## Arena compatibility contract v1

Implement this contract verbatim in `wit/jungle.wit`. Each entrant is a WebAssembly **Component Model** binary with the following world. The world is `jungle:arena/competitor@1.0.0`. Authors may use any source language, framework, game engine, compiler, or combination that can produce this component. Bindings and build-time adapters are the author's choice. Public names, types, enum values, and coordinate conventions are shared by both projects. A host builds its own browser bindings. The upload is one `.wasm` file containing the strategy, renderer, metadata, and the art needed in a match.

```wit
package jungle:arena@1.0.0;

interface display {
    /// Submit one RGBA8 frame in top-to-bottom row order.
    present: func(width: u16, height: u16, rgba: list<u8>);
}

interface game {
    enum side { red, blue }
    enum animal { rat, cat, dog, wolf, leopard, tiger, lion, elephant }
    enum level { easy, medium, hard }
    enum phase { playing, won, drawn, forfeited }

    record metadata {
        title: string,
        game-version: string,
        model: string,
        code-agent: string,
        engine-version: string,
        runtime: string,
        rules-id: string,
        rules-digest: string,
    }
    record settings {
        seat: side,
        difficulty: level,
        seed: u32,
    }
    record piece { owner: side, kind: animal }
    record ply-move { src: u8, dst: u8 }
    record snapshot {
        rev: u32,
        board: list<option<piece>>,
        first-side: side,
        to-play: side,
        history: list<ply-move>,
        no-capture-plies: u32,
        status: phase,
        winner: option<side>,
        reason: string,
    }

    /// Available before init, for discovery by the host.
    info: func() -> metadata;
    /// Called once on a fresh instance at the start of its match.
    init: func(config: settings);
    /// Return the zero-based index in this call's legal list.
    choose-move: func(state: snapshot, legal: list<ply-move>, node-budget: u32) -> u32;
    /// Present one frame showing this revision from the requested perspective.
    render: func(state: snapshot, flipped: bool, progress: u16);
}

world competitor {
    import display;
    export game;
}
```

| Contract detail | Required behavior |
|---|---|
| Identity | Use the literal rules ID and SHA-256 from the canonical rules profile in this document. Match both values during admission. Each entrant reports its own engine version and runtime in its metadata. The Arena calculates the uploaded binary's own SHA-256. |
| Board | Exactly 63 cells. Index = `row * 7 + col`, rows 0–8, columns 0–6. Red's den is index 59 (bottom center); Blue's is index 3 (top center). Map the wire names `red` and `blue` to display colors at the rendering boundary. Flipping rotates only the view and pointer mapping. |
| State | Initially `rev=0` and history is empty. Every committed move appends one canonical move and increments `rev`. A forfeit increments `rev` without adding a move. `first-side` is fixed per game. `to-play` is meaningful while playing. `won` and `forfeited` carry the winning side; `drawn` and `playing` have no winner. The referee supplies the no-capture counter in individual plies and the terminal reason. |
| Move request | Called only on the active seat in a nonterminal position. The referee supplies all legal moves sorted numerically by `(src,dst)`. An index must be inside that exact list. The proposal cannot commit a move. The host owns the seed and budget. The node budget is a ceiling. Count each position visited, including roots, leaves and repeat visits. A direct policy may choose a move from the supplied position alone. Keep a legal fallback at budget exhaustion. All strategies share the host deadline. Standalone difficulty may apply a different cutoff. |
| Render | Both versions receive the same committed snapshot. `progress` is 0–1000; 1000 always draws a complete, settled board, even after seeking directly to a revision. Each call synchronously presents exactly one 448 × 576 frame (7 × 9 squares, 64 pixels per square), RGBA8, four bytes per pixel, no row padding. The host scales for the viewport. Rendering has no effect on strategy state, RNG or game outcome. |
| Runtime boundary | Only the declared display interface is supplied by the host. Embed match resources at build time and satisfy internal runtime dependencies in the artifact. The referee, browser bindings, message routing, and enforced deadlines belong to the Arena. Neither arbitrary companion JavaScript nor an external model API is needed to play. |

The Arena wraps each instance in its own Web Worker and owns all messaging, deadlines and presentation; the component never sees that layer. See [the WIT reference](https://component-model.bytecodealliance.org/design/wit.html) and [the browser component tooling](https://bytecodealliance.github.io/jco/transpiling.html).

### How the Arena runs an entrant

- **One fresh instance per seat per match.** The Arena compiles the uploaded component once, then instantiates it separately for each seat (twice when one file plays both seats). It instantiates again whenever a match restarts or a seat is resynced after a failure. Never rely on state shared between instances or carried over from an earlier match.
- **Call order.** `info()` may be called at any time, including at upload before any match. Each instance then receives `init(settings)` exactly once: `settings.seat` is the side (Red or Blue) this instance plays, not the left/right column. For every committed revision both instances receive `render` for the same snapshot; only the side to move receives `choose-move`, and only while the game is playing.
- **Rendering pattern.** For a new revision the Arena may call `render` several times with increasing `progress` (for example 200, 400, 600, 800 or 333, 667) and always finishes with `progress = 1000`; at its fastest speed it sends only 1000. It also renders a revision again at any time — when the visitor flips that board, after a resync, or when a replay seeks straight to any revision without the intermediate snapshots or any `choose-move` call. The terminal snapshot (`won`, `drawn` or `forfeited`) is rendered as well; show the result in the frame.
- **Moves.** `choose-move` receives the official snapshot, its complete legal list sorted by `(src, dst)`, and the match's node budget (visitors choose 1,000, 5,000, 20,000, 100,000 or 500,000; default 20,000). The Arena checks the returned index against that list, then its referee validates and commits the move. The component never applies a move itself.
- **No teardown call.** These four functions are the whole interface. When a deadline expires, the Arena terminates the worker.
- **Deadlines** (equal for both seats): 20 s to compile, instantiate and run `info()` and `init()`; 5 s per `choose-move` by default (visitors can choose 1, 2, 5, 10 or 30 s); 2 s per `render` call. A move timeout, a trap inside `choose-move`, or an index outside the list **forfeits the game**. A render timeout or a bad frame only marks that board and offers a resync. The component has no clock, so bound the cost of each visited node: at 20,000 nodes a move should return well under a second in a desktop browser, and at 500,000 nodes within 5 s.

### Arena admission checklist

The Arena's Upload page runs these checks in order and rejects the file with the reason of the first failure. Run the same checks against the release file in this repository's tests.

| # | Check | Passes when |
|---|---|---|
| 1 | Size | The file is at most 24 MiB (25,165,824 bytes). Aim far lower: a complete entrant with its art fits in a few hundred KiB. |
| 2 | Header | The file starts with the component preamble `00 61 73 6d 0d 00 01 00`. A core module (`00 61 73 6d 01 00 00 00`) is rejected. |
| 3 | Identity | The Arena computes the file's SHA-256, which identifies the entry everywhere. Identical bytes reuse an entry; any change makes a new one. |
| 4 | Contract | The component's imports and exports, with fully expanded types, equal those of a component built from the WIT above: exactly one import, `jungle:arena/display@1.0.0`, and exactly one export, `jungle:arena/game@1.0.0`, with every function, record, enum, field and case named and typed as written. Any other import (any WASI interface, for example), any other export, a missing function or a changed type is rejected. |
| 5 | Transpilation | jco (`@bytecodealliance/jco-transpile` 0.24.0) turns the component into browser JavaScript within 30 s. Use only plain synchronous Component Model features: no async functions, streams, futures or fixed-size lists. |
| 6 | Metadata | On a fresh instance, `info()` returns `rules-id` exactly `desktop-jungle-v1` and `rules-digest` exactly the digest above, compared byte for byte with no padding or trailing characters. Every other field is non-empty, except `engine-version`, which may be empty, and at most 160 characters. Control and invisible formatting characters are stripped before display. |
| 7 | Smoke test | Within 20 s on that instance: `init({seat: red, difficulty: medium, seed: 1})` returns; `choose-move` on the opening with Red to move, its 24-move legal list and a 1,000-node budget returns an index from 0 to 23; `render(opening, false, 1000)` and `render(opening, true, 1000)` each call `display.present` exactly once with a 448 × 576 frame of exactly 1,032,192 bytes. Nothing traps. |

After admission the Upload page shows the metadata, the rules compatibility and both opening frames, and lists the entry under “On this device”. The Arena groups entries by `title`, so keep the title identical across releases and change `game-version` for each release; a visitor can then play a release against an older one.

### Match behaviour the Arena relies on

The Arena's own conformance runner checks these, and real matches depend on them. Test each against the release binary in this repository.

- **Deterministic choices.** For the same snapshot, legal list, seed, difficulty and node budget, `choose-move` returns the same index: in a fresh instance, in a second instance of the same file, and after any number of `render` calls in between.
- **Isolated instances.** Two instances of one file in the same page never share state.
- **Flip changes only the view.** The flipped settled frame differs from the unflipped one, and rendering the same snapshot unflipped twice produces identical bytes.
- **Complete games.** Full matches at difficulty medium, seed 20261120, 20,000 nodes and 5 s per move — as Red against another entrant, as Blue, and against itself — end in a referee result (den, elimination, immobilization or the 100-ply no-capture draw) with no forfeit and with every revision rendered by both boards.

## Implementation details for the entrant

- Export `info`, `init`, `choose-move` and `render` through the named `game` interface. Use the supplied seed and budget. Inspect the imports of the **final component** after linking any adapters and embedded runtime. The only capability the host supplies is `display`. A team may use a different graphics stack in the standalone site if the uploaded component submits its own frames in the specified format.
- Draw the board inside the entrant. On `render`, use the game's own tiles, sprites, English labels, last-move feedback and flip logic. Submit the final RGBA bytes to `display.present`. The team chooses how to generate them. The host needs no knowledge of animal artwork or how to draw a square. In a settled frame, reconstruct any revision directly from its snapshot. On a mid-animation render, a missing previous frame can fall back to the settled frame.
- Startup should expose metadata before match initialization. Keep separate game state per instance; allow the Arena to instantiate the binary twice. Use `flipped` for the seat's view; leave the coordinates and move order unchanged. Stable move ordering and tie breaks should reproduce a choice at equal seed and node budget. Rendering extra frames must never change that choice.
- Ship WIT, generated developer-facing types or API documentation, artifact SHA-256, model and code-agent attribution, and the rule digest alongside the release. Publish them as documentation. The only file a visitor selects at import is the entrant's `.wasm`.
- Ship a browser conformance host in this repository. It opens the **exact release binary**, supplies `display.present`, and orchestrates a full match using this document's rules. Build a small fixture opponent here that implements the same WIT, always returns legal index 0, and draws a distinguishable board. Load the release and fixture opponent in isolated instances, switch their colors, and replay the official snapshots. This host is the independent acceptance path; a run against a published Arena is an additional integration check whenever available.

### Toolchain constraints

The host supplies nothing but `display`, so the final component — after linking adapters and the language runtime — has no WASI or other imports. That means:

- **No clock or timers.** Bound search by the node budget alone.
- **No operating-system randomness.** Derive every random choice from `settings.seed` with a deterministic generator of your own.
- **No files or network.** Embed all art, fonts, sounds and data in the binary at build time.
- **No threads.** Each instance runs single-threaded inside one worker.

Many toolchains add WASI imports by default, for example `wasi` targets and runtimes that embed an interpreter. Choose a toolchain and configuration that emits a core module with no imports other than the bindings for `display`. One known-good route is Rust on `wasm32-unknown-unknown` with `wit-bindgen`, wrapped into a component with `wasm-tools component new`. Check every release with `wasm-tools component wit <file>.wasm`: the printed world must import only `jungle:arena/display@1.0.0` and export only `jungle:arena/game@1.0.0`.

Frames are RGBA8, top row first, with straight (not premultiplied) alpha. The Arena draws them with Canvas `ImageData`, so make every pixel opaque (alpha 255).

## Phases, tests and acceptance

| Milestone | Required evidence |
|---|---|
| 1. Rules and baseline | Save the canonical rules profile as `rules/desktop-jungle-v1.json` with exactly the bytes above and fail the build if its SHA-256 differs from the rules digest. Use the team's test tools in CI to exercise the opening and portable positions in this document. Compare legal moves, captures, counters and terminal outcomes to the expected results specified here. Record the rules digest, game revision and toolchain. |
| 2. Playable standalone | Smoke-test the production browser build and exercise a real legal AI move. Unit-test flipped/unflipped pointer mapping, both first-mover choices, undo during thought and request IDs. Measure cold load and AI response by difficulty. Confirm input, board animations, and menus remain responsive while the AI thinks. |
| 3. Arena binary | Inspect its embedded WIT (for example, `wasm-tools component wit`). Instantiate the artifact with only the declared `display` import, read metadata, initialize, select a legal move, capture its RGBA frame, and flip the board. Exercise both seats, two copies of one file, a jump, capture, terminal snapshot and direct replay seek. Check label/art placement and that rendering does not mutate the strategy. Run every item of the Arena admission checklist and the match behaviour above against the release file in the test suite. |
| 4. Cross-build parity | On identical rule fixtures, compare legal sets, applied moves, next player, counters, and outcomes between the standalone rules and component test adapter using the expected results in this document. Test derived rule internals through a test build or local runner; keep the release WIT stable. With identical seed and node budget, compare strategy choices for representative states using the release binary. Compare recognizable settled board contents under both orientations. |
| 5. End-to-end games | Use the team's browser automation tool to load the production bundle, wait for readiness, play a scripted sequence against the AI, and finish at a verified terminal position. Complete a standalone AI-vs-AI game. From the published site download the release binary and load those exact bytes in the included browser conformance host against the bundled fixture opponent. Run as each color and verify both boards reach the same official result. Save the artifact hashes, test commands, and outcomes. |
| 6. Arena upload | Upload the release file on the Arena's Upload page: every admission stage passes and both opening frames appear. Play it in each seat against another entrant and against itself to a referee result, then reopen the replay. Record the Arena URL, file hash, date and outcomes. If the Arena is unreachable, record that; milestones 1–5 remain the acceptance path. |

## Repository and release

Organize the repository using the chosen stack's conventions. Include game logic, strategy, web shell, match adapter, renderer and assets, `wit/jungle.wit`, a local browser harness, tests, pinned dependencies, build scripts, `README.md`, and this brief as `jungle_prompt.md`. Produce the static site and named single-file binary from a clean checkout. Document local dev server, tests for every target, production build, artifact inspection and packaging, and the one-command workflow to rebuild both outputs.

Deploy the standalone site to Cloudflare Pages Free through Git integration or `wrangler pages deploy`; use relative paths. Derive the project slug from the meaningful repo name (for example, `tiger-lab-jungle-web` → `tiger-lab-jungle`). The README includes its verified live URL, controls, rules, architecture and runtime roles, identity of the model/code agent, version details, the release file's SHA-256, and how to upload it to the Arena. If a release binary exceeds the Pages single-asset limit, publish it in hashed static chunks and reassemble and verify them in the download action, or link a versioned release artifact. The user must still receive **one** valid `.wasm` file. [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)

After each deployment, open the public URL, confirm runtime startup, asset loading, WASM MIME types, working download, and a full game. Check modern Chrome, Edge, Firefox, and Safari; record actual browser coverage, deployment evidence and any unavailable environment. Fix failures and add regression cases. **Completion requires both flows**: a human can finish a polished standalone game, and the downloaded binary passes every item of the Arena admission checklist and makes moves and draws its own board in two complete conformance-host matches, one in each seat. Ship the host and its fixture opponent so an independent reviewer can reproduce both results immediately.
