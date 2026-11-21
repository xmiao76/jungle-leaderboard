# Jungle Game — standalone web edition and Arena entrant requirements

## Goal and deliverables

Build one independently playable Jungle (Dou Shou Qi) game with its own AI, board presentation, and identity. Choose any language or combination of languages, framework, game engine, runtime, build tools, and test tools that can deliver both outputs. Start in a clean repository and use this brief as the complete implementation input. Each team owns its implementation, strategy and assets. Produce both artifacts from the project's release build.

| Output | What the user does | What runs |
|---|---|---|
| Standalone web game | Open a static URL, choose a difficulty and first mover, and play against the AI. | The team's chosen web stack runs the rules and AI locally and keeps input responsive during a move search. The web shell provides menus, input, audio and presentation. |
| Arena entrant, `jungle-<id>-<version>.wasm` | Download this one file and import it into either seat of a separately developed Arena. | A self-contained WebAssembly Component Model build implements the versioned WIT below and contains the entry's strategy, renderer and match art. The Arena provides the match position and display target. |

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
- Include a clearly labeled **Download Arena .wasm** action and brief import instructions. Show the same title, version, model, code agent and rules identity that the file reports via `info()`.

## Architecture and build targets

1. **Game logic and strategy.** The standalone game owns its local state and move validation. Share its rule and strategy implementation with the entrant wherever practical. Teams may load the release component in their standalone site or produce separate builds from common game code. Verify equivalent rule outcomes and strategy decisions under the same inputs and budgets. Keep long-running computation off the UI thread.
2. **Standalone frontend.** Choose the UI framework and rendering technology that fit the game. Preserve the public demo, visible animal names, accessible controls, board flip, and desktop responsiveness. Serve assets correctly from nested static paths. Offline play after first load is optional.
3. **Component build.** Pin the team's chosen tools. Generate bindings from the WIT or use a conforming adapter. If a compiler produces a core Wasm module, add a build step that creates the finished component. Bundle any required runtime, libraries, model data and match art inside the release file. An Arena that knows only the shared contract must be able to load the file and call it.
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

**Worker protocol.** The Arena owns the worker wrapper. Every request and reply carries `matchId`, `seat`, `requestId`, and `rev` outside WIT. Use messages `INIT → READY`, `THINK → PROPOSAL(index)`, and `RENDER → FRAME`, with `ERROR` on failure. In single-step mode, “rendered” means the host has presented both matching final frames. Ignore stale, duplicate, wrong-seat, or canceled replies. A second copy of the same binary in the other seat gets its own instance. See [the WIT reference](https://component-model.bytecodealliance.org/design/wit.html) and [the browser component tooling](https://bytecodealliance.github.io/jco/transpiling.html).

## Implementation details for the entrant

- Export `info`, `init`, `choose-move` and `render` through the named `game` interface. Use the supplied seed and budget. Inspect the imports of the **final component** after linking any adapters and embedded runtime. The only capability the host supplies is `display`. A team may use a different graphics stack in the standalone site if the uploaded component submits its own frames in the specified format.
- Draw the board inside the entrant. On `render`, use the game's own tiles, sprites, English labels, last-move feedback and flip logic. Submit the final RGBA bytes to `display.present`. The team chooses how to generate them. The host needs no knowledge of animal artwork or how to draw a square. In a settled frame, reconstruct any revision directly from its snapshot. On a mid-animation render, a missing previous frame can fall back to the settled frame.
- Startup should expose metadata before match initialization. Keep separate game state per instance; allow the Arena to instantiate the binary twice. Use `flipped` for the seat's view; leave the coordinates and move order unchanged. Stable move ordering and tie breaks should reproduce a choice at equal seed and node budget. Rendering extra frames must never change that choice.
- Ship WIT, generated developer-facing types or API documentation, artifact SHA-256, model and code-agent attribution, and the rule digest alongside the release. Publish them as documentation. The only file a visitor selects at import is the entrant's `.wasm`.
- Ship a browser conformance host in this repository. It opens the **exact release binary**, supplies `display.present`, and orchestrates a full match using this document's rules. Build a small fixture opponent here that implements the same WIT, always returns legal index 0, and draws a distinguishable board. Load the release and fixture opponent in isolated instances, switch their colors, and replay the official snapshots. This host is the independent acceptance path; a run against a published Arena is an additional integration check whenever available.

## Phases, tests and acceptance

| Milestone | Required evidence |
|---|---|
| 1. Rules and baseline | Use the team's test tools in CI to exercise the opening and portable positions in this document. Compare legal moves, captures, counters and terminal outcomes to the expected results specified here. Record the rules digest, game revision and toolchain. |
| 2. Playable standalone | Smoke-test the production browser build and exercise a real legal AI move. Unit-test flipped/unflipped pointer mapping, both first-mover choices, undo during thought and request IDs. Measure cold load and AI response by difficulty. Confirm input, board animations, and menus remain responsive while the AI thinks. |
| 3. Arena binary | Inspect its embedded WIT (for example, `wasm-tools component wit`). Instantiate the artifact with only the declared `display` import, read metadata, initialize, select a legal move, capture its RGBA frame, and flip the board. Exercise both seats, two copies of one file, a jump, capture, terminal snapshot and direct replay seek. Check label/art placement and that rendering does not mutate the strategy. |
| 4. Cross-build parity | On identical rule fixtures, compare legal sets, applied moves, next player, counters, and outcomes between the standalone rules and component test adapter using the expected results in this document. Test derived rule internals through a test build or local runner; keep the release WIT stable. With identical seed and node budget, compare strategy choices for representative states using the release binary. Compare recognizable settled board contents under both orientations. |
| 5. End-to-end games | Use the team's browser automation tool to load the production bundle, wait for readiness, play a scripted sequence against the AI, and finish at a verified terminal position. Complete a standalone AI-vs-AI game. From the published site download the release binary and load those exact bytes in the included browser conformance host against the bundled fixture opponent. Run as each color and verify both boards reach the same official result. Save the artifact hashes, test commands, and outcomes. |

## Repository and release

Organize the repository using the chosen stack's conventions. Include game logic, strategy, web shell, match adapter, renderer and assets, `wit/jungle.wit`, a local browser harness, tests, pinned dependencies, build scripts, `README.md`, and this brief as `prompt.md`. Produce the static site and named single-file binary from a clean checkout. Document local dev server, tests for every target, production build, artifact inspection and packaging, and the one-command workflow to rebuild both outputs.

Deploy the standalone site to Cloudflare Pages Free through Git integration or `wrangler pages deploy`; use relative paths. Derive the project slug from the meaningful repo name (for example, `tiger-lab-jungle-web` → `tiger-lab-jungle`). The README includes its verified live URL, controls, rules, architecture and runtime roles, identity of the model/code agent, version details, and how to import into the Arena. If a release binary exceeds the Pages single-asset limit, publish it in hashed static chunks and reassemble and verify them in the download action, or link a versioned release artifact. The user must still receive **one** valid `.wasm` file. [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)

After each deployment, open the public URL, confirm runtime startup, asset loading, WASM MIME types, working download, and a full game. Check modern Chrome, Edge, Firefox, and Safari; record actual browser coverage, deployment evidence and any unavailable environment. Fix failures and add regression cases. **Completion requires both flows**: a human can finish a polished standalone game, and the downloaded binary makes moves and draws its own board in two complete conformance-host matches, one in each seat. Ship the host and its fixture opponent so an independent reviewer can reproduce both results immediately.
