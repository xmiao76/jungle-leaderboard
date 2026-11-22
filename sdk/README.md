# Jungle Arena SDK

Everything an entrant needs to build against the Arena, extracted verbatim from the Arena brief
(`arena_prompt.md`). Nothing here depends on the Arena's own source.

| File | What it is |
|---|---|
| [`../wit/jungle.wit`](../wit/jungle.wit) | The contract: world `jungle:arena/competitor@1.0.0`. Implement it exactly. |
| [`rules/desktop-jungle-v1.json`](rules/desktop-jungle-v1.json) | The canonical rules profile. Its SHA-256 **is** the rules digest: `a0936f1eee833dd11107ed581dc7c5c2f72f0612d9fc7055c93a1d2fbb0c3d63` (bytes as committed: UTF-8, LF, one final LF, no BOM). `npm run build` re-verifies it. |
| [`fixtures/moves.json`](fixtures/moves.json) | The 23 portable legality cases: `{ name, board, move: [src, dst], legal }`, Red to move. |
| [`fixtures/adjudication.json`](fixtures/adjudication.json) | The 6 adjudication rows: board, Red move, quiet counter before/after, status/winner/reason. |
| [`fixtures/opening.json`](fixtures/opening.json) | The opening handshake: 24 moves a side, sorted-list anchors, the revision-1 state. |

The deployed Arena serves the same files at `arena/sdk/`.

## What an entrant must do

- Be **one** WebAssembly Component (not a core module) whose only import is
  `jungle:arena/display@1.0.0` and whose only export is `jungle:arena/game@1.0.0`, with exactly the
  WIT's types. WASI or any other import is rejected — the host supplies nothing else.
- `info()` works before `init()`, and reports `rules-id = desktop-jungle-v1` and the digest above.
- `choose-move` returns an index into **the list it was given** (sorted by `(src, dst)`). The node
  budget is a ceiling; count every visited position. Keep a legal fallback.
- `render` calls `display.present` **exactly once**, synchronously, with a 448 × 576 RGBA8 frame
  (1,032,192 bytes, top row first, no padding). `progress = 1000` is a settled board that must be
  reproducible from the snapshot alone. Rendering must not change any later choice.
- Keep all state per instance: the Arena runs a second copy of the same binary in its own instance.

## Admission (what the Arena checks, in order)

1. Size ≤ 24 MiB, component layer header (a core module gets an actionable rejection).
2. SHA-256 of the bytes — the entry's identity in every catalog and replay.
3. Contract: the component's imports and exports, with fully expanded type signatures, must equal
   those of a component built from `wit/jungle.wit` (`arena/src/loader/canonical-contract.json`).
4. Transpilation with jco (`@bytecodealliance/jco-transpile@0.24.0`) in a dedicated worker.
5. A smoke test on a disposable instance: `info()` (rules ID and digest must match), `init`, one
   `choose-move` on the opening, and two settled frames (unflipped, flipped).

`npm run conformance -- path/to/entrant.wasm` runs this plus behavioural checks and full matches in a
real browser. `npm run catalog:add -- path/to/entrant.wasm` runs it and publishes the binary in the
public catalog on the next deploy.

## Worker protocol

The Arena owns the worker wrapper; entrants never see these messages. Every request and reply carries
an envelope outside the WIT:

```ts
interface Envelope { matchId: string; seat: 'left' | 'right'; requestId: number; rev: number }
```

| Request (host → seat worker) | Reply | Notes |
|---|---|---|
| `INIT { artifact, settings: { side, difficulty, seed } }` | `READY { metadata, issues }` | Instantiates a fresh instance and calls `info()` then `init()`. |
| `THINK { snapshot, legal, nodeBudget }` | `PROPOSAL { index, thinkMs }` | Sent only to the side to move, for the official snapshot of `rev`. |
| `RENDER { snapshot, flipped, progress }` | `FRAME { width, height, rgba }` | `rgba` is a transferred `ArrayBuffer`, verified in the worker and again before presentation. |
| any | `ERROR { phase, kind, message }` | `kind`: `load`, `trap`, `invalid-frame`, `protocol`. |

A reply is accepted only if its whole envelope equals the single outstanding request for that seat;
stale, duplicate, wrong-seat and canceled replies are counted and dropped. The referee runs in its own
worker (`NEW_GAME`, `COMMIT { rev, move }`, `FORFEIT { rev, loser, reason }` → `STATE { snapshot, legal }`).

### One turn

At revision N the active seat gets `THINK` with snapshot N and legal list N. The first matching
`PROPOSAL` is index-checked, the referee re-validates and commits the move, the ply is **saved before
anything advances**, and the new revision N+1 is rendered by **both** seats from the same snapshot.
Both settled frames are presented in one animation frame, and only then is the next `THINK` sent.

### Deadlines and failures (equal for both seats)

| Stage | Deadline | On expiry or failure |
|---|---|---|
| Load (`INIT`) | 20 s | Match cannot start; the failing seat is named. |
| Think | 5 s default, configurable 1–30 s | Worker terminated; **forfeit `timeout`** (elapsed time recorded). |
| A trap during `choose-move` | — | **Forfeit `trap`.** |
| Index outside the legal list | — | **Forfeit `invalid-move`.** |
| Render | 2 s per frame | Pane marked; *Resync* redraws from the official snapshot (restarting the instance if it trapped or hung). Not a forfeit. |
| Referee crash/timeout | 5 s | **System error**: the run ends outside the board result. |

A forfeit keeps the board, turn, counters and history and increments the revision once.

**Pause** takes effect at the ply boundary: after a committed ply's frames have settled. A proposal
already in flight is held, uncommitted, until *Resume* or *Step*; *Step* commits exactly one ply and
waits for both settled frames (or a bounded render error).

## Replay format (`jungle-arena-replay` v1)

```jsonc
{
  "format": "jungle-arena-replay", "version": 1, "id": "…", "createdAt": "ISO-8601",
  "arena": { "version": "1.0.0", "loaderVersion": "jco-transpile@0.24.0+loader-1" },
  "rules": { "id": "desktop-jungle-v1", "digest": "a0936f1e…" },
  "series": { "id": "…", "game": 1, "of": 2 },   // optional: which game of a two-game match
  "seats": { "left": { "sha256": "…", "size": 0, "metadata": {}, "side": "red" }, "right": { … } },
  "settings": { "firstSide": "red", "seed": 0, "difficulty": "medium", "nodeBudget": 20000,
                "deadlines": { "load": 20000, "think": 5000, "render": 2000 } },
  "initial": { /* snapshot at rev 0; empty squares are null */ },
  "plies": [ { "rev": 1, "seat": "left", "side": "red", "index": 0, "move": { "src": 42, "dst": 35 },
               "captured": null, "noCapturePlies": 1, "thinkMs": 3 } ],
  "result": { "kind": "board" | "forfeit" | "system-error", … , "forfeit": { "deadlineMs": 5000, "elapsedMs": 5000, … } },
  "final": { /* terminal snapshot */ }
}
```

Opening a replay re-applies every ply through the referee; a file whose record does not reproduce
itself, or that was recorded under other rules, is refused.

A match is two games (colours swapped for game 2), and each game is its own replay. The two share a
`series.id`, and `series.game` says which game this one is. The field is optional: replays recorded
before two-game matches, and hand-made ones, omit it. If it is present it must be well formed
(`1 <= game <= of`).
