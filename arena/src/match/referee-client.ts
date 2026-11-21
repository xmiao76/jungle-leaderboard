/**
 * Client for the isolated referee worker. Any failure here — a crash, a deadline, or a
 * refused request the controller did not expect — is a system error that ends the run
 * outside the board result.
 */
import type { RefereeReply, RefereeRequest } from '../protocol/messages';
import type { ForfeitReason, PlyMove, Side, Snapshot } from '../referee/types';
import type { Clock, WorkerFactory, WorkerLike } from '../workers/rpc';

export class RefereeFailure extends Error {
  override readonly name = 'RefereeFailure';
}

export interface RefereeState {
  readonly snapshot: Snapshot;
  readonly legal: readonly PlyMove[];
}

type RequestBody =
  | { readonly type: 'NEW_GAME'; readonly firstSide: Side }
  | { readonly type: 'COMMIT'; readonly rev: number; readonly move: PlyMove }
  | { readonly type: 'FORFEIT'; readonly rev: number; readonly loser: Side; readonly reason: ForfeitReason };

export class RefereeClient {
  private worker: WorkerLike | null;
  private counter = 0;
  private waiting = new Map<number, { resolve: (s: RefereeState) => void; reject: (e: RefereeFailure) => void; timer: unknown }>();

  constructor(
    factory: WorkerFactory,
    private readonly clock: Clock,
    private readonly deadlineMs = 5_000,
  ) {
    const worker = factory();
    worker.onmessage = (event) => this.onReply(event.data as RefereeReply);
    worker.onerror = (event) => {
      if ('preventDefault' in event) event.preventDefault();
      this.failAll(new RefereeFailure('The referee worker crashed.'));
    };
    this.worker = worker;
  }

  private onReply(reply: RefereeReply): void {
    const entry = this.waiting.get(reply.requestId);
    if (!entry) return;
    this.waiting.delete(reply.requestId);
    this.clock.clearTimeout(entry.timer);
    if (reply.type === 'STATE') entry.resolve({ snapshot: reply.snapshot, legal: reply.legal });
    else entry.reject(new RefereeFailure(`The referee refused the request: ${reply.message}`));
  }

  private failAll(error: RefereeFailure): void {
    const waiting = [...this.waiting.values()];
    this.waiting.clear();
    this.worker?.terminate();
    this.worker = null;
    for (const entry of waiting) {
      this.clock.clearTimeout(entry.timer);
      entry.reject(error);
    }
  }

  private send(body: RequestBody): Promise<RefereeState> {
    if (!this.worker) return Promise.reject(new RefereeFailure('The referee is not running.'));
    const requestId = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = this.clock.setTimeout(() => {
        this.failAll(new RefereeFailure(`The referee did not answer within ${this.deadlineMs / 1000} s.`));
      }, this.deadlineMs);
      this.waiting.set(requestId, { resolve, reject, timer });
      this.worker!.postMessage({ ...body, requestId } as RefereeRequest);
    });
  }

  newGame(firstSide: Side): Promise<RefereeState> {
    return this.send({ type: 'NEW_GAME', firstSide });
  }

  commit(rev: number, move: PlyMove): Promise<RefereeState> {
    return this.send({ type: 'COMMIT', rev, move });
  }

  forfeit(rev: number, loser: Side, reason: ForfeitReason): Promise<RefereeState> {
    return this.send({ type: 'FORFEIT', rev, loser, reason });
  }

  /** Stop the referee; outstanding requests are rejected at once, not left to time out. */
  dispose(): void {
    this.failAll(new RefereeFailure('The referee was stopped.'));
  }
}
