# Jungle Arena — implementation requirements

## Goal

Build a static browser application where a visitor imports two independently produced Jungle (Dou Shou Qi) WebAssembly games, selects a version for each seat, and watches them play on **two live, side-by-side boards**. Each uploaded program chooses its own moves and draws its own board. The Arena owns the official position, validates moves, controls match timing, and saves the replay. Matches run locally after loading, with no model API calls or server-side game computation. Uploading, match setup and play are separate pages, and the play page gives nearly the whole window to the two boards.

Implement this brief from a clean repository. Build the referee, a test-only entrant (with deliberately broken variants for the test suite), and their assets within the project. Real games for the public catalog are built as separate projects and admitted with the maintainer command; the public catalog never lists demo or test entrants. The embedded WIT, rule profile and test positions are the inputs for your implementation. Deliver the working site, a reusable SDK extracted from this document, tests, and deployment instructions. Begin with a short implementation plan and finish with evidence from actual runs.

**Entrant admission is language-neutral.** Accept any uploaded component that passes the same binary, rule, rendering and resource checks. Run it through the same loader in either seat. The visitor supplies the release artifact alone. The WIT and fixtures embedded here are suitable for any toolchain. The frontend, loader and referee choices below are internal to the Arena.

## User workflow

1. Open the public Arena URL. The site is a set of separate pages (see **Site pages and layout**). On the **Upload** page, an **Import .wasm** control shows validation progress and, once a file is admitted, its title, model, code agent, game version, runtime, and rule compatibility, with buttons to play it in the left or right seat. The same page lists the public catalog and the programs on this device.
2. On the **Arena setup** page, pick a specific version in each column. Allow A vs B, A vs an older version of A, and the same binary in both seats. Label left/right independently from Red/Blue. Let the visitor choose sides, first mover, difficulty, seed, a shared search budget, the think deadline and the animation speed, and optionally begin paused.
3. **Start match** opens the full-screen **Arena play** page, and play starts after both entrants and the referee are ready. Display each version's own board continuously, with a one-line seat, side, model and version label above it. One shared bar shows the current turn, move number, match state, last move and result; the single move history opens in an overlay drawer. Offer swap-and-rematch with the same settings from the bar.
4. Support automatic play, pause/resume, single ply, speed, independent board flip, and replay. Keep names and move highlights readable at desktop split-screen widths. Shared audio starts after a user gesture, has a mute toggle, and plays once per move. Portrait viewports stack the boards while preserving identity and controls; the play page never scrolls.
5. A visitor can download a replay and reopen it after a page refresh; replays play back on the same full-screen page. Show a clear message for incompatible files, failed initialization, timeout, and unavailable local storage.

## Site pages and layout

The site is a set of separate static pages that share one design system and work from any static subpath. Build every link, catalog URL and worker or SDK URL from a root that each page declares, never from the document base URL.

| Page | Path | Contents |
|---|---|---|
| Leaderboard | `/` | The existing leaderboard. |
| Upload | `/arena/upload/` | **Import .wasm** with staged validation progress and the admitted entrant's metadata, plus **Play in left seat** / **Play in right seat**, which open the setup page with that seat chosen. Lists the public catalog and the programs “On this device” (removable) and explains both. No match UI. |
| Arena setup | `/arena/` | One column per seat (program and exact version, identified by SHA-256), the match settings and **Start match**. Saved replays (open, download, delete, open a replay file) and a short explanation of how the Arena works. No boards. `?left=<sha256>&right=<sha256>` preselects the seats, and the last choices persist on the device. |
| Arena play | `/arena/play/?…` | The match, or a replay, full screen. |

Leaderboard, Upload and Arena setup share one site navigation (Leaderboard · Upload · Arena). The play page replaces it with a single link back to setup.

**Play page.** The two game UIs get almost the whole window.

- The page never scrolls, vertically or horizontally, at any viewport size. One slim bar runs across the top; below it the two boards split the remaining space left and right, each scaled to the largest 7:9 box that fits. Viewports with an aspect ratio of 5:6 or narrower stack the boards top and bottom under the same rule. The host scales the 448 × 576 guest frame, so larger boards are bigger, not sharper.
- Directly above each board, one line: seat, a Red/Blue side chip, program title and version, model, short hash, the seat's activity (thinking, waiting), a “to move” marker, and a flip button. Long text truncates; the full identity stays available as a tooltip and in the accessible name.
- The bar holds everything shared: a link back to setup, match state, move number, revision, the last move, and the turn or the result; then play/pause, step, speed, restart, swap & rematch, mute, history, and full screen.
- Nothing else enters the layout flow. The single move history and the match details (seed, budgets, deadlines, hashes) open in an overlay drawer that is closed by default; notices appear as toasts; a display failure and its **Resync** stay inside the affected board. Opening any of them never moves or resizes a board.
- Keyboard: Space play/pause, S step, H history, M mute, Escape closes the drawer. Space and Enter still activate a focused button or link.
- The URL carries the whole configuration (`left`, `right`, `leftSide`, `first`, `level`, `seed`, `budget`, `think`, `speed`, `paused`), so a match link can be shared and a reload restarts the same match with the same seed. Invalid values are ignored with a notice naming them; a program that is neither in the public catalog nor on this device is reported, not substituted. Swap & rematch updates the URL in place.
- `/arena/play/?replay=<id>` plays a saved replay in the same layout. The bar switches to replay controls (start, back, play/pause, forward, end, and a seek slider; ← and → step), and a board whose original renderer is missing shows the labeled reference board.

## Hosting and catalog

Deploy as a static Cloudflare Pages Free site. A browser upload means the selected bytes are **immediately usable on this device**, saved in IndexedDB by content hash. Persist imports and replays across reloads when storage permits. A new hash is a new entry even if its title or version string is unchanged; reimporting identical bytes reuses the entry. Label this catalog “On this device.”

Also deliver a **public catalog** from version-controlled static assets. Supply a maintainer command or CI job to validate imported binaries, update the catalog manifest with hashes, and publish them with the next Pages deployment. A fresh browser can select these entries. The public catalog lists only real games meant to be played; test entrants used by the test suite stay in the repository's test fixtures and are never published. Explain both paths in the UI and README. A shared writable catalog that publishes every visitor's upload immediately would need an additional storage service and is outside the static deployment profile.

## Match execution

| Owner | Responsibility |
|---|---|
| Vue/Nuxt static frontend or equivalent | Separate upload, setup and play pages, two Canvas elements, selectors, responsive controls, frame presentation, accessibility labels, and verified package/replay storage. No match depends on SSR. |
| Match controller | Create one fresh long-lived Worker/instance per seat and one isolated referee worker. Correlate requests, enforce deadlines, handle pause/stop, and commit one decision at a time. Loading and transpilation also run off the UI thread. |
| Trusted referee (Arena-owned) | Implement the rulebook in this document in the host team's chosen stack. Own the board, legal-move generation, captures, history, quiet counter, and adjudication. Use the embedded cases to test the referee independently of the two entrants. |
| Uploaded games | Both render official positions. Only the active seat receives a move request. Their isolated memories, caches, artwork, and render output belong to their respective instances. |

**One turn.** At revision 12, request a move from the active player using the official snapshot and legal list for revision 12. Accept at most one response for that request; check the index and revalidate the move with the referee. Atomically record and apply the move, advance to 13, then send the same revision-13 snapshot to both renderers. Preserve the last good frame during loading or animation. Stage both settled frames for single-step and present them in one animation callback. Never infer a move from canvas pixels, animation timing, or the other game's local board.

**Pause and failure.** Pause takes effect at a documented ply boundary. Hold a valid in-flight proposal without committing until resume or single-step; cancel pending work on restart and discard old replies. Single-step commits exactly one ply, then waits for both settled frames or a bounded render-error response. Apply equal, disclosed budgets to the two seats. Provide separate finite deadlines for loading, rendering, and thinking. A timed-out, trapped, or invalid move from the active player forfeits the game with an explicit reason. A display failure marks the affected pane and offers a resync from the authoritative snapshot. A referee or host failure ends the run as a system error. End or terminate workers on reset and close.

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

## Browser loader and persistence

- Import a Component Model binary using a pinned, browser-compatible version of jco in a dedicated loader worker. Implement and test the browser transpilation/instantiation path in the deployed site. The Node CLI can prebuild bundled samples. A newly imported file must work from the public site without a backend, developer tools, rebuilding the site, or uploading generated JS.
- Validate component structure, declared imports and exported types against the WIT in this brief before running guest code. Reject incompatible files with an actionable reason. Restrict sizes and time spent validating, compiling, instantiating and rendering; use host-owned glue and explicit imports. Treat metadata as text. Cache outputs by original hash **and** loader version. Run `info()` and a bounded startup, choose, and frame smoke test on a disposable instance before catalog admission. Confirm actual game bytes still match the recorded hash when reopening an entry.
- Use a transferable frame buffer or OffscreenCanvas after verifying the frame dimensions and byte count. Keep a Canvas 2D presentation path for supported desktop browsers. An Arena-supplied reference board is useful when a replay's binary is missing; clearly label this fallback. Live acceptance requires two genuine guest-rendered boards.
- Record both hashes, metadata, rules ID/digest, starting board and side, seed and budgets, every committed move, official snapshots or lossless deltas, and the result/reason. Store records before advancing past a committed ply. A replay displays the recorded decisions without rerunning search. Reopen with either or both original renderers when available. A wall-clock timeout is recorded explicitly.

## Phases, tests and acceptance

| Milestone | Acceptance evidence |
|---|---|
| 1. Referee and SDK | The referee passes the opening handshake, move and adjudication cases above. Extract the WIT, canonical rules JSON and fixtures into the repository; verify the embedded digest during the build. Deliver a conformance runner that takes a finished `.wasm` as input. The runner handles browser loading and checks observable behavior for every entrant using the same settings. |
| 2. First real import | From an arbitrary static subpath, import a newly built single-file component, read metadata, obtain a legal move, and show a frame generated by that component. Reject wrong world/rules, malformed input and an invalid frame gracefully. |
| 3. Two boards and controls | Build a small test entrant within this repository that chooses the first sorted legal move, implements the complete WIT and submits labeled frames of every official board, in two versions for “A vs older A”. Import it through the public upload path and play it against a real game from the public catalog, which draws its own, visibly different board. Using those exact binaries and the same host build, run a full match in both color assignments to a referee-confirmed terminal state. Record the toolchains and artifact hashes as interoperability evidence. Verify both frame streams have the same committed revision, each uses its own renderer, each seat receives only its own turns, and both still work after flipping either board. Test the same hash in both seats and a version against its older version. |
| 4. Pages and play layout | Leaderboard, upload, setup and play are separate pages with their own paths, linked as described above, and work from an arbitrary static subpath. The play page has no vertical or horizontal scroll at 1920 × 1080, 1366 × 768, 1280 × 720 and a portrait 800 × 1280 viewport. On the landscape sizes the two boards sit side by side and together cover at least 60 % of the viewport; on portrait they stack. Opening the history drawer does not move or resize either board. Each board's label names the seat, side, program, version and model. Reloading a play URL restarts the same match. |
| 5. Recovery and storage | Test double/stale replies, pause during thought, single-step, restart, invalid move, trapped or nonresponsive entrant, render error, missing replay artifact, catalog reload and replay equality. The UI stays responsive; a late result cannot alter a finished or restarted match. |
| 6. Public verification | Smoke-test current desktop Chrome, Edge, Firefox and Safari or report which were available and record gaps. On the public site, upload a locally built entrant, play it against a public catalog game on the full-screen play page, complete a game, swap sides, and reopen its replay. Keep local runs distinct from public verification. |

**Repository and delivery.** Include frontend, worker bridge, referee adapter, SDK WIT and fixtures, the test entrants and their build script, render evidence from a real match showing two visibly distinct guest boards, tests, lockfiles, and `arena_prompt.md` containing this brief. The README identifies the model and code agent that built the Arena, documents the site's pages and their paths, the module boundaries and wire protocol, catalog scope, supported browsers, limits, sample provenance, and exact local build/test/serve commands. Summarize test outcomes, fix regressions, and retain a regression test for each gameplay or synchronization bug.

Deploy using Cloudflare Pages Git integration or documented `wrangler pages deploy` commands. Derive a short hyphenated project name from the repository name, use relative asset paths, and verify WASM MIME types, worker loading and CDN reachability from the published URL. Keep deployable assets within Pages' per-file limit; chunk and reassemble larger static binaries with hash verification if needed. Keep user imports as a single downloadable artifact. Publish the verified URL and test record in the README when deployment access is available. [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)

**Completion:** a visitor can import two compatible files into the deployed Arena, see the two independent game interfaces filling the play page, run and step a legal full match, and reopen the same result after a reload. A shared board drawn twice or two unrelated local simulations fails this acceptance test.
