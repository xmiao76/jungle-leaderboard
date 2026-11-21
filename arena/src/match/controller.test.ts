import { describe, expect, it } from 'vitest';
import type { Seat } from '../protocol/messages';
import { applyMove, initialSnapshot } from '../referee';
import type { Side, Snapshot } from '../referee/types';
import { MatchController, type MatchResult, type MatchView, type PlyRecord } from './controller';
import { FakeRefereeWorker, FakeSeatWorker, flush, frameInfo, ManualClock, METADATA, type SeatScript } from './fakes.test-support';

const ARTIFACT = { js: '', modules: {} };

interface Options {
  left?: Partial<SeatScript>;
  right?: Partial<SeatScript>;
  sides?: Record<Seat, Side>;
  firstSide?: Side;
  refereeCrash?: boolean;
  committed?: (record: PlyRecord) => Promise<void> | void;
  thinkDeadlineMs?: number;
  pauseMs?: number;
}

function setup(options: Options = {}) {
  const clock = new ManualClock();
  const scripts: Record<Seat, SeatScript> = {
    left: { tag: 11, think: () => 'first', ...options.left },
    right: { tag: 22, think: () => 'last', ...options.right },
  };
  const workers: FakeSeatWorker[] = [];
  const records: PlyRecord[] = [];
  const settled: { rev: number; left: ReturnType<typeof frameInfo> | null; right: ReturnType<typeof frameInfo> | null }[] = [];
  const views: MatchView[] = [];
  let ended: MatchResult | null = null;
  const sides = options.sides ?? { left: 'red', right: 'blue' };

  const controller = new MatchController({
    matchId: 'm1',
    entrants: {
      left: { sha256: 'a'.repeat(64), metadata: METADATA, artifact: ARTIFACT },
      right: { sha256: 'a'.repeat(64), metadata: METADATA, artifact: ARTIFACT },
    },
    settings: {
      sides,
      firstSide: options.firstSide ?? 'red',
      difficulty: 'medium',
      seed: 42,
      nodeBudget: 1000,
      thinkDeadlineMs: options.thinkDeadlineMs ?? 5000,
    },
    seatFactory: () => {
      const worker = new FakeSeatWorker(scripts);
      workers.push(worker);
      return worker;
    },
    refereeFactory: () => new FakeRefereeWorker(options.refereeCrash),
    clock,
    loadDeadlineMs: 20_000,
    renderDeadlineMs: 2_000,
    animation: () => ({ steps: [], pauseMs: options.pauseMs ?? 0 }),
    listener: {
      state: (view) => views.push(view),
      frame: () => {},
      settled: (frames, rev) =>
        settled.push({ rev, left: frames.left ? frameInfo(frames.left.rgba) : null, right: frames.right ? frameInfo(frames.right.rgba) : null }),
      committed: async (record) => {
        records.push(record);
        await options.committed?.(record);
      },
      ended: (result) => {
        ended = result;
      },
    },
  });
  const seatWorkers = (seat: Seat) => workers.filter((w) => w.seat === seat);
  return { controller, clock, workers, seatWorkers, records, settled, views, sides, ended: () => ended };
}

async function until(predicate: () => boolean, rounds = 400): Promise<void> {
  for (let i = 0; i < rounds && !predicate(); i += 1) await flush(2);
  if (!predicate()) throw new Error('condition not reached');
}

describe('a full match', () => {
  it.each([
    [{ left: 'red', right: 'blue' }],
    [{ left: 'blue', right: 'red' }],
  ] as const)('plays to a referee-confirmed terminal with sides %o', async (sides) => {
    const t = setup({ sides });
    await t.controller.start();
    expect(t.controller.view.phase).toBe('ready');
    t.controller.play();
    await until(() => t.controller.view.phase === 'finished');

    const result = t.ended()!;
    expect(result.kind).toBe('board');
    const final = t.controller.view.snapshot!;
    expect(['won', 'drawn']).toContain(final.status);
    expect(final.rev).toBe(t.records.length);
    // Replaying the recorded decisions through the referee reproduces the final board.
    let replay: Snapshot = initialSnapshot('red');
    for (const r of t.records) replay = applyMove(replay, r.move);
    expect(replay).toEqual(final);
  });

  it('sends THINK only to the seat whose side is to move', async () => {
    const t = setup({ sides: { left: 'blue', right: 'red' } });
    await t.controller.start();
    t.controller.play();
    await until(() => t.controller.view.phase === 'finished');
    for (const seat of ['left', 'right'] as const) {
      for (const worker of t.seatWorkers(seat)) {
        for (const msg of worker.received) {
          if (msg.type === 'THINK') expect(t.sides[seat]).toBe(msg.snapshot.toPlay);
        }
      }
    }
    const thinks = t.records.map((r) => r.seat);
    expect(thinks[0]).toBe('right'); // red moves first and plays from the right column
    expect(thinks[1]).toBe('left');
  });

  it('presents both panes’ own settled frames for every revision', async () => {
    const t = setup();
    await t.controller.start();
    t.controller.play();
    await until(() => t.controller.view.phase === 'finished');
    const final = t.controller.view.snapshot!.rev;
    const revs = t.settled.map((s) => s.rev);
    expect(revs).toEqual(Array.from({ length: final + 1 }, (_, i) => i));
    for (const s of t.settled) {
      expect(s.left).toEqual({ tag: 11, rev: s.rev, flipped: false });
      expect(s.right).toEqual({ tag: 22, rev: s.rev, flipped: false });
    }
  });

  it('runs the same binary in both seats on two separate instances', async () => {
    const t = setup();
    await t.controller.start();
    expect(t.seatWorkers('left')).toHaveLength(1);
    expect(t.seatWorkers('right')).toHaveLength(1);
    expect(t.seatWorkers('left')[0]).not.toBe(t.seatWorkers('right')[0]);
  });

  it('terminates both instances when the game ends', async () => {
    const t = setup();
    await t.controller.start();
    t.controller.play();
    await until(() => t.controller.view.phase === 'finished');
    expect(t.workers.every((w) => w.terminated)).toBe(true);
  });
});

describe('reply hygiene', () => {
  it('ignores duplicate and stale replies without changing the game', async () => {
    const clean = setup();
    await clean.controller.start();
    clean.controller.play();
    await until(() => clean.controller.view.phase === 'finished');

    const noisy = setup({ left: { duplicateReplies: true, staleReplies: true }, right: { duplicateReplies: true } });
    await noisy.controller.start();
    noisy.controller.play();
    await until(() => noisy.controller.view.phase === 'finished');

    expect(noisy.records.map((r) => r.move)).toEqual(clean.records.map((r) => r.move));
    expect(noisy.controller.view.seats.left.ignoredReplies).toBeGreaterThan(0);
    expect(noisy.controller.view.seats.right.ignoredReplies).toBeGreaterThan(0);
  });

  it('a late proposal after dispose cannot alter the match', async () => {
    const t = setup({ left: { think: () => 'defer' } });
    await t.controller.start();
    t.controller.play();
    await until(() => t.seatWorkers('left')[0]!.release !== null);
    const release = t.seatWorkers('left')[0]!.release!;
    t.controller.dispose();
    release(0);
    await flush();
    expect(t.records).toHaveLength(0);
    expect(t.controller.view.phase).toBe('disposed');
    expect(t.controller.view.snapshot!.rev).toBe(0);
    expect(t.workers.every((w) => w.terminated)).toBe(true);
  });
});

describe('pause and single-step', () => {
  it('holds an in-flight proposal uncommitted until resume', async () => {
    const t = setup({ left: { think: () => 'defer' } });
    await t.controller.start();
    t.controller.play();
    await until(() => t.seatWorkers('left')[0]!.release !== null);
    t.controller.pause();
    t.seatWorkers('left')[0]!.release!(0);
    await until(() => t.controller.view.phase === 'paused');
    expect(t.controller.view.heldProposal).toEqual({ src: 42, dst: 35 });
    expect(t.controller.view.snapshot!.rev).toBe(0);
    expect(t.records).toHaveLength(0);

    t.controller.step();
    await until(() => t.controller.view.phase === 'paused' && t.records.length === 1);
    expect(t.records[0]!.move).toEqual({ src: 42, dst: 35 });
    expect(t.controller.view.snapshot!.rev).toBe(1);
    expect(t.controller.view.heldProposal).toBeNull();
  });

  it('single-step commits exactly one ply, then waits for both settled frames', async () => {
    const t = setup();
    await t.controller.start();
    t.controller.step();
    await until(() => t.controller.view.phase === 'paused');
    expect(t.records).toHaveLength(1);
    expect(t.controller.view.snapshot!.rev).toBe(1);
    const last = t.settled.at(-1)!;
    expect(last.rev).toBe(1);
    expect(last.left?.rev).toBe(1);
    expect(last.right?.rev).toBe(1);
    t.controller.step();
    await until(() => t.records.length === 2 && t.controller.view.phase === 'paused');
    expect(t.controller.view.snapshot!.rev).toBe(2);
  });

  it('persists a ply before anything renders or thinks past it', async () => {
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => (unblock = resolve));
    const t = setup({ committed: (r) => (r.rev === 1 ? gate : undefined) });
    await t.controller.start();
    t.controller.play();
    await until(() => t.records.length === 1);
    await flush();
    const rendersOfRev1 = t.workers.flatMap((w) => w.received).filter((m) => m.type !== 'INIT' && m.env.rev >= 1);
    expect(rendersOfRev1).toEqual([]);
    unblock();
    await until(() => t.records.length >= 2);
  });

  it('flips one pane without touching the other', async () => {
    const t = setup();
    await t.controller.start();
    t.controller.flip('left');
    await until(() => t.settled.at(-1)?.left?.flipped === true);
    const last = t.settled.at(-1)!;
    expect(last.right).toBeNull();
    expect(last.left).toEqual({ tag: 11, rev: 0, flipped: true });
    expect(t.controller.view.seats.left.flipped).toBe(true);
    expect(t.controller.view.seats.right.flipped).toBe(false);
  });
});

describe('lifecycle regressions from review', () => {
  it('honours a pause pressed during the pause between plies', async () => {
    // A long inter-ply pause on a manual clock: the loop waits inside delay().
    const t = setup({ pauseMs: 1000 });
    await t.controller.start();
    t.controller.play();
    await until(() => t.records.length === 1);
    await flush();
    t.controller.pause();
    t.clock.advance(1000);
    await until(() => t.controller.view.phase === 'paused');
    expect(t.records).toHaveLength(1);
    // No THINK for revision 1 was sent after the pause.
    expect(t.workers.flatMap((w) => w.received).filter((m) => m.type === 'THINK' && m.snapshot.rev === 1)).toHaveLength(0);
  });

  it('never starts a worker after dispose, even with a render queued on the seat lock', async () => {
    const t = setup({ left: { render: (s) => (s.rev === 1 ? 'hang' : 'ok') } });
    await t.controller.start();
    t.controller.step(); // left's rev-1 render hangs while holding the seat lock
    await until(() => t.workers.some((w) => w.seat === 'left' && w.received.some((m) => m.type === 'RENDER' && m.env.rev === 1)));
    t.controller.flip('left'); // queued behind the hung render
    t.controller.dispose();
    t.clock.advance(10_000);
    await flush();
    const before = t.workers.length;
    await flush();
    expect(t.workers.length).toBe(before);
    expect(t.workers.every((w) => w.terminated)).toBe(true);
  });

  it('settles a render that is outstanding when the game ends instead of reporting a display failure', async () => {
    const t = setup();
    await t.controller.start();
    t.controller.play();
    await until(() => t.controller.view.phase === 'finished');
    expect(t.controller.view.seats.left.paneError).toBeNull();
    expect(t.controller.view.seats.right.paneError).toBeNull();
  });
});

describe('forfeits and failures', () => {
  it('forfeits an out-of-range index as invalid-move, keeping board and history', async () => {
    const t = setup({ left: { think: () => 'out-of-range' } });
    await t.controller.start();
    t.controller.play();
    await until(() => t.controller.view.phase === 'finished');
    const s = t.controller.view.snapshot!;
    expect(s.status).toBe('forfeited');
    expect(s.reason).toBe('invalid-move');
    expect(s.winner).toBe('blue');
    expect(s.rev).toBe(1);
    expect(s.history).toEqual([]);
    expect(t.ended()).toMatchObject({ kind: 'forfeit', winnerSeat: 'right', forfeit: { seat: 'left', reason: 'invalid-move' } });
  });

  it('forfeits a trapping entrant as trap', async () => {
    const t = setup({ right: { think: () => 'trap' } });
    await t.controller.start();
    t.controller.play();
    await until(() => t.controller.view.phase === 'finished');
    expect(t.controller.view.snapshot).toMatchObject({ status: 'forfeited', reason: 'trap', winner: 'red', rev: 2 });
  });

  it('forfeits a non-responsive entrant at the think deadline and records it', async () => {
    const t = setup({ left: { think: () => 'hang' }, thinkDeadlineMs: 3000 });
    await t.controller.start();
    t.controller.play();
    await until(() => t.controller.view.seats.left.activity === 'thinking');
    t.clock.advance(2999);
    await flush();
    expect(t.controller.view.phase).toBe('running');
    t.clock.advance(1);
    await until(() => t.controller.view.phase === 'finished');
    expect(t.controller.view.snapshot).toMatchObject({ status: 'forfeited', reason: 'timeout', winner: 'blue' });
    expect(t.ended()).toMatchObject({ forfeit: { reason: 'timeout', deadlineMs: 3000, elapsedMs: 3000 } });
    // The hung instance is gone; a fresh one drew the terminal frame.
    expect(t.seatWorkers('left')[0]!.terminated).toBe(true);
    expect(t.seatWorkers('left')).toHaveLength(2);
    expect(t.settled.at(-1)!.left?.rev).toBe(1);
  });

  it('marks a pane on a render failure, keeps playing, and resyncs', async () => {
    let failOnce = true;
    const t = setup({
      right: {
        render: (s) => {
          if (s.rev === 1 && failOnce) {
            failOnce = false;
            return 'invalid-frame';
          }
          return 'ok';
        },
      },
    });
    await t.controller.start();
    t.controller.step();
    await until(() => t.controller.view.phase === 'paused');
    expect(t.controller.view.seats.right.paneError).toMatch(/Display failure/);
    expect(t.settled.at(-1)).toMatchObject({ rev: 1, right: null });
    t.controller.resync('right');
    await until(() => t.controller.view.seats.right.paneError === null);
    expect(t.settled.at(-1)!.right?.rev).toBe(1);
    t.controller.step();
    await until(() => t.records.length === 2);
  });

  it('ends the run as a system error when the referee fails', async () => {
    const t = setup({ refereeCrash: true });
    await t.controller.start();
    t.controller.play();
    await until(() => t.controller.view.phase === 'failed');
    expect(t.controller.view.failure).toMatch(/System error/);
    expect(t.ended()).toMatchObject({ kind: 'system-error' });
    expect(t.workers.every((w) => w.terminated)).toBe(true);
  });

  it('reports which seat failed to initialize', async () => {
    const t = setup({ right: { initFails: true } });
    await t.controller.start();
    expect(t.controller.view.phase).toBe('failed');
    expect(t.controller.view.failure).toMatch(/right seat .* failed to initialize: cannot load/);
  });
});
