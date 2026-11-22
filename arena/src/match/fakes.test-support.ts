/**
 * Test doubles for the match controller: scripted seat workers, a loopback referee
 * worker running the real referee, and a manual clock. Replies are delivered on the
 * microtask queue, like real worker messages arriving between tasks.
 */
import { FRAME_BYTES, FRAME_HEIGHT, FRAME_WIDTH } from '../loader/limits';
import type { RefereeReply, RefereeRequest, Seat, SeatReply, SeatRequest } from '../protocol/messages';
import { applyMove, forfeit, initialSnapshot, legalMoves, RULES_DIGEST, RULES_ID } from '../referee';
import type { Metadata, PlyMove, Snapshot } from '../referee/types';
import type { Clock, WorkerLike } from '../workers/rpc';

export const METADATA: Metadata = {
  title: 'Fake',
  gameVersion: '1.0.0',
  model: 'Test',
  codeAgent: 'Test',
  githubUrl: 'https://github.com/example/jungle',
  engineVersion: 'fake',
  runtime: 'vitest',
  rulesId: RULES_ID,
  rulesDigest: RULES_DIGEST,
};

export class ManualClock implements Clock {
  private time = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private next = 1;
  now(): number {
    return this.time;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.timers.set(id, { at: this.time + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }
  advance(ms: number): void {
    this.time += ms;
    for (const [id, timer] of [...this.timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at <= this.time && this.timers.has(id)) {
        this.timers.delete(id);
        timer.fn();
      }
    }
  }
}

/** Let queued microtasks and promise chains run to quiescence. */
export async function flush(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

export type ThinkBehaviour = number | 'first' | 'last' | 'trap' | 'hang' | 'defer' | 'out-of-range';
export type RenderBehaviour = 'ok' | 'trap' | 'invalid-frame' | 'hang';

export interface SeatScript {
  /** Tag written into byte 0 of every frame so tests can tell renderers apart. */
  readonly tag: number;
  think?: (snapshot: Snapshot, legal: readonly PlyMove[]) => ThinkBehaviour;
  render?: (snapshot: Snapshot, progress: number) => RenderBehaviour;
  initFails?: boolean;
  duplicateReplies?: boolean;
  staleReplies?: boolean;
}

export class FakeSeatWorker implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  readonly received: SeatRequest[] = [];
  /** Resolves a deferred THINK with the given index. */
  release: ((index: number) => void) | null = null;

  /** Bound from the first envelope, since one factory serves both seats. */
  seat: Seat | null = null;

  constructor(private readonly scripts: Readonly<Record<Seat, SeatScript>>) {}

  private get script(): SeatScript {
    return this.scripts[this.seat ?? 'left'];
  }

  private deliver(reply: SeatReply): void {
    queueMicrotask(() => {
      if (this.terminated) return;
      if (this.script.staleReplies) {
        this.onmessage?.({ data: { ...reply, env: { ...reply.env, requestId: reply.env.requestId - 1 } } } as MessageEvent);
      }
      this.onmessage?.({ data: reply } as MessageEvent);
      if (this.script.duplicateReplies) this.onmessage?.({ data: reply } as MessageEvent);
    });
  }

  postMessage(message: unknown): void {
    if (this.terminated) return;
    const msg = message as SeatRequest;
    this.seat ??= msg.env.seat;
    this.received.push(msg);
    const env = msg.env;
    switch (msg.type) {
      case 'INIT':
        if (this.script.initFails) this.deliver({ type: 'ERROR', env, phase: 'init', kind: 'load', message: 'cannot load' });
        else this.deliver({ type: 'READY', env, metadata: METADATA, issues: [] });
        return;
      case 'THINK': {
        const behaviour = this.script.think?.(msg.snapshot, msg.legal) ?? 'first';
        const propose = (index: number) => this.deliver({ type: 'PROPOSAL', env, index, thinkMs: 1 });
        if (behaviour === 'hang') return;
        if (behaviour === 'trap') return this.deliver({ type: 'ERROR', env, phase: 'think', kind: 'trap', message: 'RuntimeError: unreachable' });
        if (behaviour === 'defer') {
          this.release = (index) => {
            this.release = null;
            propose(index);
          };
          return;
        }
        if (behaviour === 'first') return propose(0);
        if (behaviour === 'last') return propose(msg.legal.length - 1);
        if (behaviour === 'out-of-range') return propose(msg.legal.length);
        return propose(behaviour);
      }
      case 'RENDER': {
        const behaviour = this.script.render?.(msg.snapshot, msg.progress) ?? 'ok';
        if (behaviour === 'hang') return;
        if (behaviour === 'trap') return this.deliver({ type: 'ERROR', env, phase: 'render', kind: 'trap', message: 'RuntimeError: unreachable' });
        if (behaviour === 'invalid-frame') return this.deliver({ type: 'ERROR', env, phase: 'render', kind: 'invalid-frame', message: 'Frame is 1×1' });
        const rgba = new Uint8Array(FRAME_BYTES);
        rgba[0] = this.script.tag;
        new DataView(rgba.buffer).setUint32(4, msg.snapshot.rev);
        rgba[8] = msg.flipped ? 1 : 0;
        this.deliver({ type: 'FRAME', env, width: FRAME_WIDTH, height: FRAME_HEIGHT, rgba: rgba.buffer });
        return;
      }
      case 'SMOKE':
        return;
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  thinkRevs(): number[] {
    return this.received.filter((m): m is Extract<SeatRequest, { type: 'THINK' }> => m.type === 'THINK').map((m) => m.snapshot.rev);
  }
}

export class FakeRefereeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private official: Snapshot | null = null;
  terminated = false;

  constructor(private readonly crashOnCommit = false) {}

  postMessage(message: unknown): void {
    const msg = message as RefereeRequest;
    queueMicrotask(() => {
      if (this.terminated) return;
      if (msg.type === 'COMMIT' && this.crashOnCommit) {
        this.onerror?.({ message: 'referee exploded', preventDefault() {} } as ErrorEvent);
        return;
      }
      let reply: RefereeReply;
      try {
        if (msg.type === 'NEW_GAME') this.official = initialSnapshot(msg.firstSide);
        else if (msg.type === 'COMMIT') this.official = applyMove(this.official!, msg.move);
        else this.official = forfeit(this.official!, msg.loser, msg.reason);
        reply = { type: 'STATE', requestId: msg.requestId, snapshot: this.official, legal: legalMoves(this.official) };
      } catch (err) {
        reply = { type: 'REFUSED', requestId: msg.requestId, message: String(err) };
      }
      this.onmessage?.({ data: reply } as MessageEvent);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

/** Decode the tag, revision and flip bit a FakeSeatWorker wrote into a frame. */
export function frameInfo(rgba: Uint8Array): { tag: number; rev: number; flipped: boolean } {
  return { tag: rgba[0]!, rev: new DataView(rgba.buffer, rgba.byteOffset).getUint32(4), flipped: rgba[8] === 1 };
}
