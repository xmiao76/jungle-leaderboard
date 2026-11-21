/**
 * Game session logic for the standalone shell, independent of the DOM so it can be
 * unit-tested with fakes.
 *
 * Undo policy:
 * - Human vs AI: undo returns to the human's previous turn. If the AI is thinking, its
 *   request is abandoned and the human's last move is taken back (1 ply); otherwise the
 *   AI's reply and the human's move before it are taken back (2 plies).
 * - AI vs AI: undo takes back one ply while paused or after the game has ended, and
 *   leaves the game paused (so a finished game is not immediately replayed).
 * Request ids are unique across all sessions on the page: a reply from an earlier game,
 * or from before an undo, can never match the current request.
 */

/** Shared by every session: ids must not repeat when a new game starts. */
let requestCounter = 0;

export type Mode = 'human-ai' | 'ai-ai';
export type Level = 0 | 1 | 2; // easy, medium, hard

/** The subset of jungle-web's `Game` the session uses. */
export interface Engine {
  rev(): number;
  to_play(): number;
  status(): number;
  legal(): Uint8Array;
  play(src: number, dst: number): boolean;
  undo(plies: number): number;
  can_undo(): number;
  snapshot(): Uint8Array;
  last_was_capture(): boolean;
  free?(): void;
}

export interface AiRequest {
  readonly id: number;
  readonly snapshot: Uint8Array;
  readonly budget: number;
  readonly seed: number;
  readonly level: Level;
}

export interface AiReply {
  readonly id: number;
  readonly index: number;
  readonly ms: number;
}

export interface SessionOptions {
  readonly mode: Mode;
  readonly level: Level;
  /** 0 = red, 1 = blue: the side the human plays in human-vs-AI. */
  readonly humanSide: 0 | 1;
  readonly seed: number;
  readonly budget: number;
}

export type SessionEvent =
  | { readonly type: 'moved'; readonly src: number; readonly dst: number; readonly capture: boolean; readonly by: 'human' | 'ai' }
  | { readonly type: 'thinking'; readonly on: boolean }
  | { readonly type: 'undone'; readonly plies: number }
  | { readonly type: 'over' };

export class Session {
  private epoch = 0;
  private pending: number | null = null;
  paused = false;
  lastThinkMs = 0;

  constructor(
    readonly engine: Engine,
    readonly options: SessionOptions,
    private readonly requestAi: (request: AiRequest) => void,
    private readonly emit: (event: SessionEvent) => void,
  ) {}

  get thinking(): boolean {
    return this.pending !== null;
  }

  get over(): boolean {
    return this.engine.status() !== 0;
  }

  isHumanTurn(): boolean {
    return this.options.mode === 'human-ai' && !this.over && this.engine.to_play() === this.options.humanSide;
  }

  legalFrom(square: number): number[] {
    const legal = this.engine.legal();
    const out: number[] = [];
    for (let i = 0; i < legal.length; i += 2) if (legal[i] === square) out.push(legal[i + 1]!);
    return out;
  }

  /** Ask the AI to move if it is its turn. */
  advance(): void {
    if (this.over || this.pending !== null || this.paused) return;
    if (this.options.mode === 'human-ai' && this.engine.to_play() === this.options.humanSide) return;
    const id = ++requestCounter;
    this.pending = id;
    this.emit({ type: 'thinking', on: true });
    this.requestAi({
      id,
      snapshot: this.engine.snapshot(),
      budget: this.options.budget,
      // Mix the epoch in so a replay after undo does not have to repeat the same choice.
      seed: (this.options.seed ^ (this.epoch * 0x9e3779b1)) >>> 0,
      level: this.options.level,
    });
  }

  /** Called with every worker reply; stale or unexpected replies are ignored. */
  receive(reply: AiReply): boolean {
    if (reply.id !== this.pending) return false;
    this.pending = null;
    this.lastThinkMs = reply.ms;
    this.emit({ type: 'thinking', on: false });
    const legal = this.engine.legal();
    // Never stall: an unusable index falls back to the first legal move.
    const index = reply.index >= 0 && reply.index * 2 < legal.length ? reply.index : 0;
    if (legal.length === 0) return false;
    this.commit(legal[index * 2]!, legal[index * 2 + 1]!, 'ai');
    return true;
  }

  /** The worker reported an error for request `id`; play the first legal move instead. */
  fail(id: number): boolean {
    return this.receive({ id, index: 0, ms: 0 });
  }

  /** A human move; refused unless it is the human's turn and the move is legal. */
  humanMove(src: number, dst: number): boolean {
    if (!this.isHumanTurn() || this.pending !== null) return false;
    return this.commit(src, dst, 'human');
  }

  private commit(src: number, dst: number, by: 'human' | 'ai'): boolean {
    if (!this.engine.play(src, dst)) return false;
    this.emit({ type: 'moved', src, dst, capture: this.engine.last_was_capture(), by });
    if (this.over) this.emit({ type: 'over' });
    return true;
  }

  canUndo(): boolean {
    if (this.engine.can_undo() === 0) return false;
    return this.options.mode === 'human-ai' || this.paused || this.over;
  }

  undo(): number {
    if (!this.canUndo()) return 0;
    this.epoch += 1;
    let plies: number;
    if (this.options.mode === 'ai-ai') {
      plies = 1;
      this.paused = true;
    } else if (this.pending !== null) {
      plies = 1; // abandon the AI's search and take back the human's move
    } else if (this.engine.to_play() === this.options.humanSide) {
      // The AI's reply and the human's move before it; just 1 if the AI moved first and
      // only it has moved so far.
      plies = Math.min(2, this.engine.can_undo());
    } else {
      plies = 1; // game over after the human's move: take back that move
    }
    if (this.pending !== null) {
      this.pending = null;
      this.emit({ type: 'thinking', on: false });
    }
    const undone = this.engine.undo(plies);
    this.emit({ type: 'undone', plies: undone });
    return undone;
  }

  /** Stop listening for any outstanding request (new game, restart, teardown). */
  cancel(): void {
    this.epoch += 1;
    if (this.pending !== null) {
      this.pending = null;
      this.emit({ type: 'thinking', on: false });
    }
  }
}
