/**
 * Match controller: one fresh long-lived worker per seat, one isolated referee, one
 * decision committed at a time.
 *
 * One turn at rev N: THINK goes to the active seat only, with the official snapshot and
 * legal list for N. The first matching PROPOSAL is index-checked and revalidated by the
 * referee, the ply is persisted, the official snapshot advances to N+1, and the same
 * N+1 snapshot is rendered by both seats. Both settled frames are handed over together,
 * and only then is the next THINK sent — so a seat never has a render queued behind its
 * own search.
 *
 * Pause boundary: the loop stops after a committed ply's frames have settled. If a THINK
 * is in flight, its valid proposal is held, uncommitted, until resume or single-step.
 * Every await is guarded by `generation`; dispose/restart bumps it, so a late reply can
 * never alter a finished or restarted match.
 */
import type { Frame } from '../loader/frame';
import type { TranspiledEntrant } from '../loader/guest';
import { SEATS, type Seat } from '../protocol/messages';
import type { ForfeitReason, Level, Metadata, Piece, PlyMove, Side, Snapshot } from '../referee/types';
import type { Clock, WorkerFactory } from '../workers/rpc';
import { RefereeClient, RefereeFailure } from './referee-client';
import { SeatChannel, SeatFailure } from './seat-channel';

export interface MatchEntrant {
  readonly sha256: string;
  readonly metadata: Metadata;
  readonly artifact: TranspiledEntrant;
}

export interface MatchSettings {
  /** Which side each column plays. Left/right is independent of Red/Blue. */
  readonly sides: Readonly<Record<Seat, Side>>;
  readonly firstSide: Side;
  readonly difficulty: Level;
  readonly seed: number;
  readonly nodeBudget: number;
  readonly thinkDeadlineMs: number;
}

export interface AnimationPlan {
  /** Intermediate `progress` values to render before the settled 1000 frame. */
  readonly steps: readonly number[];
  /** Pause between plies in automatic play. */
  readonly pauseMs: number;
}

export interface PlyRecord {
  readonly rev: number;
  readonly seat: Seat;
  readonly side: Side;
  readonly index: number;
  readonly move: PlyMove;
  readonly captured: Piece | null;
  readonly noCapturePlies: number;
  readonly thinkMs: number;
}

export interface ForfeitRecord {
  readonly seat: Seat;
  readonly side: Side;
  readonly reason: ForfeitReason;
  readonly message: string;
  readonly elapsedMs: number;
  /** Set when the forfeit is a wall-clock deadline, recorded explicitly in replays. */
  readonly deadlineMs: number | null;
}

export type MatchResult =
  | {
      readonly kind: 'board' | 'forfeit';
      readonly status: Snapshot['status'];
      readonly winner: Side | null;
      readonly winnerSeat: Seat | null;
      readonly reason: Snapshot['reason'];
      readonly endRev: number;
      readonly forfeit: ForfeitRecord | null;
    }
  | { readonly kind: 'system-error'; readonly message: string; readonly endRev: number };

export type MatchPhase = 'loading' | 'ready' | 'running' | 'paused' | 'finished' | 'failed' | 'disposed';
export type SeatActivity = 'loading' | 'idle' | 'thinking' | 'rendering' | 'restarting' | 'dead';

export interface SeatView {
  readonly activity: SeatActivity;
  readonly flipped: boolean;
  readonly paneError: string | null;
  readonly ignoredReplies: number;
}

export interface MatchView {
  readonly matchId: string;
  readonly phase: MatchPhase;
  readonly snapshot: Snapshot | null;
  readonly heldProposal: PlyMove | null;
  readonly pauseRequested: boolean;
  readonly seats: Readonly<Record<Seat, SeatView>>;
  readonly failure: string | null;
  readonly result: MatchResult | null;
}

export interface MatchListener {
  state(view: MatchView): void;
  /** An intermediate animation frame; present immediately on that pane. */
  frame(seat: Seat, frame: Frame, rev: number, progress: number): void;
  /** Both settled frames for one revision (null for a pane that failed to render). */
  settled(frames: Readonly<Record<Seat, Frame | null>>, rev: number): void;
  /** Persist the ply. Awaited before anything advances past it. */
  committed(record: PlyRecord, snapshot: Snapshot): Promise<void> | void;
  ended(result: MatchResult, snapshot: Snapshot | null): Promise<void> | void;
}

export interface MatchDeps {
  readonly matchId: string;
  readonly entrants: Readonly<Record<Seat, MatchEntrant>>;
  readonly settings: MatchSettings;
  readonly seatFactory: WorkerFactory;
  readonly refereeFactory: WorkerFactory;
  readonly clock: Clock;
  readonly loadDeadlineMs: number;
  readonly renderDeadlineMs: number;
  readonly animation: () => AnimationPlan;
  readonly listener: MatchListener;
}

interface Proposal {
  readonly seat: Seat;
  readonly index: number;
  readonly move: PlyMove;
  readonly thinkMs: number;
}

interface SeatState {
  activity: SeatActivity;
  flipped: boolean;
  paneError: string | null;
  /** The instance trapped or was terminated; restart it before its next use. */
  needsRestart: boolean;
}

export class MatchController {
  private readonly channels: Record<Seat, SeatChannel>;
  private readonly referee: RefereeClient;
  private readonly seatState: Record<Seat, SeatState>;
  private phase: MatchPhase = 'loading';
  private generation = 0;
  private snapshot: Snapshot | null = null;
  private legal: readonly PlyMove[] = [];
  private held: Proposal | null = null;
  private pauseRequested = false;
  private looping = false;
  private failure: string | null = null;
  private result: MatchResult | null = null;
  private forfeitRecord: ForfeitRecord | null = null;
  /** Set by a failed think (under the seat lock); applied by the loop once the lock is free. */
  private pendingForfeit: Omit<ForfeitRecord, 'side'> | null = null;
  /** Per-seat FIFO: one request at a time, so a flip queues behind a search, never beside it. */
  private readonly locks: Record<Seat, Promise<void>> = { left: Promise.resolve(), right: Promise.resolve() };

  constructor(private readonly deps: MatchDeps) {
    if (deps.settings.sides.left === deps.settings.sides.right) throw new Error('The two seats must play different sides');
    this.channels = {
      left: new SeatChannel('left', deps.matchId, deps.seatFactory, deps.clock),
      right: new SeatChannel('right', deps.matchId, deps.seatFactory, deps.clock),
    };
    this.referee = new RefereeClient(deps.refereeFactory, deps.clock);
    const fresh = (): SeatState => ({ activity: 'loading', flipped: false, paneError: null, needsRestart: false });
    this.seatState = { left: fresh(), right: fresh() };
  }

  // ---- Public API -----------------------------------------------------------------

  get view(): MatchView {
    const seat = (s: Seat): SeatView => ({
      activity: this.seatState[s].activity,
      flipped: this.seatState[s].flipped,
      paneError: this.seatState[s].paneError,
      ignoredReplies: this.channels[s].stats.ignored,
    });
    return {
      matchId: this.deps.matchId,
      phase: this.phase,
      snapshot: this.snapshot,
      heldProposal: this.held?.move ?? null,
      pauseRequested: this.pauseRequested,
      seats: { left: seat('left'), right: seat('right') },
      failure: this.failure,
      result: this.result,
    };
  }

  /** Request types each seat has been sent, in order (diagnostics and tests). */
  sentRequests(seat: Seat): readonly string[] {
    return this.channels[seat].stats.sent;
  }

  seatFor(side: Side): Seat {
    return this.deps.settings.sides.left === side ? 'left' : 'right';
  }

  /** Load both entrants and the referee, then render revision 0 on both panes. */
  async start(): Promise<void> {
    const gen = this.generation;
    this.emit();
    const { settings, entrants, loadDeadlineMs } = this.deps;
    const loadSeat = async (seat: Seat) => {
      try {
        const ready = await this.channels[seat].init(
          entrants[seat].artifact,
          { side: settings.sides[seat], difficulty: settings.difficulty, seed: settings.seed },
          loadDeadlineMs,
        );
        if (ready.issues.length > 0) throw new SeatFailure('load', ready.issues.join(' '), 0);
        this.setActivity(seat, 'idle');
      } catch (err) {
        this.setActivity(seat, 'dead');
        throw Object.assign(err instanceof Error ? err : new Error(String(err)), { seat });
      }
    };
    try {
      const [, , state] = await Promise.all([loadSeat('left'), loadSeat('right'), this.referee.newGame(settings.firstSide)]);
      if (gen !== this.generation) return;
      this.snapshot = state.snapshot;
      this.legal = state.legal;
      await this.renderBoth(state.snapshot, [], gen);
      if (gen !== this.generation) return;
      this.phase = 'ready';
      this.emit();
    } catch (err) {
      if (gen !== this.generation) return;
      if (err instanceof RefereeFailure) return this.systemFailure(err.message);
      const seat = (err as { seat?: Seat }).seat;
      const name = seat ? `${seat} seat (${entrants[seat].metadata.title})` : 'An entrant';
      this.fail(`${name} failed to initialize: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  play(): void {
    if (this.phase !== 'ready' && this.phase !== 'paused') return;
    this.pauseRequested = false;
    void this.loop('auto');
  }

  pause(): void {
    if (this.phase !== 'running') return;
    this.pauseRequested = true;
    this.emit();
  }

  /** Commit exactly one ply, wait for both settled frames, then stay paused. */
  step(): void {
    if (this.phase !== 'ready' && this.phase !== 'paused') return;
    void this.loop('step');
  }

  /** Flip one pane's view. Coordinates and move order are unchanged; only the view rotates. */
  flip(seat: Seat): void {
    this.seatState[seat].flipped = !this.seatState[seat].flipped;
    this.emit();
    if (this.canRender()) this.renderSettled(seat).catch(() => undefined);
  }

  /** Redraw one pane from the authoritative snapshot, restarting its instance if needed. */
  resync(seat: Seat): void {
    if (this.canRender()) this.renderSettled(seat).catch(() => undefined);
  }

  /** Queued renders are safe once a snapshot exists, even during the initial render. */
  private canRender(): boolean {
    return this.snapshot !== null && this.phase !== 'failed' && this.phase !== 'disposed';
  }

  dispose(): void {
    this.generation += 1;
    this.phase = 'disposed';
    for (const seat of SEATS) this.channels[seat].dispose();
    this.referee.dispose();
    this.emit();
  }

  // ---- Turn loop ----------------------------------------------------------------------

  private async loop(mode: 'auto' | 'step'): Promise<void> {
    if (this.looping) return;
    this.looping = true;
    const gen = this.generation;
    this.phase = 'running';
    this.emit();
    try {
      while (gen === this.generation) {
        const current = this.snapshot!;
        if (current.status !== 'playing') return await this.finish(gen);

        let proposal = this.held;
        if (!proposal) {
          proposal = await this.think(this.seatFor(current.toPlay), current, gen);
          if (gen !== this.generation) return;
          if (!proposal) {
            const pending = this.pendingForfeit;
            this.pendingForfeit = null;
            if (!pending) throw new Error('A seat produced neither a proposal nor a forfeit');
            await this.forfeit(pending.seat, pending.reason, pending.message, pending.elapsedMs, pending.deadlineMs, gen);
            continue; // the next iteration finishes the game
          }
          if (this.pauseRequested && mode === 'auto') {
            this.held = proposal;
            return this.enterPause();
          }
        }
        this.held = null;
        await this.commit(proposal, gen);
        if (gen !== this.generation) return;
        if (this.snapshot!.status !== 'playing') return await this.finish(gen);
        if (mode === 'step' || this.pauseRequested) return this.enterPause();
        await this.delay(this.deps.animation().pauseMs);
        if (gen !== this.generation) return;
        if (this.pauseRequested) return this.enterPause();
      }
    } catch (err) {
      if (gen === this.generation) this.systemFailure(err instanceof Error ? err.message : String(err));
    } finally {
      this.looping = false;
    }
  }

  private enterPause(): void {
    this.pauseRequested = false;
    this.phase = 'paused';
    this.emit();
  }

  private think(seat: Seat, snapshot: Snapshot, gen: number): Promise<Proposal | null> {
    return this.withSeat(seat, () => this.thinkLocked(seat, snapshot, gen));
  }

  private async thinkLocked(seat: Seat, snapshot: Snapshot, gen: number): Promise<Proposal | null> {
    if (gen !== this.generation) return null;
    if (!(await this.ensureInstance(seat, gen))) {
      if (gen !== this.generation) return null;
      this.pendingForfeit = { seat, reason: 'trap', message: 'The instance could not be restarted after an earlier failure.', elapsedMs: 0, deadlineMs: null };
      return null;
    }
    const legal = this.legal;
    this.setActivity(seat, 'thinking');
    try {
      const { index, thinkMs } = await this.channels[seat].think(snapshot, legal, this.deps.settings.nodeBudget, this.deps.settings.thinkDeadlineMs);
      if (gen !== this.generation) return null;
      this.setActivity(seat, 'idle');
      if (!Number.isInteger(index) || index < 0 || index >= legal.length) {
        this.pendingForfeit = { seat, reason: 'invalid-move', message: `Returned index ${index}; the legal list had ${legal.length} moves.`, elapsedMs: thinkMs, deadlineMs: null };
        return null;
      }
      return { seat, index, move: legal[index]!, thinkMs };
    } catch (err) {
      if (gen !== this.generation || !(err instanceof SeatFailure) || err.kind === 'canceled') return null;
      const reason: ForfeitReason = err.kind === 'timeout' ? 'timeout' : 'trap';
      this.seatState[seat].needsRestart = true;
      this.channels[seat].terminate();
      this.setActivity(seat, 'dead');
      const deadline = err.kind === 'timeout' ? this.deps.settings.thinkDeadlineMs : null;
      this.pendingForfeit = { seat, reason, message: err.message, elapsedMs: err.elapsedMs, deadlineMs: deadline };
      return null;
    }
  }

  private async commit(proposal: Proposal, gen: number): Promise<void> {
    const before = this.snapshot!;
    const state = await this.referee.commit(before.rev, proposal.move);
    if (gen !== this.generation) return;
    const record: PlyRecord = {
      rev: state.snapshot.rev,
      seat: proposal.seat,
      side: before.toPlay,
      index: proposal.index,
      move: proposal.move,
      captured: before.board[proposal.move.dst] ?? null,
      noCapturePlies: state.snapshot.noCapturePlies,
      thinkMs: proposal.thinkMs,
    };
    await this.deps.listener.committed(record, state.snapshot);
    if (gen !== this.generation) return;
    this.snapshot = state.snapshot;
    this.legal = state.legal;
    this.emit();
    await this.renderBoth(state.snapshot, this.deps.animation().steps, gen);
  }

  private async forfeit(
    seat: Seat,
    reason: ForfeitReason,
    message: string,
    elapsedMs: number,
    deadlineMs: number | null,
    gen: number,
  ): Promise<void> {
    const side = this.deps.settings.sides[seat];
    const state = await this.referee.forfeit(this.snapshot!.rev, side, reason);
    if (gen !== this.generation) return;
    this.forfeitRecord = { seat, side, reason, message, elapsedMs, deadlineMs };
    this.snapshot = state.snapshot;
    this.legal = state.legal;
    this.emit();
    await this.renderBoth(state.snapshot, [], gen);
  }

  private async finish(gen: number): Promise<void> {
    const s = this.snapshot!;
    const forfeit = s.status === 'forfeited' ? this.forfeitRecord : null;
    this.result = {
      kind: forfeit ? 'forfeit' : 'board',
      status: s.status,
      winner: s.winner,
      winnerSeat: s.winner ? this.seatFor(s.winner) : null,
      reason: s.reason,
      endRev: s.rev,
      forfeit,
    };
    this.phase = 'finished';
    this.emit();
    await this.deps.listener.ended(this.result, s);
    if (gen !== this.generation) return;
    // The game is over: release both instances.
    for (const seat of SEATS) this.channels[seat].terminate();
  }

  // ---- Rendering -----------------------------------------------------------------------

  /** Restart a seat's instance if it trapped or was terminated. */
  private async ensureInstance(seat: Seat, gen: number): Promise<boolean> {
    const channel = this.channels[seat];
    const state = this.seatState[seat];
    if (channel.alive && !state.needsRestart) return true;
    channel.terminate();
    this.setActivity(seat, 'restarting');
    const { settings, entrants, loadDeadlineMs } = this.deps;
    try {
      await channel.init(entrants[seat].artifact, { side: settings.sides[seat], difficulty: settings.difficulty, seed: settings.seed }, loadDeadlineMs);
      if (gen !== this.generation) {
        channel.terminate();
        return false;
      }
      state.needsRestart = false;
      this.setActivity(seat, 'idle');
      return true;
    } catch {
      if (gen === this.generation) this.setActivity(seat, 'dead');
      return false;
    }
  }

  private renderSeat(seat: Seat, snapshot: Snapshot, steps: readonly number[], gen: number): Promise<Frame | null> {
    return this.withSeat(seat, () => this.renderSeatLocked(seat, snapshot, steps, gen));
  }

  private async renderSeatLocked(seat: Seat, snapshot: Snapshot, steps: readonly number[], gen: number): Promise<Frame | null> {
    if (gen !== this.generation) return null;
    const state = this.seatState[seat];
    if (!(await this.ensureInstance(seat, gen))) {
      if (gen === this.generation) {
        state.paneError = 'This entrant’s renderer is unavailable; showing its last good frame.';
        this.emit();
      }
      return null;
    }
    this.setActivity(seat, 'rendering');
    try {
      for (const progress of steps) {
        const frame = await this.channels[seat].render(snapshot, state.flipped, progress, this.deps.renderDeadlineMs);
        if (gen !== this.generation) return null;
        try {
          this.deps.listener.frame(seat, frame, snapshot.rev, progress);
        } catch {
          // Presentation problems belong to the host page, not to this entrant.
        }
      }
      const settled = await this.channels[seat].render(snapshot, state.flipped, 1000, this.deps.renderDeadlineMs);
      if (gen !== this.generation) return null;
      state.paneError = null;
      this.setActivity(seat, 'idle');
      return settled;
    } catch (err) {
      if (gen !== this.generation) return null;
      const failure = err instanceof SeatFailure ? err : new SeatFailure('trap', String(err), 0);
      if (failure.kind === 'canceled') return null;
      if (failure.kind !== 'invalid-frame') {
        state.needsRestart = true;
        this.channels[seat].terminate();
      }
      state.paneError = `Display failure: ${failure.message}`;
      this.setActivity(seat, failure.kind === 'invalid-frame' ? 'idle' : 'dead');
      return null;
    }
  }

  private async renderBoth(snapshot: Snapshot, steps: readonly number[], gen: number): Promise<void> {
    const [left, right] = await Promise.all([this.renderSeat('left', snapshot, steps, gen), this.renderSeat('right', snapshot, steps, gen)]);
    if (gen !== this.generation) return;
    this.deps.listener.settled({ left, right }, snapshot.rev);
  }

  private async renderSettled(seat: Seat): Promise<void> {
    const gen = this.generation;
    let rev = -1;
    const frame = await this.withSeat(seat, () => {
      const snapshot = this.snapshot; // the latest official snapshot once the lock is acquired
      if (!snapshot || gen !== this.generation) return Promise.resolve(null);
      rev = snapshot.rev;
      return this.renderSeatLocked(seat, snapshot, [], gen);
    });
    if (gen !== this.generation || !frame) return;
    const other: Seat = seat === 'left' ? 'right' : 'left';
    this.deps.listener.settled({ [seat]: frame, [other]: null } as Record<Seat, Frame | null>, rev);
  }

  private withSeat<T>(seat: Seat, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks[seat];
    let release!: () => void;
    this.locks[seat] = new Promise<void>((resolve) => (release = resolve));
    return previous.then(fn).finally(release);
  }

  // ---- Helpers ---------------------------------------------------------------------------

  private delay(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => this.deps.clock.setTimeout(resolve, ms));
  }

  private setActivity(seat: Seat, activity: SeatActivity): void {
    this.seatState[seat].activity = activity;
    this.emit();
  }

  private fail(message: string): void {
    this.failure = message;
    this.phase = 'failed';
    for (const seat of SEATS) this.channels[seat].dispose();
    this.referee.dispose();
    this.emit();
  }

  private systemFailure(message: string): void {
    this.generation += 1;
    this.result = { kind: 'system-error', message, endRev: this.snapshot?.rev ?? 0 };
    this.fail(`System error: ${message}`);
    Promise.resolve(this.deps.listener.ended(this.result, this.snapshot)).catch(() => undefined);
  }

  private emit(): void {
    this.deps.listener.state(this.view);
  }
}
