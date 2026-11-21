import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { PlyRecord } from '../match/controller';
import { METADATA } from '../match/fakes.test-support';
import { applyMove, initialSnapshot, legalMoves } from '../referee';
import type { Snapshot } from '../referee/types';
import { MemoryStore, openArenaStore, ResilientStore, type ArenaStore } from '../storage/db';
import { REPLAY_FORMAT, replaySnapshots, validateReplay, withPly, withResult, type ReplayV1 } from './schema';

function baseReplay(): ReplayV1 {
  return {
    format: REPLAY_FORMAT,
    version: 1,
    id: 'r1',
    createdAt: '2026-11-20T00:00:00.000Z',
    arena: { version: 'test', loaderVersion: 'test' },
    rules: { id: 'desktop-jungle-v1', digest: 'a0936f1eee833dd11107ed581dc7c5c2f72f0612d9fc7055c93a1d2fbb0c3d63' },
    seats: {
      left: { sha256: 'a'.repeat(64), size: 1, metadata: METADATA, side: 'red' },
      right: { sha256: 'b'.repeat(64), size: 1, metadata: METADATA, side: 'blue' },
    },
    settings: { firstSide: 'red', seed: 1, difficulty: 'medium', nodeBudget: 1000, deadlines: { load: 1, think: 1, render: 1 } },
    initial: initialSnapshot('red'),
    plies: [],
    result: null,
    final: null,
  };
}

/** Play `n` plies of first-legal-move and record them the way the controller does. */
function played(n: number): { replay: ReplayV1; final: Snapshot } {
  let replay = baseReplay();
  let s = replay.initial;
  for (let i = 0; i < n && s.status === 'playing'; i += 1) {
    const move = legalMoves(s)[0]!;
    const next = applyMove(s, move);
    const record: PlyRecord = {
      rev: next.rev,
      seat: s.toPlay === 'red' ? 'left' : 'right',
      side: s.toPlay,
      index: 0,
      move,
      captured: s.board[move.dst] ?? null,
      noCapturePlies: next.noCapturePlies,
      thinkMs: 1,
    };
    replay = withPly(replay, record);
    s = next;
  }
  return { replay, final: s };
}

describe('replay format', () => {
  it('rebuilds every official snapshot from the recorded decisions', () => {
    const { replay, final } = played(12);
    const snapshots = replaySnapshots(replay);
    expect(snapshots).toHaveLength(13);
    expect(snapshots[12]).toEqual(final);
    expect(snapshots.map((s) => s.rev)).toEqual(Array.from({ length: 13 }, (_, i) => i));
  });

  it('adds the forfeit revision without adding a ply', () => {
    const { replay, final } = played(3);
    const forfeitRecord = { seat: 'right' as const, side: 'blue' as const, reason: 'timeout' as const, message: 'x', elapsedMs: 5000, deadlineMs: 5000 };
    const ended = withResult(
      replay,
      { kind: 'forfeit', status: 'forfeited', winner: 'red', winnerSeat: 'left', reason: 'timeout', endRev: 4, forfeit: forfeitRecord },
      { ...final, rev: 4, status: 'forfeited', winner: 'red', reason: 'timeout' },
    );
    const snapshots = replaySnapshots(ended);
    expect(snapshots).toHaveLength(5);
    expect(snapshots[4]).toMatchObject({ rev: 4, status: 'forfeited', reason: 'timeout', history: final.history });
    expect(validateReplay(JSON.parse(JSON.stringify(ended)))).toMatchObject({ ok: true });
  });

  it('round-trips through JSON (download and re-open) unchanged', () => {
    const { replay } = played(20);
    const reopened = validateReplay(JSON.parse(JSON.stringify(replay)));
    expect(reopened.ok).toBe(true);
    if (reopened.ok) expect(reopened.replay).toEqual(replay);
  });

  it('rejects a replay whose moves the referee does not accept', () => {
    const { replay } = played(4);
    const tampered = { ...replay, plies: replay.plies.map((p, i) => (i === 2 ? { ...p, move: { src: 0, dst: 62 } } : p)) };
    const check = validateReplay(JSON.parse(JSON.stringify(tampered)));
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.issues.join()).toMatch(/illegal/);
  });

  it('rejects other formats, other rules and malformed seats', () => {
    expect(validateReplay({ format: 'x' })).toMatchObject({ ok: false });
    expect(validateReplay({ ...baseReplay(), rules: { id: 'other', digest: '0' } })).toMatchObject({ ok: false });
    const badSeat = { ...baseReplay(), seats: { ...baseReplay().seats, left: { ...baseReplay().seats.left, sha256: 'zz' } } };
    expect(validateReplay(badSeat)).toMatchObject({ ok: false });
  });
});

describe('storage', () => {
  async function exercise(store: ArenaStore) {
    const { replay } = played(2);
    await store.putReplay(replay);
    expect((await store.getReplay('r1'))?.plies).toHaveLength(2);
    await store.putPackage({ sha256: 'a'.repeat(64), size: 3, fileName: 'x.wasm', metadata: METADATA, importedAt: 'now', bytes: new Uint8Array([1, 2, 3]) });
    await store.putTranspiled('a'.repeat(64), 'v1', { js: 'js', modules: {} });
    expect((await store.listPackages()).map((p) => p.sha256)).toEqual(['a'.repeat(64)]);
    expect(await store.getTranspiled('a'.repeat(64), 'v1')).toMatchObject({ js: 'js' });
    expect(await store.getTranspiled('a'.repeat(64), 'v2')).toBeNull();
    await store.deletePackage('a'.repeat(64));
    expect(await store.getTranspiled('a'.repeat(64), 'v1')).toBeNull();
  }

  it('persists packages, transpile cache and replays in IndexedDB', async () => {
    const store = await openArenaStore();
    expect(store.persistent).toBe(true);
    await exercise(store);
  });

  it('reports unavailable storage and keeps working in memory', async () => {
    const store = await openArenaStore(null);
    expect(store.persistent).toBe(false);
    expect(store.unavailableReason).toMatch(/IndexedDB/);
    await exercise(store);
  });

  it('degrades to memory when a write fails mid-match', async () => {
    const failing = new MemoryStore();
    failing.putReplay = async () => {
      throw new Error('QuotaExceededError');
    };
    const store = new ResilientStore(failing);
    const { replay } = played(1);
    await store.putReplay(replay);
    expect(store.persistent).toBe(false);
    expect(store.unavailableReason).toMatch(/QuotaExceededError/);
    expect(await store.getReplay('r1')).not.toBeNull();
  });
});

describe('storage ordering and resilience', () => {
  it('lists replays newest first and deletes them', async () => {
    const store = new MemoryStore();
    const older = { ...played(1).replay, id: 'old', createdAt: '2026-01-01T00:00:00.000Z' };
    const newer = { ...played(1).replay, id: 'new', createdAt: '2026-06-01T00:00:00.000Z' };
    await store.putReplay(older);
    await store.putReplay(newer);
    expect((await store.listReplays()).map((r) => r.id)).toEqual(['new', 'old']);
    await store.deleteReplay('new');
    expect((await store.listReplays()).map((r) => r.id)).toEqual(['old']);
    expect(await store.getPackage('x')).toBeNull();
  });

  it('keeps every operation working after the primary store fails once', async () => {
    const failing = new MemoryStore();
    failing.listPackages = async () => {
      throw new Error('InvalidStateError');
    };
    const store = new ResilientStore(failing);
    expect(await store.listPackages()).toEqual([]);
    await store.putPackage({ sha256: 'b'.repeat(64), size: 1, fileName: 'b.wasm', metadata: METADATA, importedAt: 'now', bytes: new Uint8Array([1]) });
    expect((await store.getPackage('b'.repeat(64)))?.fileName).toBe('b.wasm');
    await store.putTranspiled('b'.repeat(64), 'v', { js: '', modules: {} });
    expect(await store.getTranspiled('b'.repeat(64), 'v')).not.toBeNull();
    await store.deletePackage('b'.repeat(64));
    expect(await store.listReplays()).toEqual([]);
    expect(await store.getReplay('none')).toBeNull();
    await store.deleteReplay('none');
    expect(store.persistent).toBe(false);
  });
});
