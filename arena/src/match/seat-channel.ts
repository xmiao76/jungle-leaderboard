/**
 * Request/response for one seat worker: at most one outstanding request, matched by
 * the full envelope. Anything else — stale, duplicate, wrong seat, canceled — is
 * counted and dropped. Deadlines terminate the worker, since a synchronous guest call
 * cannot be interrupted.
 */
import type { Frame } from '../loader/frame';
import type { TranspiledEntrant } from '../loader/guest';
import type { Envelope, ReadyReply, Seat, SeatReply, SeatRequest } from '../protocol/messages';
import { sameEnvelope } from '../protocol/messages';
import type { Level, PlyMove, Side, Snapshot } from '../referee/types';
import { SeatHandle, type Clock, type WorkerFactory } from '../workers/rpc';

export type SeatFailureKind = 'timeout' | 'trap' | 'invalid-frame' | 'crash' | 'load' | 'protocol' | 'canceled';

export class SeatFailure extends Error {
  override readonly name = 'SeatFailure';
  constructor(
    readonly kind: SeatFailureKind,
    message: string,
    readonly elapsedMs: number,
  ) {
    super(message);
  }
}

type ReplyType = 'READY' | 'PROPOSAL' | 'FRAME';

interface Pending {
  readonly env: Envelope;
  readonly expect: ReplyType;
  readonly started: number;
  readonly resolve: (reply: SeatReply) => void;
  readonly reject: (failure: SeatFailure) => void;
  timer: unknown;
}

export interface SeatStats {
  /** Replies dropped because their envelope matched no outstanding request. */
  ignored: number;
  /** Request types sent, in order (tests assert who was asked to think). */
  readonly sent: SeatRequest['type'][];
}

export class SeatChannel {
  private handle: SeatHandle | null = null;
  private pending: Pending | null = null;
  private requestCounter = 0;
  private disposed = false;
  readonly stats: SeatStats = { ignored: 0, sent: [] };

  constructor(
    readonly seat: Seat,
    private readonly matchId: string,
    private readonly factory: WorkerFactory,
    private readonly clock: Clock,
  ) {}

  get alive(): boolean {
    return this.handle?.alive ?? false;
  }

  get busy(): boolean {
    return this.pending !== null;
  }

  private ensureWorker(): SeatHandle {
    if (this.handle?.alive) return this.handle;
    this.handle = new SeatHandle(
      this.factory,
      (reply) => this.onReply(reply),
      (crash) => this.fail(new SeatFailure('crash', crash.message, this.elapsed()), true),
    );
    return this.handle;
  }

  private elapsed(): number {
    return this.pending ? Math.round(this.clock.now() - this.pending.started) : 0;
  }

  private onReply(reply: SeatReply): void {
    const pending = this.pending;
    if (!pending || !sameEnvelope(reply.env, pending.env)) {
      this.stats.ignored += 1;
      return;
    }
    if (reply.type === 'ERROR') {
      const kind: SeatFailureKind = reply.kind === 'invalid-frame' ? 'invalid-frame' : reply.kind === 'load' ? 'load' : reply.kind === 'protocol' ? 'protocol' : 'trap';
      this.fail(new SeatFailure(kind, reply.message, this.elapsed()), false);
      return;
    }
    if (reply.type !== pending.expect) {
      this.stats.ignored += 1;
      return;
    }
    this.clock.clearTimeout(pending.timer);
    this.pending = null;
    pending.resolve(reply);
  }

  private fail(failure: SeatFailure, kill: boolean): void {
    const pending = this.pending;
    this.pending = null;
    if (pending) this.clock.clearTimeout(pending.timer);
    if (kill) this.killWorker();
    pending?.reject(failure);
  }

  private killWorker(): void {
    this.handle?.terminate();
    this.handle = null;
  }

  private request<T extends SeatReply>(
    build: (env: Envelope) => SeatRequest,
    expect: ReplyType,
    rev: number,
    deadlineMs: number,
    label: string,
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new SeatFailure('canceled', 'The seat was disposed', 0));
    if (this.pending) return Promise.reject(new SeatFailure('protocol', `${this.seat} seat already has a request outstanding`, 0));
    const handle = this.ensureWorker();
    const env: Envelope = { matchId: this.matchId, seat: this.seat, requestId: ++this.requestCounter, rev };
    return new Promise<T>((resolve, reject) => {
      const pending: Pending = {
        env,
        expect,
        started: this.clock.now(),
        resolve: resolve as (reply: SeatReply) => void,
        reject,
        timer: null,
      };
      pending.timer = this.clock.setTimeout(() => {
        if (this.pending !== pending) return;
        this.fail(new SeatFailure('timeout', `${label} exceeded its ${deadlineMs / 1000} s deadline`, deadlineMs), true);
      }, deadlineMs);
      this.pending = pending;
      const message = build(env);
      this.stats.sent.push(message.type);
      try {
        handle.send(message);
      } catch (err) {
        // postMessage throws synchronously on uncloneable data; never leave the seat busy.
        this.fail(new SeatFailure('protocol', err instanceof Error ? err.message : String(err), 0), false);
      }
    });
  }

  async init(artifact: TranspiledEntrant, settings: { side: Side; difficulty: Level; seed: number }, deadlineMs: number): Promise<ReadyReply> {
    return this.request<ReadyReply>((env) => ({ type: 'INIT', env, artifact, settings }), 'READY', 0, deadlineMs, 'Loading');
  }

  async think(snapshot: Snapshot, legal: readonly PlyMove[], nodeBudget: number, deadlineMs: number): Promise<{ index: number; thinkMs: number }> {
    const reply = await this.request<Extract<SeatReply, { type: 'PROPOSAL' }>>(
      (env) => ({ type: 'THINK', env, snapshot, legal, nodeBudget }),
      'PROPOSAL',
      snapshot.rev,
      deadlineMs,
      'Thinking',
    );
    return { index: reply.index, thinkMs: reply.thinkMs };
  }

  async render(snapshot: Snapshot, flipped: boolean, progress: number, deadlineMs: number): Promise<Frame> {
    const reply = await this.request<Extract<SeatReply, { type: 'FRAME' }>>(
      (env) => ({ type: 'RENDER', env, snapshot, flipped, progress }),
      'FRAME',
      snapshot.rev,
      deadlineMs,
      'Rendering',
    );
    return { width: reply.width, height: reply.height, rgba: new Uint8Array(reply.rgba) };
  }

  /** Cancel whatever is outstanding; its late reply will be ignored. */
  cancel(): void {
    this.fail(new SeatFailure('canceled', 'Request canceled', this.elapsed()), false);
  }

  /** Stop the worker. Anything outstanding is settled as canceled, never left hanging. */
  terminate(): void {
    this.fail(new SeatFailure('canceled', 'The instance was stopped', this.elapsed()), true);
  }

  /** Terminate and refuse all future requests (no worker is ever created again). */
  dispose(): void {
    this.disposed = true;
    this.terminate();
  }
}
